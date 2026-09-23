import { beverageChunks, beverageLocations } from '../shared/beverageMetrics.js';
import { beverageBonusRange, easternDay, scheduledBonusWeek } from '../shared/bonusWeek.js';
import { getIntegrationSnapshot, saveIntegrationSnapshot } from './integrationStore.js';
import { queueSourceRefresh, registerSource } from './sourceCache.js';

export async function prepareClosedBonusWeek(organizationId: string, now = new Date()) {
  const week = scheduledBonusWeek(now);
  if (!week) return;
  const alcoholRange = beverageBonusRange(week.end);
  const previous = await getIntegrationSnapshot<{ start: string; end: string; alcoholStart?: string }>(organizationId, 'source-sync', 'bonus-week');
  if (previous?.payload.start === week.start && previous.payload.end === week.end && previous.payload.alcoholStart === alcoholRange.start) return week;
  for (const location of beverageLocations) for (const chunk of beverageChunks(alcoholRange.start, alcoholRange.end)) for (const provider of ['toast-beverage', 'r365-beverage'] as const) {
    const job = await registerSource(organizationId, provider, { location, ...chunk });
    if (!job.payload || !job.refreshedAt || easternDay(new Date(job.refreshedAt)) <= week.end)
      await queueSourceRefresh(organizationId, job.key);
  }
  // Save the marker after all jobs are durable. A retry safely reuses their keys.
  await saveIntegrationSnapshot(organizationId, 'source-sync', 'bonus-week', { ...week, alcoholStart: alcoholRange.start, queuedAt: now.toISOString() });
  return week;
}
