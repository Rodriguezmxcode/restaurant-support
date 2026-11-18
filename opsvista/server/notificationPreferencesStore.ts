import postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
import type { SessionUser } from './authSession.js';
import { alertLocations } from '../shared/operationalAlerts.js';
import { defaultNotificationPreferences, digestDueAt, effectivePushScope, locationKey, notificationCategories, notificationCategory, pushDecision, type NotificationPreferences, type PushEvent } from '../shared/notificationPreferences.js';

let client: ReturnType<typeof postgres> | undefined;
let schema: Promise<void> | undefined;
export const preferenceOrganization = (user: SessionUser) => user.organizationId || 'org-puerto-vallarta';
function sql() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Notification preferences unavailable');
  return client ||= postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10 });
}
export async function ensureNotificationPreferences() {
  if (!schema) schema = (async () => {
    const db = sql();
    await db`create table if not exists opsvista_notification_preferences (
      organization_id text not null, user_id text not null, email_enabled boolean not null default true,
      push_enabled boolean not null default true, sms_enabled boolean not null default false, phone text,
      updated_at timestamptz not null default now(), primary key(organization_id,user_id))`;
    await db`alter table opsvista_notification_preferences add column if not exists push_categories jsonb not null default '{}'::jsonb,
      add column if not exists push_locations jsonb, add column if not exists push_time_zone text not null default 'America/New_York',
      add column if not exists push_locale text not null default 'en', add column if not exists revision integer not null default 0`;
    await db`create table if not exists opsvista_notification_preference_audit (
      id text primary key, organization_id text not null, user_id text not null, changed_by text not null,
      changed_at timestamptz not null default now(), old_value jsonb not null, new_value jsonb not null)`;
    await db`create index if not exists opsvista_notification_preference_audit_user on opsvista_notification_preference_audit(organization_id,user_id,changed_at desc)`;
    await db`create table if not exists opsvista_push_digest (
      organization_id text not null, user_id text not null, event_key text not null, payload jsonb not null,
      mode text not null, due_at timestamptz not null, status text not null default 'pending',
      lease_token text, lease_until timestamptz, attempts integer not null default 0,
      created_at timestamptz not null default now(), accepted_at timestamptz,
      primary key(organization_id,user_id,event_key))`;
    await db`create index if not exists opsvista_push_digest_due on opsvista_push_digest(status,due_at)`;
  })().catch(error => { schema = undefined; throw error; });
  return schema;
}
export function preferencesFromRow(row?: Record<string, unknown>): NotificationPreferences {
  const defaults = defaultNotificationPreferences();
  if (!row) return defaults;
  const categories = { ...defaults.categories };
  const saved = row.push_categories as Record<string, unknown> || {};
  for (const key of notificationCategories) if (['instant', 'daily', 'off', ...(key === 'reports' ? ['weekly'] : [])].includes(String(saved[key]))) categories[key] = saved[key] as typeof categories[typeof key];
  categories.critical = 'instant';
  return { ...defaults, emailEnabled: row.email_enabled !== false, pushEnabled: row.push_enabled !== false, smsEnabled: row.sms_enabled === true,
    phone: row.phone ? String(row.phone) : undefined, categories, locations: Array.isArray(row.push_locations) ? row.push_locations as string[] : null,
    timeZone: String(row.push_time_zone || defaults.timeZone), locale: row.push_locale === 'es' ? 'es' : 'en', revision: Number(row.revision) || 0 };
}
export async function getNotificationPreferences(user: SessionUser) {
  await ensureNotificationPreferences();
  const rows = await sql()`select * from opsvista_notification_preferences where organization_id=${preferenceOrganization(user)} and user_id=${user.id}`;
  return preferencesFromRow(rows[0]);
}
export class PreferenceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function pushRecipientRows(userIds: string[], organizationId: string) {
  await ensureNotificationPreferences();
  if (!userIds.length) return [];
  const db = sql();
  const rows = await db`select u.id,u.role,u.locations,u.location_grants,p.*,
      u.id as recipient_id,u.organization_id as recipient_organization,
      case when u.organization_id='org-puerto-vallarta' then ${db.json([...alertLocations, 'Corporate Office'])}::jsonb else o.locations end as organization_locations
    from opsvista_management_users u
    left join opsvista_notification_preferences p on p.organization_id=u.organization_id and p.user_id=u.id
    left join opsvista_organizations o on o.id=u.organization_id
    where u.organization_id=${organizationId} and u.id in ${db(userIds)} and u.active=true
      and (u.organization_id='org-puerto-vallarta' or (o.status='active' and exists (
        select 1 from opsvista_organization_memberships m where m.user_id=u.id and m.organization_id=u.organization_id)))`;
  return rows;
}
export async function preferenceContext(user: SessionUser) {
  const rows = await pushRecipientRows([user.id], preferenceOrganization(user));
  const row = rows[0];
  if (!row || row.role !== user.role) throw new PreferenceError('Active account required', 403);
  return { preferences: preferencesFromRow(row), ...effectivePushScope(row) };
}
export async function updateNotificationPreferences(input: Partial<NotificationPreferences>, user: SessionUser, allowedLocations?: string[]) {
  await ensureNotificationPreferences();
  const db = sql(), organizationId = preferenceOrganization(user);
  return db.begin(async tx => {
    await tx`insert into opsvista_notification_preferences(organization_id,user_id) values(${organizationId},${user.id}) on conflict do nothing`;
    const rows = await tx`select * from opsvista_notification_preferences where organization_id=${organizationId} and user_id=${user.id} for update`;
    const before = preferencesFromRow(rows[0]);
    if (input.revision !== undefined && input.revision !== before.revision) throw new PreferenceError('Preferences changed on another device. Reload and try again.', 409);
    const next = { ...before, categories: { ...before.categories } };
    for (const key of ['emailEnabled', 'pushEnabled', 'smsEnabled'] as const) if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new PreferenceError('Invalid preference');
      next[key] = input[key]!;
    }
    if (Object.hasOwn(input, 'phone')) {
      if (input.phone !== undefined && typeof input.phone !== 'string') throw new PreferenceError('Invalid phone');
      next.phone = input.phone?.trim().slice(0, 40) || undefined;
    }
    if (next.smsEnabled && !next.phone) throw new PreferenceError('A phone number is required to enable SMS');
    if (input.categories !== undefined) {
      if (!input.categories || Array.isArray(input.categories) || typeof input.categories !== 'object') throw new PreferenceError('Invalid categories');
      for (const [key, value] of Object.entries(input.categories)) {
        if (!notificationCategories.includes(key as typeof notificationCategories[number]) || !['instant', 'daily', 'off', ...(key === 'reports' ? ['weekly'] : [])].includes(value)) throw new PreferenceError('Invalid delivery mode');
        if (key === 'critical' && value !== 'instant') throw new PreferenceError('Critical alerts must stay instant');
        next.categories[key as typeof notificationCategories[number]] = value;
      }
    }
    if (input.locations !== undefined) {
      if (input.locations === null) next.locations = null;
      else {
        if (!Array.isArray(input.locations) || !allowedLocations || input.locations.length > 10000 || input.locations.some(value => typeof value !== 'string' || !allowedLocations.some(allowed => locationKey(allowed) === locationKey(value)))) throw new PreferenceError('Location not authorized', 403);
        next.locations = [...new Set(input.locations.map(value => allowedLocations.find(allowed => locationKey(allowed) === locationKey(value))!))];
      }
    }
    if (input.timeZone !== undefined) {
      if (typeof input.timeZone !== 'string' || input.timeZone.length > 100) throw new PreferenceError('Invalid time zone');
      try { new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(); } catch { throw new PreferenceError('Invalid time zone'); }
      next.timeZone = input.timeZone;
    }
    if (input.locale !== undefined) {
      if (!['en', 'es'].includes(input.locale)) throw new PreferenceError('Invalid language');
      next.locale = input.locale;
    }
    next.revision++;
    await tx`update opsvista_notification_preferences set email_enabled=${next.emailEnabled},push_enabled=${next.pushEnabled},sms_enabled=${next.smsEnabled},phone=${next.phone || null},
      push_categories=${tx.json(next.categories)},push_locations=${next.locations === null ? null : tx.json(next.locations)},push_time_zone=${next.timeZone},push_locale=${next.locale},revision=${next.revision},updated_at=now()
      where organization_id=${organizationId} and user_id=${user.id}`;
    await tx`insert into opsvista_notification_preference_audit(id,organization_id,user_id,changed_by,old_value,new_value)
      values(${randomUUID()},${organizationId},${user.id},${user.id},${tx.json(before)},${tx.json(next)})`;
    return next;
  });
}
export async function routePushRecipients(userIds: string[], actor: SessionUser, event: PushEvent) {
  const org = preferenceOrganization(actor), db = sql();
  const rows = await pushRecipientRows(userIds, org);
  const instant: string[] = [];
  let queued = 0, suppressed = userIds.length - rows.length;
  for (const row of rows) {
    const preferences = preferencesFromRow(row), scope = effectivePushScope(row);
    const mode = pushDecision(preferences, event, scope.allowedLocations, scope.globalRole);
    const id = String(row.recipient_id);
    if (mode === 'instant') instant.push(id);
    else if (mode === 'off') suppressed++;
    else {
      const eventKey = event.tag || createHash('sha256').update(JSON.stringify(event)).digest('hex');
      await db`insert into opsvista_push_digest(organization_id,user_id,event_key,payload,mode,due_at)
        values(${org},${id},${eventKey},${db.json({ ...event, category: notificationCategory(event.category) })},${mode},${digestDueAt(mode, preferences.timeZone)}) on conflict do nothing`;
      queued++;
    }
  }
  return { instant, queued, suppressed };
}
export async function claimPushDigests(now = new Date()) {
  await ensureNotificationPreferences(); const db = sql(), token = randomUUID();
  const rows = await db`update opsvista_push_digest set lease_token=${token},lease_until=${new Date(now.getTime() + 300000).toISOString()},attempts=attempts+1
    where (organization_id,user_id,event_key) in (select organization_id,user_id,event_key from opsvista_push_digest
      where status='pending' and due_at<=${now.toISOString()} and attempts<5 and (lease_until is null or lease_until<${now.toISOString()})
      order by due_at limit 200 for update skip locked) returning *`;
  return { token, rows };
}
export async function finishPushDigest(row: Record<string, unknown>, token: string, status: 'accepted' | 'suppressed' | 'retry') {
  await sql()`update opsvista_push_digest set status=${status === 'retry' ? (Number(row.attempts) >= 5 ? 'failed' : 'pending') : status},
    lease_until=case when ${status}='retry' then now()+interval '30 minutes' else null end,
    accepted_at=case when ${status}='accepted' then now() else null end
    where organization_id=${String(row.organization_id)} and user_id=${String(row.user_id)} and event_key=${String(row.event_key)} and lease_token=${token} and status='pending'`;
}
