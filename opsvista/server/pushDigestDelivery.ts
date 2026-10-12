import postgres from 'postgres';
import { claimPushDigests, finishPushDigest, preferencesFromRow, pushRecipientRows } from './notificationPreferencesStore.js';
import { effectivePushScope, pushDecision, type PushEvent } from '../shared/notificationPreferences.js';
import { sendWebPushDigest } from './webPushStore.js';

let client: ReturnType<typeof postgres> | undefined;
async function sendNativeDigest(userId: string, organizationId: string, event: PushEvent) {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Digest storage unavailable');
  const db = client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 });
  const table = await db`select to_regclass('opsvista_mobile_devices') as name`;
  if (!table[0]?.name) return { accepted: 0, devices: 0 };
  const devices = await db`select token from opsvista_mobile_devices where organization_id=${organizationId} and user_id=${userId} and active=true`;
  let accepted = 0;
  for (let i = 0; i < devices.length; i += 100) {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
      body: JSON.stringify(devices.slice(i, i + 100).map(row => ({ to: row.token, title: event.title, body: event.body, sound: 'default', data: { type: 'notification_digest' } }))),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Native digest unavailable');
    const result = await response.json() as { data?: { status?: string }[] };
    accepted += result.data?.filter(ticket => ticket.status === 'ok').length || 0;
  }
  return { accepted, devices: devices.length };
}

export async function flushPushDigests(now = new Date()) {
  const { token, rows } = await claimPushDigests(now);
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.organization_id, row.user_id, row.mode]);
    const group = groups.get(key) || []; group.push(row); groups.set(key, group);
  }
  let accepted = 0, suppressed = 0;
  for (const group of groups.values()) {
    try {
      const first = group[0], org = String(first.organization_id), userId = String(first.user_id);
      const recipients = await pushRecipientRows([userId], org), recipient = recipients[0];
      const preferences = preferencesFromRow(recipient), scope = recipient && effectivePushScope(recipient, now.getTime());
      const allowed = group.filter(row => recipient && scope && pushDecision(preferences, row.payload as PushEvent, scope.allowedLocations, scope.globalRole) !== 'off');
      for (const row of group.filter(row => !allowed.includes(row))) { await finishPushDigest(row, token, 'suppressed'); suppressed++; }
      if (!allowed.length) continue;
      const es = preferences.locale === 'es';
      const title = first.mode === 'weekly' ? (es ? 'Resumen del lunes' : 'Monday digest') : (es ? 'Resumen diario' : 'Daily digest');
      const body = `${allowed.length} ${es ? 'actualizaciones' : 'updates'} · ${allowed.slice(0, 3).map(row => (row.payload as PushEvent).title || (row.payload as PushEvent).category).join(' · ')}`.slice(0, 280);
      const event: PushEvent = { title, body, tag: `digest:${org}:${userId}:${first.mode}:${String(first.due_at)}`, priority: 'low' };
      const [web, native] = await Promise.allSettled([sendWebPushDigest(userId, org, event), sendNativeDigest(userId, org, { ...event, title: `OpsVista · ${title}` })]);
      const sent = (web.status === 'fulfilled' ? web.value.accepted : 0) + (native.status === 'fulfilled' ? native.value.accepted : 0);
      for (const row of allowed) await finishPushDigest(row, token, sent ? 'accepted' : 'retry');
      accepted += sent;
    } catch {
      for (const row of group) await finishPushDigest(row, token, 'retry');
    }
  }
  return { accepted, suppressed };
}
