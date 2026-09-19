import { beverageLocations } from '../shared/beverageMetrics.js';
import { easternDay, scheduledBonusWeek } from '../shared/bonusWeek.js';
import { getIntegrationSnapshot, saveIntegrationSnapshot } from './integrationStore.js';
import { queueSourceRefresh, registerSource } from './sourceCache.js';

export async function prepareClosedBonusWeek(organizationId: string, now = new Date()) {
  const week = scheduledBonusWeek(now);
  if (!week) return;
  const previous = await getIntegrationSnapshot<{ start: string; end: string }>(organizationId, 'source-sync', 'bonus-week');
  if (previous?.payload.start === week.start && previous.payload.end === week.end) return week;
  for (const location of beverageLocations) for (const provider of ['toast-beverage', 'r365-beverage'] as const) {
    const job = await registerSource(organizationId, provider, { location, ...week });
    if (!job.payload || !job.refreshedAt || easternDay(new Date(job.refreshedAt)) <= week.end)
      await queueSourceRefresh(organizationId, job.key);
  }
  // Save the marker after all jobs are durable. A retry safely reuses their keys.
  await saveIntegrationSnapshot(organizationId, 'source-sync', 'bonus-week', { ...week, queuedAt: now.toISOString() });
  return week;
}
