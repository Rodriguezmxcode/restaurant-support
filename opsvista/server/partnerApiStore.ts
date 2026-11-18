import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { PartnerKey } from '../shared/partnerApi.js';
import { PUERTO_VALLARTA_ORG } from '../shared/tenantAccess.js';

let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<unknown> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Partner API database unavailable');
  return client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 5 });
}
async function schema() {
  ready ||= (async () => {
    await db()`create table if not exists opsvista_partner_keys (
      id uuid primary key, organization_id text not null, name text not null,
      token_hash text not null unique, prefix text not null, created_by text not null,
      created_at timestamptz not null default now(), expires_at timestamptz not null,
      revoked_at timestamptz, last_used_at timestamptz)`;
    await db()`create table if not exists opsvista_partner_usage (
      key_id uuid not null references opsvista_partner_keys(id), bucket timestamptz not null,
      requests integer not null, primary key(key_id,bucket))`;
  })().catch(error => { ready = undefined; throw error; });
  await ready;
}
const iso = (value: any) => value ? new Date(value).toISOString() : null;
const metadata = (row: any): PartnerKey => ({ id: row.id, name: row.name, prefix: row.prefix,
  createdAt: iso(row.created_at)!, expiresAt: iso(row.expires_at)!, revokedAt: iso(row.revoked_at), lastUsedAt: iso(row.last_used_at) });
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export async function listPartnerKeys(organizationId: string) {
  await schema();
  const rows = await db()`select id,name,prefix,created_at,expires_at,revoked_at,last_used_at from opsvista_partner_keys
    where organization_id=${organizationId} order by created_at desc limit 100`;
  return rows.map(metadata);
}
export async function createPartnerKey(organizationId: string, createdBy: string, name: string) {
  await schema();
  const token = `ovp_${randomBytes(32).toString('base64url')}`, id = randomUUID();
  const row = await db().begin(async sql => {
    // Serialize issuance for this organization, including simultaneous clicks.
    await sql`select pg_advisory_xact_lock(hashtext(${`partner-keys:${organizationId}`}))`;
    const [count] = await sql`select count(*)::int as count from opsvista_partner_keys
      where organization_id=${organizationId} and revoked_at is null and expires_at>now()`;
    if (count.count >= 5) return null;
    const [created] = await sql`insert into opsvista_partner_keys (id,organization_id,name,token_hash,prefix,created_by,expires_at)
      values (${id},${organizationId},${name},${digest(token)},${token.slice(0,12)},${createdBy},now()+interval '90 days') returning *`;
    return created;
  });
  return row ? { key: metadata(row), token } : null;
}
export async function revokePartnerKey(organizationId: string, id: string) {
  await schema();
  const rows = await db()`update opsvista_partner_keys set revoked_at=coalesce(revoked_at,now())
    where organization_id=${organizationId} and id=${id} returning id`;
  return rows.length > 0;
}
export async function authenticatePartnerKey(header: unknown) {
  // API keys only: never accept a browser session, a query-string token or a client role.
  if (typeof header !== 'string' || !/^Bearer ovp_[A-Za-z0-9_-]{43}$/.test(header)) return null;
  await schema();
  const rows = await db()`select id,organization_id from opsvista_partner_keys
    where token_hash=${digest(header.slice(7))} and revoked_at is null and expires_at>now()
      and organization_id=${PUERTO_VALLARTA_ORG}`;
  return rows[0] ? { id: rows[0].id as string, organizationId: rows[0].organization_id as string } : null;
}
export async function reservePartnerRequest(id: string) {
  await schema();
  return db().begin(async sql => {
    // Lock the key so revocation and concurrent requests cannot skip quota checks.
    const keys = await sql`select id from opsvista_partner_keys where id=${id}
      and revoked_at is null and expires_at>now() for update`;
    if (!keys.length) return false;
    await sql`delete from opsvista_partner_usage where key_id=${id} and bucket < now()-interval '1 hour'`;
    const rows = await sql`insert into opsvista_partner_usage (key_id,bucket,requests)
      values (${id},date_trunc('minute',now()),1)
      on conflict(key_id,bucket) do update set requests=opsvista_partner_usage.requests+1
      where opsvista_partner_usage.requests<30 returning requests`;
    if (!rows.length) return false;
    await sql`update opsvista_partner_keys set last_used_at=now() where id=${id}`;
    return true;
  });
}
