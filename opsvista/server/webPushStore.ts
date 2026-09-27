import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import webpush from 'web-push';
import type { SessionUser } from './authSession.js';
import { deliverWebPush, pushPayload, validateWebSubscription, type PushKeys } from './webPushDelivery.js';

let client: ReturnType<typeof postgres> | undefined;
let schema: Promise<void> | undefined;
let keysPromise: Promise<PushKeys> | undefined;
function sql() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Push storage unavailable');
  return client ||= postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10 });
}
const org = (user: SessionUser) => user.organizationId || 'org-puerto-vallarta';
function encryptionKey() {
  const secret = process.env.OPSVISTA_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Push signing unavailable');
  return createHash('sha256').update(`opsvista-web-push:${secret}`).digest();
}
function seal(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.');
}
function open(value: string) {
  const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
async function ensureSchema() {
  if (!schema) schema = (async () => {
    const db = sql();
    await db`create table if not exists opsvista_web_push_keys (
      id text primary key, public_key text not null, private_key_encrypted text not null, created_at timestamptz not null default now()
    )`;
    await db`create table if not exists opsvista_web_push_subscriptions (
      endpoint text primary key, organization_id text not null, user_id text not null,
      p256dh text not null, auth text not null, locale text not null default 'en',
      active boolean not null default true, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), last_test_at timestamptz
    )`;
    await db`create index if not exists opsvista_web_push_user_idx on opsvista_web_push_subscriptions(organization_id,user_id,active)`;
  })().catch(error => { schema = undefined; throw error; });
  return schema;
}
async function signingKeys(): Promise<PushKeys> {
  if (!keysPromise) keysPromise = (async () => {
    await ensureSchema();
    const db = sql();
    let rows = await db`select public_key,private_key_encrypted from opsvista_web_push_keys where id='v1'`;
    if (!rows.length) {
      const generated = webpush.generateVAPIDKeys();
      await db`insert into opsvista_web_push_keys(id,public_key,private_key_encrypted)
        values('v1',${generated.publicKey},${seal(generated.privateKey)}) on conflict(id) do nothing`;
      rows = await db`select public_key,private_key_encrypted from opsvista_web_push_keys where id='v1'`;
    }
    return { publicKey: String(rows[0].public_key), privateKey: open(String(rows[0].private_key_encrypted)) };
  })().catch(error => { keysPromise = undefined; throw error; });
  return keysPromise;
}
export async function webPushPublicKey() { return (await signingKeys()).publicKey; }

// Security delivery uses an independently verified device, never the operational
// subscriber list or its preference settings. The code is never logged.
export async function sendLoginPush(subscription: Parameters<typeof deliverWebPush>[0], code: string, locale: string, challengeId: string) {
  const es = locale === 'es';
  return deliverWebPush(subscription, await signingKeys(), {
    title: es ? 'OpsVista · Código de acceso' : 'OpsVista · Sign-in code',
    body: es ? `Tu código es ${code}. Vence en 5 minutos. No lo compartas. Si no intentaste entrar, ignora este aviso.` : `Your code is ${code}. Expires in 5 minutes. Do not share it. If you did not try to sign in, ignore this notice.`,
    urgency: 'high', tag: `opsvista-login-${challengeId}`, url: '/?login=1', ttlSeconds: 300, kind: 'login',
  });
}

export async function webPushRegistered(endpoint: string, user: SessionUser) {
  await ensureSchema();
  const rows = await sql()`select endpoint from opsvista_web_push_subscriptions where endpoint=${endpoint}
    and organization_id=${org(user)} and user_id=${user.id} and active=true`;
  return rows.length > 0;
}
export async function registerWebPush(value: unknown, locale: string, user: SessionUser) {
  const subscription = validateWebSubscription(value);
  await signingKeys();
  await sql()`insert into opsvista_web_push_subscriptions(endpoint,organization_id,user_id,p256dh,auth,locale)
    values(${subscription.endpoint},${org(user)},${user.id},${subscription.keys.p256dh},${subscription.keys.auth},${locale === 'es' ? 'es' : 'en'})
    on conflict(endpoint) do update set organization_id=excluded.organization_id,user_id=excluded.user_id,
      p256dh=excluded.p256dh,auth=excluded.auth,locale=excluded.locale,active=true,updated_at=now()`;
  return { registered: true };
}
export async function removeWebPush(endpoint: string, user: SessionUser) {
  await ensureSchema();
  await sql()`delete from opsvista_web_push_subscriptions where endpoint=${endpoint} and organization_id=${org(user)} and user_id=${user.id}`;
}

async function sendRows(rows: Record<string, unknown>[], input: Parameters<typeof pushPayload>[0]) {
  if (!rows.length) return { accepted: 0, devices: 0 };
  const keys = await signingKeys();
  let accepted = 0;
  // Bounded concurrency keeps a large team from exhausting database connections.
  for (let offset = 0; offset < rows.length; offset += 10) {
    const results = await Promise.all(rows.slice(offset, offset + 10).map(async row => {
      const result = await deliverWebPush({ endpoint: String(row.endpoint), keys: { p256dh: String(row.p256dh), auth: String(row.auth) } }, keys, pushPayload(input, String(row.locale)));
      if (result.expired) await sql()`delete from opsvista_web_push_subscriptions where endpoint=${String(row.endpoint)} and auth=${String(row.auth)}`;
      return result.accepted ? 1 : 0;
    }));
    accepted += results.reduce<number>((sum, value) => sum + value, 0);
  }
  return { accepted, devices: rows.length };
}

export async function sendWebPushToUsers(userIds: string[], actor: SessionUser, input: Parameters<typeof pushPayload>[0]) {
  if (!userIds.length) return { accepted: 0, devices: 0 };
  try {
    await ensureSchema();
    const db = sql();
    const rows = await db`select s.* from opsvista_web_push_subscriptions s
      join opsvista_management_users u on u.id=s.user_id and u.organization_id=s.organization_id and u.active=true
      left join opsvista_notification_preferences p on p.user_id=s.user_id and p.organization_id=s.organization_id
      where s.organization_id=${org(actor)} and s.user_id in ${db(userIds)} and s.active=true and coalesce(p.push_enabled,true)=true`;
    return await sendRows(rows, input);
  } catch { return { accepted: 0, devices: 0, unavailable: true }; }
}
export async function testWebPush(endpoint: string, user: SessionUser) {
  await ensureSchema();
  const db = sql();
  // An atomic reservation rate limits tests across concurrent server instances.
  const rows = await db`update opsvista_web_push_subscriptions set last_test_at=now()
    where endpoint=${endpoint} and organization_id=${org(user)} and user_id=${user.id} and active=true
      and (last_test_at is null or last_test_at < now()-interval '30 seconds') returning *`;
  if (!rows.length) return { accepted: false, reason: await webPushRegistered(endpoint, user) ? 'rate_limited' : 'not_registered' };
  const result = await sendRows(rows, { test: true, tag: `opsvista-test-${Date.now()}` });
  return { accepted: result.accepted === 1, reason: result.accepted ? 'provider_accepted' : 'delivery_unconfirmed' };
}
