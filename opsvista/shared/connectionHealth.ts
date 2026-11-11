import { alertJobs, alertClock, alertJobDue, type AlertJob } from './operationalAlerts.js';

export type AlertPolicy = {
  revision: number; timeZone: string; enabled: Record<AlertJob, boolean>;
  reviewRating: number; reviewHours: number; priceIncreasePct: number;
};
export const defaultAlertPolicy = (): AlertPolicy => ({ revision: 0, timeZone: 'America/New_York',
  enabled: Object.fromEntries(alertJobs.map(job => [job, true])) as Record<AlertJob, boolean>,
  reviewRating: 2, reviewHours: 24, priceIncreasePct: 5 });
export type Provider = 'toast' | '7shifts' | 'google' | 'ramp' | 'r365';
export const jobProviders: Record<AlertJob, Provider[]> = {
  performance: ['toast'], overtime: ['toast'], tasks: ['7shifts'], logbook: ['7shifts'],
  reviews: ['google'], ramp: ['ramp'], prices: ['r365'], bonus: ['toast', '7shifts', 'google', 'r365'],
};
export type JobStatus = { job: string; status: string; checkedAt?: string; successAt?: string; verifiedAt?: string; note?: string };
export type HealthState = 'checked' | 'stale' | 'error' | 'pending' | 'paused' | 'connection_required' | 'setup_required';
export type HealthRule = { job: AlertJob; location?: string; state: HealthState; checkedAt?: string; verifiedAt?: string; reason?: string };
export type ConnectionHealth = {
  organizationName: string; locations: string[]; policy: AlertPolicy; canManage: boolean;
  providers: { id: Provider; configured: boolean; available: boolean }[];
  rules: HealthRule[]; schedulerAt?: string; schedulerStale: boolean;
};
export function healthState(row: JobStatus | undefined, now: Date, timeZone = 'America/New_York'): HealthState {
  if (row?.status === 'unavailable') return 'error';
  if (row?.status === 'waiting') return 'pending';
  if (!row?.verifiedAt) return 'pending';
  // Daily rules can legitimately go a full day without another source read.
  const daily = ['overtime', 'logbook', 'ramp', 'prices', 'bonus'].includes(row.job.split(':')[0]);
  const kind = row.job.split(':')[0] as AlertJob;
  const age = now.getTime() - Date.parse(row.verifiedAt);
  const {hour} = alertClock(now, timeZone);
  const start = kind === 'performance' ? 17 : kind === 'tasks' ? 21 : 9;
  const inWindow = alertJobDue(kind, now, timeZone) && hour >= start + 1;
  if (!Number.isFinite(age) || age > (daily ? 27 : inWindow ? 1.5 : 16) * 3600000) return 'stale';
  return 'checked';
}
