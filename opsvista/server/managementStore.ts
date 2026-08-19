import postgres from 'postgres';
import type { ServerRole, SessionUser } from './authSession';

export type StoredLocationGrant = {
  location: string;
  type: 'Primary' | 'Additional';
  expiresAt?: string;
  note?: string;
};

export type ManagedDirectoryUser = {
  id: string;
  name: string;
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

function sql() {
  const url = process.env.OPSVISTA_DATABASE_URL;
  if (!url) throw new Error('OPSVISTA_DATABASE_URL is not configured');
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
      role text not null,
      title text not null default '',
      active boolean not null default true,
      locations jsonb not null default '[]'::jsonb,
      location_grants jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now(),
      updated_by text
    )
  `;
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
  initialized = true;
}

function normalizeUser(row: Record<string, unknown>): ManagedDirectoryUser {
  return {
    id: String(row.id), name: String(row.name), role: row.role as ServerRole,
    title: String(row.title ?? ''), active: Boolean(row.active),
    locations: Array.isArray(row.locations) ? row.locations.map(String) : [],
    locationGrants: Array.isArray(row.location_grants) ? row.location_grants as StoredLocationGrant[] : [],
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
  await ensureSchema();
  const rows = await sql()`select * from opsvista_management_users order by name asc`;
  return rows.map(row => normalizeUser(row));
}

export async function getManagedUser(id: string) {
  await ensureSchema();
  const rows = await sql()`select * from opsvista_management_users where id=${id} limit 1`;
  return rows[0] ? normalizeUser(rows[0]) : null;
}

export async function listManagementAudit(limit = 500) {
  await ensureSchema();
  const safeLimit = Math.max(1, Math.min(1000, limit));
  const rows = await sql()`select * from opsvista_management_audit order by at desc limit ${safeLimit}`;
  return rows.map(row => normalizeAudit(row));
}

export async function saveManagedUser(user: ManagedDirectoryUser, events: StoredAuditEvent[], actor: SessionUser) {
  await ensureSchema();
  const db = sql();
  await db.begin(async tx => {
    await tx`
      insert into opsvista_management_users (id,name,role,title,active,locations,location_grants,updated_at,updated_by)
      values (${user.id},${user.name},${user.role},${user.title},${user.active},${tx.json(user.locations)},${tx.json(user.locationGrants ?? [])},now(),${actor.id})
      on conflict (id) do update set
        name=excluded.name, role=excluded.role, title=excluded.title, active=excluded.active,
        locations=excluded.locations, location_grants=excluded.location_grants,
        updated_at=now(), updated_by=excluded.updated_by
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
      insert into opsvista_management_users (id,name,role,title,active,locations,location_grants,updated_by)
      values (${user.id},${user.name},${user.role},${user.title},${user.active},${sql().json(user.locations)},${sql().json(user.locationGrants ?? [])},${actorId})
      on conflict (id) do nothing
    `;
  }
}
