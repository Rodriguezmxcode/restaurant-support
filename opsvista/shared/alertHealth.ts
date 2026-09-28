import { alertClock, alertJobDue, alertJobs, alertLocations, type AlertJob } from './operationalAlerts.js';
export type AlertJobStatus = { job: string; checkedAt?: string | Date | null; successAt?: string | Date | null; status: string };
export const dailyAlertJobs = new Set<AlertJob>(['overtime', 'logbook', 'ramp', 'prices', 'bonus']);
export function alertHealth(rows: AlertJobStatus[], now = new Date()) {
  const { day, hour } = alertClock(now);
  const minute = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', minute: '2-digit' }).format(now));
  const delayed: string[] = [], failed: string[] = [];
  for (const kind of alertJobs) {
    if (!alertJobDue(kind, now)) continue;
    const opening = kind === 'performance' ? 17 : kind === 'overtime' ? 15 : kind === 'tasks' ? 21 : 9;
    const keys = ['performance', 'overtime', 'tasks'].includes(kind) ? alertLocations.map(location => `${kind}:${location}`) : [kind];
    for (const key of keys) {
      // A deployment's verify-only checks are never proof that the scheduler ran.
      const row = rows.find(row => row.job === key);
      const checked = row?.checkedAt ? new Date(row.checkedAt).getTime() : 0;
      if (row?.status === 'unavailable' || row?.status === 'retrying' || (row?.status === 'checking' && now.getTime() - checked > 10 * 60000)) failed.push(key);
      const dailyComplete = dailyAlertJobs.has(kind) && row?.successAt && new Date(row.successAt).getTime() >= Date.parse(`${day}T06:00:00Z`);
      if (!dailyComplete && (hour - opening) * 60 + minute >= 45 && now.getTime() - checked > 45 * 60000) delayed.push(key);
    }
  }
  return { status: delayed.length ? 'delayed' : failed.length ? 'degraded' : hour < 9 || hour >= 23 ? 'quiet' : 'healthy', delayed, failed, checkedAt: now.toISOString() };
}
