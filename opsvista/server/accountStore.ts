import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import { getManagedUser } from './managementStore';

let client: ReturnType<typeof postgres> | undefined;
let initialized = false;

function sql() {
  const url = process.env.OPSVISTA_DATABASE_URL;
  if (!url) throw new Error('OPSVISTA_DATABASE_URL is not configured');
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

export async function createInvitation(userId:string,email:string,createdBy:string) {
  await ensureSchema();
  const db=sql();
  const token=randomBytes(32).toString('base64url');
  const id=`inv_${randomBytes(12).toString('hex')}`;
  const expiresAt=new Date(Date.now()+48*60*60*1000);
  await db.begin(async tx=>{
    await tx`update opsvista_auth_invitations set status='superseded' where user_id=${userId} and status='pending'`;
    await tx`
      insert into opsvista_auth_invitations (id,user_id,email,token_hash,status,expires_at,created_by)
      values (${id},${userId},${email.toLowerCase()},${tokenHash(token)},'pending',${expiresAt.toISOString()},${createdBy})
    `;
  });
  return {id,token,expiresAt:expiresAt.toISOString()};
}

export async function listInvitations() {
  await ensureSchema();
  const rows=await sql()`
    select id,user_id,email,status,expires_at,created_at,created_by,accepted_at
    from opsvista_auth_invitations order by created_at desc limit 500
  `;
  return rows.map(row=>({
    id:String(row.id),userId:String(row.user_id),email:String(row.email),status:String(row.status),
    expiresAt:new Date(String(row.expires_at)).toISOString(),createdAt:new Date(String(row.created_at)).toISOString(),
    createdBy:String(row.created_by),acceptedAt:row.accepted_at?new Date(String(row.accepted_at)).toISOString():undefined,
  }));
}

export async function acceptInvitation(token:string,password:string) {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  await ensureSchema();
  const db=sql();
  const rows=await db`
    select * from opsvista_auth_invitations where token_hash=${tokenHash(token)} and status='pending' limit 1
  `;
  const invitation=rows[0];
  if (!invitation) throw new Error('Invitation is invalid or has already been used');
  if (new Date(String(invitation.expires_at)).getTime() <= Date.now()) {
    await db`update opsvista_auth_invitations set status='expired' where id=${String(invitation.id)}`;
    throw new Error('Invitation has expired');
  }
  const managed=await getManagedUser(String(invitation.user_id));
  if (!managed || !managed.active) throw new Error('Account is not active');
  if (!managed.email || managed.email.toLowerCase() !== String(invitation.email).toLowerCase()) throw new Error('Invitation account mismatch');

  const salt=randomBytes(16).toString('hex');
  const hash=scryptSync(password,salt,64).toString('hex');
  await db.begin(async tx=>{
    await tx`
      insert into opsvista_auth_credentials (user_id,email,password_salt,password_hash,password_set_at,updated_at)
      values (${managed.id},${managed.email.toLowerCase()},${salt},${hash},now(),now())
      on conflict (user_id) do update set email=excluded.email,password_salt=excluded.password_salt,password_hash=excluded.password_hash,password_set_at=now(),updated_at=now()
    `;
    await tx`update opsvista_auth_invitations set status='accepted',accepted_at=now() where id=${String(invitation.id)}`;
  });
  return managed;
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
