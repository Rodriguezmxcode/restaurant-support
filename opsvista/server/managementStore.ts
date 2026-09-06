import postgres from 'postgres';
import type { ServerRole, SessionUser } from './authSession.js';

export type StoredLocationGrant = {
  location: string;
  type: 'Primary' | 'Additional';
  expiresAt?: string;
  note?: string;
};

export type ManagedDirectoryUser = {
  id: string;
  name: string;
  email?: string;
  role: ServerRole;
  title: string;
  locations: string[];
  locationGrants?: StoredLocationGrant[];
  active: boolean;
};

export type StoredAuditEvent = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
  targetUserName: string;
  action: string;
  location?: string;
  before?: string;
  after?: string;
  reason: string;
  automatic?: boolean;
};

let sqlClient: ReturnType<typeof postgres> | undefined;
let initialized = false;
let bootstrapped = false;

const locations = ['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const grants = (items:string[]):StoredLocationGrant[] => items.map((location,index)=>({location,type:index===0?'Primary':'Additional',note:index===0?'Home location':'Permanent management coverage'}));

/** Initial management directory only. Passwords and password hashes are intentionally excluded. */
export const initialManagedDirectory: ManagedDirectoryUser[] = [
  {id:'usr-founder-roberto',name:'Roberto Rodríguez',email:'rodriguez.evolife@gmail.com',role:'Founder',title:'Founder / Owner / Super Admin',locations:[],active:true},
  {id:'usr-roberto-ops',name:'Roberto Rodríguez',email:'roberto@puertovallartausa.com',role:'Corporate',title:'Operations',locations:[],active:true},
  {id:'usr-jacob',name:'Jacob Rodríguez',email:'jacob@puertovallartausa.com',role:'Corporate',title:'President',locations:[],active:true},
  {id:'usr-esaul',name:'Esaul Rodríguez',email:'esaul08@gmail.com',role:'Corporate',title:'CEO',locations:[],active:true},
  {id:'usr-caleb',name:'Caleb Kyllo',email:'caleb@puertovallartausa.com',role:'Corporate',title:'Corporate',locations:[],active:true},
  {id:'usr-gladys',name:'Gladys Valdez',email:'gvaldez1223@outlook.com',role:'HR',title:'Human Resources & Payroll',locations:[],active:true},
  {id:'usr-eduardo',name:'Eduardo Santos',email:'lalo@puertovallartausa.com',role:'Kitchen',title:'Kitchen Operations',locations,locationGrants:grants(locations),active:true},
  {id:'usr-miguel',name:'Miguel Bello',email:'miguel@puertovallartausa.com',role:'Maintenance',title:'Head of Maintenance · All Locations',locations:[],active:true},
  {id:'usr-samantha',name:'Samantha Lora',email:'invoicepv@puertovallartausa.com',role:'Administration',title:'Administration',locations:[],active:true},
  {id:'usr-jonathan',name:'Jonathan Rodriguez',email:'jonathan@puertovallartausa.com',role:'Administration',title:'Corporate Secretary · Payments, Vendors & Restaurant365',locations:[],active:true},
  {id:'usr-ali',name:'Ali Vinicio',email:'ali@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Avon'],locationGrants:grants(['Avon']),active:true},
  {id:'usr-christopher',name:'Christopher Guerrero',email:'cristopher@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Danbury'],locationGrants:grants(['Danbury']),active:true},
  {id:'usr-daniel',name:'Daniel Castro',email:'daniel@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Danbury'],locationGrants:grants(['Danbury']),active:true},
  {id:'usr-janneth',name:'Janneth Domínguez',email:'janneth@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Orange'],locationGrants:grants(['Orange']),active:true},
  {id:'usr-jhohan',name:'Jhohan Hernández',email:'jhohan@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Southington','Avon'],locationGrants:grants(['Southington','Avon']),active:true},
  {id:'usr-juan-delgado',name:'Juan Delgado',email:'juandelgado@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Stamford'],locationGrants:grants(['Stamford']),active:true},
  {id:'usr-juan-sebastian',name:'Juan Sebastián Zuleta',email:'jzuleta@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Southington'],locationGrants:grants(['Southington']),active:true},
  {id:'usr-juan-zuleta',name:'Juan Zuleta',email:'juanzuleta@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Stamford','Southington'],locationGrants:grants(['Stamford','Southington']),active:true},
  {id:'usr-michael',name:'Michael Monsalve',email:'michael@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Fairfield'],locationGrants:grants(['Fairfield']),active:true},
  {id:'usr-pedro',name:'Pedro Santiago',email:'pedro@puertovallartausa.com',role:'Location Manager',title:'Restaurant Manager',locations:['Orange'],locationGrants:grants(['Orange']),active:true},
];

