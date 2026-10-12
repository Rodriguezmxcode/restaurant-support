import { createHmac, randomInt, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import type { SessionUser, PushAssurance } from './authSession.js';
import { validateWebSubscription, type WebSubscription } from './webPushDelivery.js';
import { sendLoginPush } from './webPushStore.js';

let client: ReturnType<typeof postgres> | undefined;
let schema: Promise<void> | undefined;
const organization = (user: SessionUser) => user.organizationId || 'org-puerto-vallarta';
function sql() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Security storage unavailable');
  return client ||= postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10 });
}
function digest(purpose: string, value: string) {
  const secret = process.env.OPSVISTA_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Security signing unavailable');
  return createHmac('sha256', secret).update(`opsvista-push-mfa:${purpose}:${value}`).digest('hex');
}
function matches(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export class PushMfaError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
async function ensureSchema() {
  if (!schema) schema = (async () => {
    const db = sql();
    await db`create table if not exists opsvista_push_mfa_devices (
      organization_id text not null, user_id text not null, id text not null unique,
      endpoint text not null unique, subscription jsonb not null, locale text not null,
      recovery_hashes jsonb not null default '[]', created_at timestamptz not null default now(),
      primary key(organization_id,user_id)
    )`;
    await db`create table if not exists opsvista_push_mfa_limits (
      organization_id text not null,user_id text not null,last_sent_at timestamptz,
      window_started_at timestamptz not null default now(),send_count integer not null default 0,
      recovery_attempts integer not null default 0, primary key(organization_id,user_id)
    )`;
    await db`create table if not exists opsvista_push_mfa_challenges (
      id text primary key,organization_id text not null,user_id text not null,session_id text not null,
      purpose text not null,device_id text,code_hash text not null,subscription jsonb,locale text,
      expires_at timestamptz not null,attempts integer not null default 0,used_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await db`create index if not exists opsvista_push_mfa_challenge_owner on opsvista_push_mfa_challenges(organization_id,user_id)`;
    // This database is also the operational store. Never expose security tables
    // through a Supabase Data API role if the database is later moved there.
    for (const table of ['opsvista_push_mfa_devices','opsvista_push_mfa_limits','opsvista_push_mfa_challenges']) {
      await db.unsafe(`alter table ${table} enable row level security`);
    }
  })().catch(error => { schema = undefined; throw error; });
  return schema;
}
export async function pushMfaDevice(user: SessionUser) {
  await ensureSchema();
  const rows = await sql()`select id,endpoint from opsvista_push_mfa_devices where organization_id=${organization(user)} and user_id=${user.id}`;
  return rows[0] ? { id: String(rows[0].id), endpoint: String(rows[0].endpoint) } : null;
}
export async function validPushAssurance(user: SessionUser, sessionId: string, proof?: PushAssurance) {
  if (!proof || proof.sessionId !== sessionId || proof.verifiedAt > Date.now() || Date.now() - proof.verifiedAt > 12 * 60 * 60 * 1000) return false;
  return (await pushMfaDevice(user))?.id === proof.deviceId;
}

// Account-scoped locking and quotas apply across all sessions and server instances.
// A password holder cannot evade limits by creating new browser sessions.
async function lockAccount(db: postgres.TransactionSql, user: SessionUser) {
  const org = organization(user);
  await db`insert into opsvista_push_mfa_limits(organization_id,user_id) values(${org},${user.id}) on conflict do nothing`;
  await db`select user_id from opsvista_push_mfa_limits where organization_id=${org} and user_id=${user.id} for update`;
  await db`update opsvista_push_mfa_limits set window_started_at=now(),send_count=0,recovery_attempts=0
    where organization_id=${org} and user_id=${user.id} and window_started_at < now()-interval '1 hour'`;
}
export async function startPushChallenge(user: SessionUser, sessionId: string, enrollment?: { subscription: unknown; locale: string }) {
  await ensureSchema();
  const subscription = enrollment ? validateWebSubscription(enrollment.subscription) : null;
  const org = organization(user), id = randomUUID(), code = String(randomInt(0, 1000000)).padStart(6, '0');
  const result = await sql().begin(async db => {
    await lockAccount(db, user);
    const devices = await db`select * from opsvista_push_mfa_devices where organization_id=${org} and user_id=${user.id}`;
    const device = devices[0];
    if (!enrollment && !device) throw new PushMfaError('device_not_linked', 409);
    if (subscription) {
      const owners = await db`select user_id from opsvista_push_mfa_devices where endpoint=${subscription.endpoint} and (organization_id<>${org} or user_id<>${user.id})`;
      if (owners.length) throw new PushMfaError('device_in_use', 409);
    }
    const allowed = await db`update opsvista_push_mfa_limits set last_sent_at=now(),send_count=send_count+1
      where organization_id=${org} and user_id=${user.id} and send_count<10
      and (last_sent_at is null or last_sent_at<now()-interval '60 seconds') returning user_id`;
    if (!allowed.length) throw new PushMfaError('rate_limited', 429);
    await db`delete from opsvista_push_mfa_challenges where organization_id=${org} and user_id=${user.id} and expires_at<now()-interval '1 day'`;
    const purpose = enrollment ? 'enroll' : 'login';
    // Resending invalidates only this session's prior challenge of the same kind.
    await db`update opsvista_push_mfa_challenges set used_at=now() where organization_id=${org} and user_id=${user.id}
      and session_id=${sessionId} and purpose=${purpose} and used_at is null`;
    const destination: WebSubscription = subscription || device.subscription;
    const locale = enrollment?.locale === 'es' ? 'es' : enrollment ? 'en' : String(device.locale);
    await db`insert into opsvista_push_mfa_challenges(id,organization_id,user_id,session_id,purpose,device_id,code_hash,subscription,locale,expires_at)
      values(${id},${org},${user.id},${sessionId},${purpose},${device?.id || null},${digest(id, code)},
        ${subscription ? db.json(subscription) : null},${locale},now()+interval '5 minutes')`;
    return { destination, locale };
  });
  const delivery = await sendLoginPush(result.destination, code, result.locale, id);
  if (!delivery.accepted) {
    await sql()`update opsvista_push_mfa_challenges set used_at=now() where id=${id}`;
    throw new PushMfaError('delivery_unconfirmed', 503);
  }
  return { challengeId: id, expiresIn: 300, retryAfter: 60 };
}
export async function verifyPushChallenge(user: SessionUser, sessionId: string, id: string, code: string, purpose: 'login' | 'enroll') {
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^\d{6}$/.test(code)) throw new PushMfaError('invalid_code');
  await ensureSchema();
  const org = organization(user);
  const result = await sql().begin(async db => {
    await lockAccount(db, user);
    const rows = await db`select * from opsvista_push_mfa_challenges where id=${id} and organization_id=${org}
      and user_id=${user.id} and session_id=${sessionId} and purpose=${purpose} and used_at is null and expires_at>now() and attempts<5 for update`;
    if (!rows.length) return null;
    const challenge = rows[0];
    await db`update opsvista_push_mfa_challenges set attempts=attempts+1 where id=${id}`;
    if (!matches(String(challenge.code_hash), digest(id, code))) return null;
    const devices = await db`select id from opsvista_push_mfa_devices where organization_id=${org} and user_id=${user.id}`;
    if ((devices[0]?.id || null) !== challenge.device_id) return null;
    await db`update opsvista_push_mfa_challenges set used_at=now() where id=${id}`;
    let deviceId = String(challenge.device_id), recoveryCodes: string[] | undefined;
    if (purpose === 'enroll') {
      const destination = validateWebSubscription(challenge.subscription);
      deviceId = randomUUID();
      recoveryCodes = Array.from({ length: 8 }, () => randomBytes(10).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'));
      const hashes = recoveryCodes.map(value => digest(`recovery:${org}:${user.id}`, value.replace(/-/g, '')));
      await db`insert into opsvista_push_mfa_devices(organization_id,user_id,id,endpoint,subscription,locale,recovery_hashes)
        values(${org},${user.id},${deviceId},${destination.endpoint},${db.json(destination)},${String(challenge.locale)},${db.json(hashes)})
        on conflict(organization_id,user_id) do update set id=excluded.id,endpoint=excluded.endpoint,subscription=excluded.subscription,
          locale=excluded.locale,recovery_hashes=excluded.recovery_hashes,created_at=now()`;
    }
    return { proof: { sessionId, deviceId, verifiedAt: Date.now() }, ...(recoveryCodes ? { recoveryCodes } : {}) };
  });
  if (!result) throw new PushMfaError('invalid_code');
  return result;
}
export async function verifyRecoveryCode(user: SessionUser, sessionId: string, code: string) {
  const normalized = code.replace(/[-\s]/g, '').toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(normalized)) throw new PushMfaError('invalid_recovery_code');
  await ensureSchema();
  const org = organization(user);
  const result = await sql().begin(async db => {
    await lockAccount(db, user);
    const allowed = await db`update opsvista_push_mfa_limits set recovery_attempts=recovery_attempts+1
      where organization_id=${org} and user_id=${user.id} and recovery_attempts<5 returning user_id`;
    if (!allowed.length) return { rateLimited: true as const };
    const rows = await db`select id,recovery_hashes from opsvista_push_mfa_devices where organization_id=${org} and user_id=${user.id} for update`;
    if (!rows.length) return null;
    const hashes = rows[0].recovery_hashes as string[], candidate = digest(`recovery:${org}:${user.id}`, normalized);
    const index = hashes.findIndex(value => matches(value, candidate));
    if (index < 0) return null;
    hashes.splice(index, 1);
    await db`update opsvista_push_mfa_devices set recovery_hashes=${db.json(hashes)} where organization_id=${org} and user_id=${user.id}`;
    return { proof: { sessionId, deviceId: String(rows[0].id), verifiedAt: Date.now() } };
  });
  if (result && 'rateLimited' in result) throw new PushMfaError('rate_limited', 429);
  if (!result) throw new PushMfaError('invalid_recovery_code');
  return result.proof;
}
