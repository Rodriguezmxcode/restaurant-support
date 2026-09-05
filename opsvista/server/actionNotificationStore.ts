import postgres from 'postgres';
import type { SessionUser } from './authSession.js';
import type { ActionRecord } from './actionStore.js';

export type ActionReceiptStatus =
  | 'Sent'
  | 'Push accepted'
  | 'Delivered'
  | 'Seen'
  | 'Accepted'
  | 'In progress'
  | 'Evidence submitted'
  | 'Verified'
  | 'Escalated';

export type ActionNotificationState = {
  actionId: string;
  recipientId: string;
  recipientName: string;
  latestStatus: ActionReceiptStatus;
  sentAt: string;
  acceptBy: string;
  deliveredAt?: string;
  seenAt?: string;
  acceptedAt?: string;
  updatedAt: string;
};

export type ActionReceiptEvent = {
  id: string;
  actionId: string;
  recipientId: string;
  recipientName: string;
  status: ActionReceiptStatus;
  at: string;
  actorId: string;
  actorName: string;
  note?: string;
};

type DeviceInput = {
  token: string;
  platform: 'ios' | 'android';
  deviceName?: string;
  appVersion?: string;
};

export type OperationalPushInput = {
  eventKey: string;
  category: 'sales' | 'labor' | 'tasks' | 'maintenance' | 'action';
  title: string;
  body: string;
  recipientIds: string[];
  location?: string;
  actionId?: string;
};

let client: ReturnType<typeof postgres> | undefined;
let initialized = false;
const databaseUrl = () => process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL || '';
function sql() {
  const url = databaseUrl();
  if (!url) throw new Error('OpsVista database URL is not configured');
  if (!client) client = postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10 });
  return client;
}

async function ensureSchema() {
  if (initialized) return;
  const db = sql();
  await db`create table if not exists opsvista_mobile_devices (
    token text primary key, organization_id text not null, user_id text not null, user_name text not null,
    platform text not null, device_name text, app_version text, active boolean not null default true,
    created_at timestamptz not null default now(), last_seen_at timestamptz not null default now()
  )`;
  await db`create table if not exists opsvista_action_notification_state (
    action_id text primary key, organization_id text not null, recipient_id text not null, recipient_name text not null,
    latest_status text not null, sent_at timestamptz not null, accept_by timestamptz not null,
    delivered_at timestamptz, seen_at timestamptz, accepted_at timestamptz, updated_at timestamptz not null default now()
  )`;
  await db`create table if not exists opsvista_action_notification_events (
    id text primary key, action_id text not null, organization_id text not null, recipient_id text not null,
    recipient_name text not null, status text not null, at timestamptz not null, actor_id text not null,
    actor_name text not null, note text
  )`;
  await db`create table if not exists opsvista_operational_notifications (
    event_key text primary key, organization_id text not null, category text not null, location text,
    title text not null, body text not null, recipient_ids jsonb not null default '[]'::jsonb,
    sent_at timestamptz not null default now(), push_devices integer not null default 0
  )`;
  await db`create index if not exists opsvista_mobile_devices_user_idx on opsvista_mobile_devices(organization_id,user_id,active)`;
  await db`create index if not exists opsvista_action_notification_events_idx on opsvista_action_notification_events(action_id,at desc)`;
  await db`create index if not exists opsvista_action_notification_accept_idx on opsvista_action_notification_state(organization_id,accept_by,latest_status)`;
  await db`create index if not exists opsvista_operational_notifications_org_idx on opsvista_operational_notifications(organization_id,sent_at desc)`;
  initialized = true;
}