const approvedDirectoryProfiles: Pick<ManagedDirectoryUser,'id'|'name'|'email'|'role'|'title'>[] = [
  {id:'usr-miguel',name:'Miguel Bello',email:'miguel@puertovallartausa.com',role:'Maintenance',title:'Head of Maintenance · All Locations'},
  {id:'usr-jonathan',name:'Jonathan Rodriguez',email:'jonathan@puertovallartausa.com',role:'Administration',title:'Corporate Secretary · Payments, Vendors & Restaurant365'},
];

function sql() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('OpsVista database URL is not configured');
  if (!sqlClient) sqlClient = postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10 });
  return sqlClient;
}

async function ensureSchema() {
  if (initialized) return;
  const db = sql();
  await db`
    create table if not exists opsvista_management_users (
      id text primary key,
      name text not null,
      email text,
      role text not null,
      title text not null default '',
      active boolean not null default true,
      locations jsonb not null default '[]'::jsonb,
      location_grants jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now(),
      updated_by text
    )
  `;
  await db`alter table opsvista_management_users add column if not exists email text`;
  await db`
    create table if not exists opsvista_management_audit (
      id text primary key,
      at timestamptz not null,
      actor_id text not null,
      actor_name text not null,
      target_user_id text not null,
      target_user_name text not null,
      action text not null,
      location text,
      before_value text,
      after_value text,
      reason text not null,
      automatic boolean not null default false
    )
  `;
  await db`create index if not exists opsvista_management_audit_at_idx on opsvista_management_audit (at desc)`;
  await db`create index if not exists opsvista_management_audit_target_idx on opsvista_management_audit (target_user_id, at desc)`;
  await db`create unique index if not exists opsvista_management_users_email_idx on opsvista_management_users (lower(email)) where email is not null`;
  initialized = true;
}

async function bootstrapInitialDirectory() {
  if (bootstrapped) return;
  await ensureSchema();
  const db = sql();
  const at = new Date().toISOString();
  await db.begin(async tx => {
    for (const user of initialManagedDirectory) {
      const inserted = await tx`
        insert into opsvista_management_users (id,name,email,role,title,active,locations,location_grants,updated_by)
        values (${user.id},${user.name},${user.email ?? null},${user.role},${user.title},${user.active},${tx.json(user.locations)},${tx.json(user.locationGrants ?? [])},'initial-directory-v2')
        on conflict (id) do nothing
        returning id
      `;
      if (!inserted.length) continue;
      await tx`
        insert into opsvista_management_audit
        (id,at,actor_id,actor_name,target_user_id,target_user_name,action,before_value,after_value,reason,automatic)
        values (${`bootstrap-${user.id}`},${at},'initial-directory-v2','OpsVista Directory Migration',${user.id},${user.name},'User created','No account',${`${user.role}${user.email?` · ${user.email}`:''}`},'Missing approved directory user added without changing existing accounts.',true)
        on conflict (id) do nothing
      `;
    }
    for (const profile of approvedDirectoryProfiles) {
      const rows = await tx`select name,email,role,title from opsvista_management_users where id=${profile.id} limit 1`;
      const existing = rows[0];
      if (!existing) continue;
      const before = `${String(existing.name)} · ${String(existing.role)} · ${String(existing.title)} · ${String(existing.email ?? '')}`;
      const after = `${profile.name} · ${profile.role} · ${profile.title} · ${profile.email ?? ''}`;
      if (before === after) continue;
      await tx`
        update opsvista_management_users
        set name=${profile.name},email=${profile.email ?? null},role=${profile.role},title=${profile.title},updated_at=now(),updated_by='approved-directory-profile-v1'
        where id=${profile.id}
      `;
      await tx`
        insert into opsvista_management_audit
        (id,at,actor_id,actor_name,target_user_id,target_user_name,action,before_value,after_value,reason,automatic)
        values (${`approved-profile-${profile.id}-v1`},${at},'approved-directory-profile-v1','OpsVista Directory Migration',${profile.id},${profile.name},'Authorized profile updated',${before},${after},'Email, title and role responsibilities confirmed by Operations.',true)
        on conflict (id) do nothing
      `;
    }
  });
  bootstrapped = true;
}

