import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import { getManagedUser } from './managementStore.js';

let client: ReturnType<typeof postgres> | undefined;
let initialized = false;

function databaseUrl() {
  return process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL || '';
}

function sql() {
  const url = databaseUrl();
  if (!url) throw new Error('OpsVista database URL is not configured');
  if (!client) client = postgres(url,{max:4,idle_timeout:20,connect_timeout:10});
  return client;
}

async function ensureSchema() {
  if (initialized) return;
  const db=sql();
  await db`
    create table if not exists opsvista_auth_credentials (
      user_id text primary key,
      email text not null,
      password_salt text not null,
      password_hash text not null,
      password_set_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await db`create unique index if not exists opsvista_auth_credentials_email_idx on opsvista_auth_credentials (lower(email))`;
  await db`
    create table if not exists opsvista_auth_invitations (
      id text primary key,
      user_id text not null,
      email text not null,
      token_hash text not null unique,
      status text not null default 'pending',
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      created_by text not null,
      accepted_at timestamptz
    )
  `;
  await db`create index if not exists opsvista_auth_invitations_user_idx on opsvista_auth_invitations (user_id, created_at desc)`;
  initialized=true;
}

const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
const auditId=(prefix:string)=>`${prefix}_${randomBytes(12).toString('hex')}`;
const safeEqual=(a:string,b:string)=>{const left=Buffer.from(a);const right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};

export async function createInvitation(userId:string,email:string,createdBy:string) {
  await ensureSchema();
  const db=sql();
  const token=randomBytes(32).toString('base64url');
  const id=`inv_${randomBytes(12).toString('hex')}`;
  const expiresAt=new Date(Date.now()+48*60*60*1000);
  const [actor,target]=await Promise.all([getManagedUser(createdBy),getManagedUser(userId)]);
  await db.begin(async tx=>{
    await tx`update opsvista_auth_invitations set status='superseded' where user_id=${userId} and status='pending'`;
    await tx`insert into opsvista_auth_invitations (id,user_id,email,token_hash,status,expires_at,created_by) values (${id},${userId},${email.toLowerCase()},${tokenHash(token)},'pending',${expiresAt.toISOString()},${createdBy})`;
    if(actor&&target) await tx`
      insert into opsvista_management_audit
      (id,at,actor_id,actor_name,target_user_id,target_user_name,action,before_value,after_value,reason,automatic)
      values (${auditId('invite')},now(),${actor.id},${actor.name},${target.id},${target.name},'Invitation created','No active invitation',${`Invitation pending · expires ${expiresAt.toISOString()}`},'Account onboarding invitation created.',false)
    `;
  });
  return {id,token,expiresAt:expiresAt.toISOString()};
}

export async function listInvitations() {
  await ensureSchema();
  const rows=await sql()`select id,user_id,email,status,expires_at,created_at,created_by,accepted_at from opsvista_auth_invitations order by created_at desc limit 500`;
  return rows.map(row=>({id:String(row.id),userId:String(row.user_id),email:String(row.email),status:String(row.status),expiresAt:new Date(String(row.expires_at)).toISOString(),createdAt:new Date(String(row.created_at)).toISOString(),createdBy:String(row.created_by),acceptedAt:row.accepted_at?new Date(String(row.accepted_at)).toISOString():undefined}));
}

export async function acceptInvitation(token:string,password:string) {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  await ensureSchema();
  const db=sql();
  const rows=await db`select * from opsvista_auth_invitations where token_hash=${tokenHash(token)} and status='pending' limit 1`;
  const invitation=rows[0];
  if (!invitation) throw new Error('Invitation is invalid or has already been used');
  if (new Date(String(invitation.expires_at)).getTime() <= Date.now()) { await db`update opsvista_auth_invitations set status='expired' where id=${String(invitation.id)}`; throw new Error('Invitation has expired'); }
  const managed=await getManagedUser(String(invitation.user_id));
  if (!managed || !managed.active) throw new Error('Account is not active');
  if (!managed.email || managed.email.toLowerCase() !== String(invitation.email).toLowerCase()) throw new Error('Invitation account mismatch');
  const salt=randomBytes(16).toString('hex');
  const hash=scryptSync(password,salt,64).toString('hex');
  await db.begin(async tx=>{
    await tx`insert into opsvista_auth_credentials (user_id,email,password_salt,password_hash,password_set_at,updated_at) values (${managed.id},${managed.email.toLowerCase()},${salt},${hash},now(),now()) on conflict (user_id) do update set email=excluded.email,password_salt=excluded.password_salt,password_hash=excluded.password_hash,password_set_at=now(),updated_at=now()`;
    await tx`update opsvista_auth_invitations set status='accepted',accepted_at=now() where id=${String(invitation.id)}`;
    await tx`insert into opsvista_management_audit (id,at,actor_id,actor_name,target_user_id,target_user_name,action,before_value,after_value,reason,automatic) values (${auditId('invite_accept')},now(),${managed.id},${managed.name},${managed.id},${managed.name},'Invitation accepted','Password not established','Password established','User accepted onboarding invitation and created their password.',true)`;
  });
  return managed;
}

export async function founderBootstrapAvailable() {
  await ensureSchema();
  const founder=await getManagedUser('usr-founder-roberto');
  if (!founder || founder.role!=='Founder' || !founder.active) return false;
  const rows=await sql()`select user_id from opsvista_auth_credentials where user_id=${founder.id} limit 1`;
  return rows.length===0;
}

export async function bootstrapFounderCredential(email:string,password:string,bootstrapSecret:string) {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  const configured=process.env.OPSVISTA_FOUNDER_BOOTSTRAP_SECRET || '';
  if (configured.length < 32 || !safeEqual(configured,bootstrapSecret)) throw new Error('Invalid Founder bootstrap code');
  await ensureSchema();
  const db=sql();
  const founder=await getManagedUser('usr-founder-roberto');
  if (!founder || founder.role!=='Founder' || !founder.active || !founder.email) throw new Error('Founder account is unavailable');
  if (founder.email.toLowerCase()!==email.trim().toLowerCase()) throw new Error('Founder email does not match');
  const existing=await db`select user_id from opsvista_auth_credentials where user_id=${founder.id} limit 1`;
  if (existing.length) throw new Error('Founder bootstrap has already been completed');
  const salt=randomBytes(16).toString('hex');
  const hash=scryptSync(password,salt,64).toString('hex');
  await db.begin(async tx=>{
    await tx`insert into opsvista_auth_credentials (user_id,email,password_salt,password_hash,password_set_at,updated_at) values (${founder.id},${founder.email.toLowerCase()},${salt},${hash},now(),now())`;
    await tx`insert into opsvista_management_audit (id,at,actor_id,actor_name,target_user_id,target_user_name,action,before_value,after_value,reason,automatic) values (${auditId('founder_bootstrap')},now(),${founder.id},${founder.name},${founder.id},${founder.name},'Founder bootstrap completed','Password not established','Founder credential established','Initial one-time Founder account activation.',true)`;
  });
  return founder;
}

// One-time first-login recovery. Only the hash/salt are committed; the temporary password is never stored in source.
const FIRST_FOUNDER_SALT='f202d880e1d52c662da0888ae01c5420';
const FIRST_FOUNDER_HASH='b7d7f8ff68205597193e1fb61e457e5e249606bc4741b373bbb759e9153a72b89271638f7287a19a135103367910c5d4cc7046805da74df55dd51b265909056';

export async function claimFounderOnFirstLogin(email:string,password:string) {
  const normalized=email.trim().toLowerCase();
  if (normalized!=='rodriguez.evolife@gmail.com') return false;
  await ensureSchema();
  const founder=await getManagedUser('usr-founder-roberto');
  if (!founder || founder.role!=='Founder' || !founder.active || founder.email?.toLowerCase()!==normalized) return false;
  const db=sql();
  const existing=await db`select user_id from opsvista_auth_credentials where user_id=${founder.id} limit 1`;
  if (existing.length) return false;
  const candidate=scryptSync(password,FIRST_FOUNDER_SALT,64);
  const expected=Buffer.from(FIRST_FOUNDER_HASH,'hex');
  if (candidate.length!==expected.length || !timingSafeEqual(candidate,expected)) return false;
  const salt=randomBytes(16).toString('hex');
  const hash=scryptSync(password,salt,64).toString('hex');
  await db.begin(async tx=>{
    await tx`insert into opsvista_auth_credentials (user_id,email,password_salt,password_hash,password_set_at,updated_at) values (${founder.id},${normalized},${salt},${hash},now(),now())`;
    await tx`insert into opsvista_management_audit (id,at,actor_id,actor_name,target_user_id,target_user_name,action,before_value,after_value,reason,automatic) values (${auditId('founder_first_login')},now(),${founder.id},${founder.name},${founder.id},${founder.name},'Founder first login','Password not established','Founder credential established','One-time simplified Founder login initialization.',true)`;
  });
  return true;
}

export async function authenticateStoredCredential(email:string,password:string) {
  await ensureSchema();
  const rows=await sql()`select * from opsvista_auth_credentials where lower(email)=lower(${email}) limit 1`;
  const row=rows[0];
  if (!row) return null;
  const candidate=scryptSync(password,String(row.password_salt),64);
  const expected=Buffer.from(String(row.password_hash),'hex');
  if (candidate.length!==expected.length || !timingSafeEqual(candidate,expected)) return null;
  return {userId:String(row.user_id),email:String(row.email)};
}
