import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';

export type SourceParams = { start?: string; end?: string; location?: string; kind?: 'vendors' | 'accounts' };
export type SourceProvider = 'r365-beverage' | 'toast-beverage' | 'r365-ap' | 'r365-ledger' | 'r365-catalog';
export type SourceJob = { organizationId: string; key: string; provider: SourceProvider; params: SourceParams; payload: any; refreshedAt?: string; lastError?: string; due: boolean; lease?: string };
export type SourceMemory = { stored: boolean; updatedAt?: string; pending: boolean; error?: string };
let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<void> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('No está disponible el guardado permanente de OpsVista');
  return client ||= postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10 });
}
async function schema() {
  if (!ready) ready = (async () => {
    await db()`create table if not exists opsvista_source_cache (
      organization_id text not null, source_key text not null, provider text not null, params jsonb not null,
      payload jsonb, refreshed_at timestamptz, requested_at timestamptz not null default now(),
      next_refresh_at timestamptz not null default now(), dirty_at timestamptz,
      last_error text, lease_token text, lease_until timestamptz,
      primary key (organization_id, source_key))`;
    await db()`create index if not exists opsvista_source_cache_due on opsvista_source_cache(next_refresh_at)`;
  })().catch(error => { ready = undefined; throw error; });
  await ready;
}
export function sourceKey(provider: SourceProvider, params: SourceParams) {
  return `${provider}:${createHash('sha256').update(JSON.stringify([params.start || '', params.end || '', params.location || '', params.kind || ''])).digest('hex')}`;
}
function job(row: any): SourceJob {
  return { organizationId: row.organization_id, key: row.source_key, provider: row.provider, params: row.params,
    payload: row.payload, refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).toISOString() : undefined,
    lastError: row.last_error || undefined, due: new Date(row.next_refresh_at).getTime() <= Date.now(), lease: row.lease_token };
}
// A fixed UTC time keeps a 24-hour cadence and falls overnight in Connecticut
// throughout both daylight and standard time (03:30 / 02:30).
export function nextNight(now = new Date()) {
  const next = new Date(now); next.setUTCHours(7, 30, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
export async function registerSource(organizationId: string, provider: SourceProvider, params: SourceParams): Promise<SourceJob> {
  await schema(); const key = sourceKey(provider, params);
  const rows = await db()`insert into opsvista_source_cache (organization_id,source_key,provider,params)
    values (${organizationId},${key},${provider},${db().json(params)})
    on conflict (organization_id,source_key) do update set requested_at=now() returning *`;
  return job(rows[0]);
}
export async function claimSource(organizationId: string, key?: string): Promise<SourceJob | null> {
  await schema(); const token = randomUUID();
  const rows = await db()`update opsvista_source_cache set lease_token=${token},lease_until=now()+interval '150 seconds'
    where (organization_id,source_key) = (select organization_id,source_key from opsvista_source_cache
      where organization_id=${organizationId} and (${key || null}::text is null or source_key=${key || ''})
      and (lease_until is null or lease_until < now()) and (next_refresh_at<=now() or ${Boolean(key)})
      order by next_refresh_at,source_key for update skip locked limit 1) returning *`;
  return rows[0] ? job(rows[0]) : null;
}
export async function finishSource(source: SourceJob, payload: unknown, startedAt: string) {
  await schema();
  const rows = await db()`update opsvista_source_cache set payload=${db().json(payload as never)},refreshed_at=now(),
    last_error=null,lease_token=null,lease_until=null,
    next_refresh_at=case when dirty_at>${startedAt}::timestamptz then now() else ${nextNight()}::timestamptz end
    where organization_id=${source.organizationId} and source_key=${source.key} and lease_token=${source.lease!} returning *`;
  if (!rows[0]) throw new Error('La sincronización fue reemplazada por otra actualización');
  return job(rows[0]);
}
export async function failSource(source: SourceJob, error: string) {
  await db()`update opsvista_source_cache set last_error=${error},lease_token=null,lease_until=null,
    next_refresh_at=now()+interval '30 minutes'
    where organization_id=${source.organizationId} and source_key=${source.key} and lease_token=${source.lease!}`;
}
export async function dirtyR365Sources(organizationId: string) {
  await schema();
  await db()`update opsvista_source_cache set dirty_at=now(),next_refresh_at=now()
    where organization_id=${organizationId} and provider like 'r365-%'`;
}
export async function sourceQueueStatus(organizationId: string) {
  await schema(); const [row] = await db()`select count(*)::int as tracked,
    count(*) filter (where payload is not null)::int as stored,
    count(*) filter (where next_refresh_at<=now() and (lease_until is null or lease_until<now()))::int as remaining,
    count(*) filter (where last_error is not null)::int as errors,
    min(refreshed_at) as oldest_update, max(refreshed_at) as latest_update
    from opsvista_source_cache where organization_id=${organizationId}`;
  return row;
}

export async function executeSource(source: SourceJob, loader: (job: SourceJob) => Promise<any>): Promise<SourceJob> {
  const startedAt = new Date().toISOString();
  try {
    const payload = await loader(source);
    if (payload?.error) throw new Error(payload.error);
    return await finishSource(source, payload, startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fuente no disponible';
    await failSource(source, message);
    // Never replace a successful snapshot with an empty response on failure.
    return { ...source, lastError: message, due: true };
  }
}
export function sourceMemory(source: SourceJob): SourceMemory {
  return { stored: source.payload !== null && source.payload !== undefined, updatedAt: source.refreshedAt,
    pending: source.due || Boolean(source.lastError), error: source.lastError };
}
export async function cachedSource<T>(organizationId: string, provider: SourceProvider, params: SourceParams,
  loader: (job: SourceJob) => Promise<T>, refresh = false,
  seed?: () => Promise<{ payload: T; updatedAt: string } | null>): Promise<{ data: T | null; memory: SourceMemory }> {
  let source = await registerSource(organizationId, provider, params);
  if (source.payload === null && seed) {
    const previous = await seed();
    if (previous) {
      const rows = await db()`update opsvista_source_cache set payload=${db().json(previous.payload as never)},refreshed_at=${previous.updatedAt}::timestamptz
        where organization_id=${organizationId} and source_key=${source.key} and payload is null returning *`;
      if (rows[0]) source = job(rows[0]);
    }
  }
  if (refresh || source.payload === null) {
    const claimed = await claimSource(organizationId, source.key);
    if (claimed) source = await executeSource(claimed, loader);
  }
  return { data: source.payload as T | null, memory: sourceMemory(source) };
}

export async function withSyncLease<T>(organizationId: string, run: () => Promise<T>): Promise<T | null> {
  await schema();
  await db()`create table if not exists opsvista_source_sync_leases (organization_id text primary key, token text not null, expires_at timestamptz not null)`;
  const token = randomUUID();
  const rows = await db()`insert into opsvista_source_sync_leases values (${organizationId},${token},now()+interval '115 seconds')
    on conflict (organization_id) do update set token=excluded.token,expires_at=excluded.expires_at
    where opsvista_source_sync_leases.expires_at<now() returning token`;
  if (!rows.length) return null;
  try { return await run(); }
  finally { await db()`delete from opsvista_source_sync_leases where organization_id=${organizationId} and token=${token}`; }
}