function normalizeUser(row: Record<string, unknown>): ManagedDirectoryUser {
  return {
    id:String(row.id), name:String(row.name), email:row.email ? String(row.email) : undefined, role:row.role as ServerRole,
    title:String(row.title ?? ''), active:Boolean(row.active),
    locations:Array.isArray(row.locations) ? row.locations.map(String) : [],
    locationGrants:Array.isArray(row.location_grants) ? row.location_grants as StoredLocationGrant[] : [],
  };
}

function normalizeAudit(row: Record<string, unknown>): StoredAuditEvent {
  return {
    id:String(row.id), at:new Date(String(row.at)).toISOString(), actorId:String(row.actor_id), actorName:String(row.actor_name),
    targetUserId:String(row.target_user_id), targetUserName:String(row.target_user_name), action:String(row.action),
    location:row.location ? String(row.location) : undefined, before:row.before_value ? String(row.before_value) : undefined,
    after:row.after_value ? String(row.after_value) : undefined, reason:String(row.reason), automatic:Boolean(row.automatic),
  };
}

export async function listManagedUsers() {
  await bootstrapInitialDirectory();
  const rows = await sql()`select * from opsvista_management_users order by name asc, email asc nulls last`;
  return rows.map(row=>normalizeUser(row));
}

export async function getManagedUser(id: string) {
  await bootstrapInitialDirectory();
  const rows = await sql()`select * from opsvista_management_users where id=${id} limit 1`;
  return rows[0] ? normalizeUser(rows[0]) : null;
}

export async function getManagedUserByEmail(email: string) {
  await bootstrapInitialDirectory();
  const normalized = email.trim().toLowerCase();
  const rows = await sql()`select * from opsvista_management_users where lower(email)=lower(${normalized}) limit 1`;
  return rows[0] ? normalizeUser(rows[0]) : null;
}

export async function listManagementAudit(limit = 500) {
  await ensureSchema();
  const safeLimit = Math.max(1, Math.min(1000, limit));
  const rows = await sql()`select * from opsvista_management_audit order by at desc limit ${safeLimit}`;
  return rows.map(row=>normalizeAudit(row));
}

export async function saveManagedUser(user: ManagedDirectoryUser, events: StoredAuditEvent[], actor: SessionUser) {
  await bootstrapInitialDirectory();
  const db = sql();
  await db.begin(async tx => {
    await tx`
      insert into opsvista_management_users (id,name,email,role,title,active,locations,location_grants,updated_at,updated_by)
      values (${user.id},${user.name},${user.email ?? null},${user.role},${user.title},${user.active},${tx.json(user.locations)},${tx.json(user.locationGrants ?? [])},now(),${actor.id})
      on conflict (id) do update set
        name=excluded.name, email=excluded.email, role=excluded.role, title=excluded.title, active=excluded.active,
        locations=excluded.locations, location_grants=excluded.location_grants, updated_at=now(), updated_by=excluded.updated_by
    `;
    for (const event of events) {
      await tx`
        insert into opsvista_management_audit
        (id,at,actor_id,actor_name,target_user_id,target_user_name,action,location,before_value,after_value,reason,automatic)
        values (${event.id},${event.at},${actor.id},${actor.name},${event.targetUserId},${event.targetUserName},${event.action},${event.location ?? null},${event.before ?? null},${event.after ?? null},${event.reason},${event.automatic ?? false})
        on conflict (id) do nothing
      `;
    }
  });
}

export async function seedManagedUsers(users: ManagedDirectoryUser[], actorId = 'migration') {
  await ensureSchema();
  for (const user of users) {
    await sql()`
      insert into opsvista_management_users (id,name,email,role,title,active,locations,location_grants,updated_by)
      values (${user.id},${user.name},${user.email ?? null},${user.role},${user.title},${user.active},${sql().json(user.locations)},${sql().json(user.locationGrants ?? [])},${actorId})
      on conflict (id) do nothing
    `;
  }
}