const organization = (user: SessionUser) => user.organizationId || 'org-puerto-vallarta';
const eventId = () => `an-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : undefined;

function normalizeState(row: Record<string, unknown>): ActionNotificationState {
  return {
    actionId: String(row.action_id), recipientId: String(row.recipient_id), recipientName: String(row.recipient_name),
    latestStatus: String(row.latest_status) as ActionReceiptStatus, sentAt: new Date(String(row.sent_at)).toISOString(),
    acceptBy: new Date(String(row.accept_by)).toISOString(), deliveredAt: iso(row.delivered_at), seenAt: iso(row.seen_at),
    acceptedAt: iso(row.accepted_at), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function normalizeEvent(row: Record<string, unknown>): ActionReceiptEvent {
  return {
    id: String(row.id), actionId: String(row.action_id), recipientId: String(row.recipient_id),
    recipientName: String(row.recipient_name), status: String(row.status) as ActionReceiptStatus,
    at: new Date(String(row.at)).toISOString(), actorId: String(row.actor_id), actorName: String(row.actor_name),
    note: row.note ? String(row.note) : undefined,
  };
}

export async function registerMobileDevice(input: DeviceInput, user: SessionUser) {
  await ensureSchema();
  const org = organization(user);
  await sql()`insert into opsvista_mobile_devices(token,organization_id,user_id,user_name,platform,device_name,app_version,active,last_seen_at)
    values(${input.token},${org},${user.id},${user.name},${input.platform},${input.deviceName ?? null},${input.appVersion ?? null},true,now())
    on conflict(token) do update set organization_id=excluded.organization_id,user_id=excluded.user_id,user_name=excluded.user_name,
    platform=excluded.platform,device_name=excluded.device_name,app_version=excluded.app_version,active=true,last_seen_at=now()`;
  return { registered: true, userId: user.id, platform: input.platform };
}

/**
 * Sends a deduplicated operational event to every active device registered to
 * the selected users. The event key makes repeated scans safe: the same alert
 * is recorded and pushed only once.
 */
export async function dispatchOperationalPush(input: OperationalPushInput, actor: SessionUser) {
  await ensureSchema();
  const recipientIds = Array.from(new Set(input.recipientIds.map(value => value.trim()).filter(Boolean)));
  if (!recipientIds.length) return { sent: false, reason: 'No recipients selected', devices: 0 };
  const db = sql();
  const inserted = await db`insert into opsvista_operational_notifications
    (event_key,organization_id,category,location,title,body,recipient_ids)
    values(${input.eventKey},${organization(actor)},${input.category},${input.location ?? null},${input.title},${input.body},${db.json(recipientIds)})
    on conflict(event_key) do nothing returning event_key`;
  if (!inserted.length) return { sent: false, duplicate: true, devices: 0 };
  const devices = await db`select token,user_id from opsvista_mobile_devices
    where organization_id=${organization(actor)} and user_id in ${db(recipientIds)} and active=true`;
  if (!devices.length) return { sent: true, pushAccepted: false, devices: 0 };
  const messages = devices.map(row => ({
    to: String(row.token), sound: 'default', title: input.title, body: input.body,
    priority: 'high', channelId: 'opsvista-actions',
    data: { type: 'operational_alert', category: input.category, location: input.location, actionId: input.actionId },
  }));
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    const response = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(messages) });
    if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
    await db`update opsvista_operational_notifications set push_devices=${devices.length} where event_key=${input.eventKey}`;
    return { sent: true, pushAccepted: true, devices: devices.length };
  } catch (error) {
    return { sent: true, pushAccepted: false, devices: devices.length, warning: error instanceof Error ? error.message : 'Push unavailable' };
  }
}

async function appendEvent(actionId: string, recipientId: string, recipientName: string, status: ActionReceiptStatus, actor: SessionUser, note?: string) {
  const at = new Date().toISOString();
  await sql()`insert into opsvista_action_notification_events(id,action_id,organization_id,recipient_id,recipient_name,status,at,actor_id,actor_name,note)
    values(${eventId()},${actionId},${organization(actor)},${recipientId},${recipientName},${status},${at},${actor.id},${actor.name},${note ?? null})`;
  return at;
}

export async function dispatchActionPush(action: ActionRecord, actor: SessionUser, acceptWithinMinutes = 30) {
  await ensureSchema();
  if (!action.ownerId || !action.ownerName) return { sent: false, reason: 'Action has no responsible user' };
  const db = sql();
  const sentAt = new Date();
  const acceptBy = new Date(sentAt.getTime() + Math.max(5, acceptWithinMinutes) * 60_000);
  await db`insert into opsvista_action_notification_state(action_id,organization_id,recipient_id,recipient_name,latest_status,sent_at,accept_by,updated_at)
    values(${action.id},${action.organizationId},${action.ownerId},${action.ownerName},'Sent',${sentAt.toISOString()},${acceptBy.toISOString()},now())
    on conflict(action_id) do update set recipient_id=excluded.recipient_id,recipient_name=excluded.recipient_name,
    latest_status='Sent',sent_at=excluded.sent_at,accept_by=excluded.accept_by,delivered_at=null,seen_at=null,accepted_at=null,updated_at=now()`;
  await appendEvent(action.id, action.ownerId, action.ownerName, 'Sent', actor, `Accept by ${acceptBy.toISOString()}`);
  const devices = await db`select token from opsvista_mobile_devices where organization_id=${action.organizationId} and user_id=${action.ownerId} and active=true`;
  if (!devices.length) return { sent: true, pushAccepted: false, devices: 0, acceptBy: acceptBy.toISOString() };
  const messages = devices.map(row => ({
    to: String(row.token), sound: 'default', title: `${action.location}: ${action.title}`,
    body: action.recommendation, priority: 'high', channelId: 'opsvista-actions',
    data: { type: 'action_assignment', actionId: action.id, location: action.location },
  }));
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    const response = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(messages) });
    if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
    await db`update opsvista_action_notification_state set latest_status='Push accepted',updated_at=now() where action_id=${action.id}`;
    await appendEvent(action.id, action.ownerId, action.ownerName, 'Push accepted', actor, `${devices.length} registered device${devices.length === 1 ? '' : 's'}`);
    return { sent: true, pushAccepted: true, devices: devices.length, acceptBy: acceptBy.toISOString() };
  } catch (error) {
    return { sent: true, pushAccepted: false, devices: devices.length, acceptBy: acceptBy.toISOString(), warning: error instanceof Error ? error.message : 'Push unavailable' };
  }
}

export async function recordActionReceipt(action: ActionRecord, status: ActionReceiptStatus, actor: SessionUser, note?: string) {
  await ensureSchema();
  if (!action.ownerId || !action.ownerName) throw new Error('Action has no responsible user');
  if (actor.id !== action.ownerId && !['Founder', 'Corporate'].includes(actor.role)) throw new Error('Only the responsible user can update this assignment receipt');
  const allowed: ActionReceiptStatus[] = ['Delivered', 'Seen', 'Accepted', 'In progress', 'Evidence submitted', 'Verified'];
  if (!allowed.includes(status)) throw new Error('Unsupported assignment receipt');
  const at = await appendEvent(action.id, action.ownerId, action.ownerName, status, actor, note);
  await sql()`update opsvista_action_notification_state set latest_status=${status},
    delivered_at=case when ${status}='Delivered' then ${at} else delivered_at end,
    seen_at=case when ${status}='Seen' then ${at} else seen_at end,
    accepted_at=case when ${status}='Accepted' then ${at} else accepted_at end,
    updated_at=now() where action_id=${action.id}`;
  return getActionNotification(action.id, actor);
}

export async function getActionNotification(actionId: string, user: SessionUser) {
  await ensureSchema();
  const states = await sql()`select * from opsvista_action_notification_state where action_id=${actionId} and organization_id=${organization(user)} limit 1`;
  const events = await sql()`select * from opsvista_action_notification_events where action_id=${actionId} and organization_id=${organization(user)} order by at desc`;
  return { state: states[0] ? normalizeState(states[0]) : null, events: events.map(row => normalizeEvent(row)) };
}

export async function escalateUnacceptedActions(actor: SessionUser) {
  await ensureSchema();
  const db = sql();
  const rows = await db`select * from opsvista_action_notification_state where organization_id=${organization(actor)} and accept_by<now() and latest_status not in ('Accepted','In progress','Evidence submitted','Verified','Escalated')`;
  for (const row of rows) {
    await db`update opsvista_action_notification_state set latest_status='Escalated',updated_at=now() where action_id=${String(row.action_id)}`;
    await appendEvent(String(row.action_id), String(row.recipient_id), String(row.recipient_name), 'Escalated', actor, 'Acceptance deadline expired; corporate follow-up required');
  }
  return { escalated: rows.length };
}
