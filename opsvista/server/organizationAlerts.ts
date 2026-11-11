import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { alertLocations, alertJobs, type AlertJob } from '../shared/operationalAlerts.js';
import { defaultAlertPolicy, healthState, jobProviders, type AlertPolicy, type ConnectionHealth, type Provider } from '../shared/connectionHealth.js';
import { listOrganizations } from './organizationStore.js';
import { getGoogleBusinessCredentials, getRestaurant365Credentials } from './integrationStore.js';
import { getAlertJobs } from './operationalAlertStore.js';
import { PreferenceError } from './notificationPreferencesStore.js';

export const legacyOrganization = 'org-puerto-vallarta';
export type AlertOrganization = { id: string; name: string; locations: string[]; policy: AlertPolicy };
let connection: ReturnType<typeof postgres> | undefined;
let schema: Promise<void> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Alert settings unavailable');
  return connection ||= postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10 });
}
async function ready() {
  if (!schema) schema = (async () => {
    await db()`create table if not exists opsvista_alert_policies(organization_id text primary key,policy jsonb not null,revision integer not null default 0,updated_at timestamptz not null default now())`;
    await db()`create table if not exists opsvista_alert_policy_audit(id text primary key,organization_id text not null,actor_id text not null,at timestamptz not null default now(),before_value jsonb not null,after_value jsonb not null)`;
  })().catch(error => { schema = undefined; throw error; });
  await schema;
}
export async function getAlertPolicy(organizationId: string): Promise<AlertPolicy> {
  await ready();
  const [row] = await db()`select policy,revision from opsvista_alert_policies where organization_id=${organizationId}`;
  const defaults = defaultAlertPolicy();
  return row ? { ...defaults, ...row.policy, enabled: { ...defaults.enabled, ...row.policy.enabled }, revision: row.revision } : defaults;
}
export async function activeAlertOrganizations(): Promise<AlertOrganization[]> {
  const organizations = (await listOrganizations()).filter(org => org.status === 'active');
  return Promise.all(organizations.map(async org => ({ id: org.id, name: org.name,
    locations: org.id === legacyOrganization ? [...alertLocations] : org.locations, policy: await getAlertPolicy(org.id) })));
}
export async function alertOrganizationContext(id: string) {
  const org = (await activeAlertOrganizations()).find(org => org.id === id);
  if (!org) throw new PreferenceError('Active organization required', 403);
  return org;
}
export function supportedJob(organizationId: string, job: AlertJob) {
  return organizationId === legacyOrganization || job === 'reviews' || job === 'prices';
}
export async function connectionInventory(organizationId: string): Promise<ConnectionHealth['providers']> {
  const legacy = organizationId === legacyOrganization;
  const [google, r365] = await Promise.all([getGoogleBusinessCredentials(organizationId), getRestaurant365Credentials(organizationId)]);
  const env = (...names: string[]) => names.every(name => Boolean(process.env[name]?.trim()));
  const sevenToken = env('SEVENSHIFTS_ACCESS_TOKEN') || env('SEVEN_SHIFTS_ACCESS_TOKEN') || env('SEVENSHIFTS_CLIENT_ID', 'SEVENSHIFTS_CLIENT_SECRET') || env('SEVEN_SHIFTS_CLIENT_ID', 'SEVEN_SHIFTS_CLIENT_SECRET');
  const flags: Record<Provider, boolean> = {
    toast: legacy && env('TOAST_API_HOST', 'TOAST_CLIENT_ID', 'TOAST_CLIENT_SECRET', 'TOAST_LOCATION_GUIDS_JSON'),
    '7shifts': legacy && sevenToken,
    ramp: legacy && (env('RAMP_ACCESS_TOKEN') || env('RAMP_CLIENT_ID', 'RAMP_CLIENT_SECRET')),
    google: Boolean(google?.clientId && google.clientSecret && google.refreshToken) || (legacy && env('GOOGLE_BUSINESS_PROFILE_CLIENT_ID', 'GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET', 'GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN')),
    r365: Boolean(r365?.domain && r365.username && r365.password) || (legacy && env('RESTAURANT365_DOMAIN', 'RESTAURANT365_USERNAME', 'RESTAURANT365_PASSWORD')),
  };
  return (Object.keys(flags) as Provider[]).map(id => ({ id, configured: flags[id], available: legacy || id === 'google' || id === 'r365' }));
}
export async function saveAlertPolicy(organizationId: string, actorId: string, input: Record<string, unknown>) {
  const fields = ['revision', 'timeZone', 'enabled', 'reviewRating', 'reviewHours', 'priceIncreasePct'];
  if (Object.keys(input).some(key => !fields.includes(key)) || !Number.isInteger(input.revision)) throw new PreferenceError('Invalid alert settings');
  await ready(); const sql = db();
  return sql.begin(async tx => {
    await tx`insert into opsvista_alert_policies(organization_id,policy) values(${organizationId},${tx.json(defaultAlertPolicy())}) on conflict do nothing`;
    const [row] = await tx`select policy,revision from opsvista_alert_policies where organization_id=${organizationId} for update`;
    if (row.revision !== input.revision) throw new PreferenceError('Settings changed. Reload and try again.', 409);
    const before = { ...defaultAlertPolicy(), ...row.policy, revision: row.revision } as AlertPolicy;
    const next = { ...before, enabled: { ...before.enabled }, revision: before.revision + 1 };
    if (input.timeZone !== undefined) {
      if (typeof input.timeZone !== 'string' || input.timeZone.length > 80) throw new PreferenceError('Invalid time zone');
      try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); } catch { throw new PreferenceError('Invalid time zone'); }
      // Legacy sales/bonus sources use Connecticut business dates.
      if (organizationId === legacyOrganization && input.timeZone !== 'America/New_York') throw new PreferenceError('Puerto Vallarta uses Connecticut business dates');
      next.timeZone = input.timeZone;
    }
    if (input.enabled !== undefined) {
      if (!input.enabled || typeof input.enabled !== 'object' || Array.isArray(input.enabled)) throw new PreferenceError('Invalid rules');
      for (const [key, value] of Object.entries(input.enabled)) {
        if (!alertJobs.includes(key as AlertJob) || typeof value !== 'boolean') throw new PreferenceError('Invalid rule');
        next.enabled[key as AlertJob] = value;
      }
    }
    for (const [key, min, max] of [['reviewRating', 1, 3], ['reviewHours', 1, 168], ['priceIncreasePct', 5, 100]] as const) {
      const value = input[key];
      if (value !== undefined) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (key !== 'priceIncreasePct' && !Number.isInteger(value))) throw new PreferenceError('Invalid threshold');
        next[key] = value;
      }
    }
    await tx`update opsvista_alert_policies set policy=${tx.json(next)},revision=${next.revision},updated_at=now() where organization_id=${organizationId}`;
    await tx`insert into opsvista_alert_policy_audit(id,organization_id,actor_id,before_value,after_value) values(${randomUUID()},${organizationId},${actorId},${tx.json(before)},${tx.json(next)})`;
    return next;
  });
}
export async function connectionHealth(org: AlertOrganization, allowedLocations: string[], canManage: boolean, now = new Date()): Promise<ConnectionHealth> {
  const [providers, jobs] = await Promise.all([connectionInventory(org.id), getAlertJobs(org.id)]);
  const configured = new Set(providers.filter(provider => provider.configured).map(provider => provider.id));
  const latest = (job: string) => jobs.filter(row => row.job === job || row.job === `verify:${job}`).sort((a,b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''))[0];
  const rules = alertJobs.flatMap(job => allowedLocations.filter(location => org.locations.includes(location)).map(location => {
    // Older runs scanned several restaurants together. Keep that scope explicit;
    // new runs use a separate record for each restaurant.
    const row = latest(`${job}:${location}`);
    const supported = supportedJob(org.id, job), connected = jobProviders[job].every(provider => configured.has(provider));
    return { job, location, state: !supported ? 'setup_required' as const : !org.policy.enabled[job] ? 'paused' as const : !connected ? 'connection_required' as const : healthState(row, now, org.policy.timeZone),
      checkedAt: row?.checkedAt, verifiedAt: row?.verifiedAt, reason: row?.status === 'unavailable' ? row.note : undefined };
  }));
  const heartbeat = jobs.find(row => row.job === 'heartbeat')?.checkedAt;
  return { organizationName: org.name, locations: allowedLocations.filter(location => org.locations.includes(location)), policy: org.policy, canManage, providers, rules,
    schedulerAt: heartbeat, schedulerStale: !heartbeat || now.getTime() - Date.parse(heartbeat) > 90 * 60000 };
}
