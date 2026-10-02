import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import type { SessionUser } from './authSession.js';
import type { OperationalAlert } from '../shared/operationalAlerts.js';
import { sendWebPushToUsers } from './webPushStore.js';

export const alertOrganization = 'org-puerto-vallarta';
export const alertActor: SessionUser = { id: 'opsvista-alert-scheduler', name: 'OpsVista', email: '', role: 'Corporate', title: 'Operational alerts', locations: [], organizationId: alertOrganization };
let connection: ReturnType<typeof postgres> | undefined;
let schema: Promise<void> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Alert storage unavailable');
  return connection ||= postgres(url, { ssl: 'require', max: 3, idle_timeout: 10, connect_timeout: 10 });
}
async function ready() {
  if (!schema) schema = (async () => {
    const sql = db();
    await sql`create table if not exists opsvista_alert_jobs (
      organization_id text not null, job text not null, lease_token text, lease_until timestamptz,
      checked_at timestamptz, success_at timestamptz, status text not null default 'pending', note text,
      primary key(organization_id,job))`;
    await sql`create table if not exists opsvista_alert_inbox (
      organization_id text not null, event_key text not null, kind text not null, location text not null,
      title text not null, body text not null, module text not null, created_at timestamptz not null default now(),
      primary key(organization_id,event_key))`;
    await sql`create table if not exists opsvista_alert_deliveries (
      organization_id text not null, event_key text not null, user_id text not null,
      status text not null default 'pending', attempts int not null default 0, lease_until timestamptz,
      accepted_at timestamptz, primary key(organization_id,event_key,user_id))`;
    await sql`create index if not exists opsvista_alert_inbox_date on opsvista_alert_inbox(organization_id,created_at desc)`;
  })().catch(error => { schema = undefined; throw error; });
  await schema;
}
export async function claimAlertJob(job: string, now = new Date(), successSince?: string, minimumMinutes = 20) {
  await ready(); const sql = db(), token = randomUUID();
  const rows = await sql`insert into opsvista_alert_jobs(organization_id,job,lease_token,lease_until,checked_at,status)
    values(${alertOrganization},${job},${token},${new Date(now.getTime()+180000).toISOString()},${now.toISOString()},'checking')
    on conflict(organization_id,job) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until,checked_at=excluded.checked_at,status='checking'
    where (opsvista_alert_jobs.lease_until is null or opsvista_alert_jobs.lease_until<${now.toISOString()})
      and (opsvista_alert_jobs.checked_at is null or opsvista_alert_jobs.checked_at<${new Date(now.getTime()-minimumMinutes*60000).toISOString()})
      and (${!successSince} or opsvista_alert_jobs.success_at is null or opsvista_alert_jobs.success_at<${successSince || now.toISOString()}::timestamptz)
    returning job`;
  return rows.length ? token : null;
}
export async function finishAlertJob(job: string, token: string, status: 'ok' | 'quiet' | 'waiting' | 'retrying' | 'unavailable', note: string, now = new Date()) {
  await ready();
  await db()`update opsvista_alert_jobs set lease_until=null,status=${status},note=${note},
    success_at=case when ${status}='ok' then ${now.toISOString()}::timestamptz else success_at end
    where organization_id=${alertOrganization} and job=${job} and lease_token=${token}`;
}
export async function saveAndDeliverAlert(alert: OperationalAlert, recipients: string[]) {
  await ready(); const sql = db();
  await sql`insert into opsvista_alert_inbox(organization_id,event_key,kind,location,title,body,module)
    values(${alertOrganization},${alert.key},${alert.kind},${alert.location},${alert.title},${alert.body},${alert.module})
    on conflict(organization_id,event_key) do nothing`;
  let accepted = 0;
  for (const userId of new Set(recipients)) {
    await sql`insert into opsvista_alert_deliveries(organization_id,event_key,user_id)
      values(${alertOrganization},${alert.key},${userId}) on conflict do nothing`;
    const claim = await sql`update opsvista_alert_deliveries set attempts=attempts+1,lease_until=now()+interval '3 minutes'
      where organization_id=${alertOrganization} and event_key=${alert.key} and user_id=${userId}
        and status in ('pending','retry') and attempts<3 and (lease_until is null or lease_until<now())
      returning user_id`;
    if (!claim.length) continue;
    const result = await sendWebPushToUsers([userId], alertActor, { category: alert.category || alert.kind, location: alert.location, tag: `opsvista:${alert.key}`, title: alert.title, body: alert.body, priority: alert.priority || (alert.kind === 'bonus' ? 'low' : 'normal') });
    const status = result.accepted > 0 ? 'accepted' : ('queued' in result && result.queued) ? 'queued' : ('suppressed' in result && result.suppressed) ? 'suppressed' : ('unavailable' in result && result.unavailable) || result.devices > 0 ? 'retry' : 'no_device';
    await sql`update opsvista_alert_deliveries set status=case when ${status}='retry' and attempts>=3 then 'failed' else ${status} end,lease_until=null,
      accepted_at=case when ${status}='accepted' then now() else null end
      where organization_id=${alertOrganization} and event_key=${alert.key} and user_id=${userId}`;
    accepted += result.accepted;
  }
  const pending = await sql`select user_id from opsvista_alert_deliveries where organization_id=${alertOrganization} and event_key=${alert.key} and status in ('pending','retry') and attempts<3 limit 1`;
  return { accepted, retryPending: pending.length > 0 };
}
export async function alertInbox(user: SessionUser, allowedLocations: string[] | null) {
  await ready(); const sql = db(), org = user.organizationId || alertOrganization;
  const rows = await sql`select i.event_key as id,i.kind,i.location,i.title,i.body,i.module,i.created_at as at
    from opsvista_alert_inbox i join opsvista_alert_deliveries d
      on d.organization_id=i.organization_id and d.event_key=i.event_key
    where i.organization_id=${org} and d.user_id=${user.id} and i.created_at>now()-interval '30 days'
      and (${allowedLocations === null} or lower(i.location) in (select lower(value) from jsonb_array_elements_text(${sql.json(allowedLocations || [])}::jsonb)))
    order by i.created_at desc limit 50`;
  const jobs = org === alertOrganization ? await sql`select job,checked_at as "checkedAt",success_at as "successAt",status,note from opsvista_alert_jobs where organization_id=${org} order by job` : [];
  return { alerts: rows, jobs, timeZone: 'America/New_York', quietHours: '23:00–09:00', intervalMinutes: 30 };
}
