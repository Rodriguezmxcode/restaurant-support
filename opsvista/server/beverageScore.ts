import { beverageChunks, beverageLocations, compareBeverages, type BeverageSource } from '../shared/beverageMetrics.js';
import { scoreBeverages, type BeverageScoreResponse } from '../shared/beverageScore.js';
import { readSavedSources, registerSource, sourceKey, sourceMemory } from './sourceCache.js';
import { authorize, serverLocationAllowed } from './authorization.js';
import type { SessionUser } from './authSession.js';

export function visibleBeverageScore(score: BeverageScoreResponse, user: SessionUser): BeverageScoreResponse {
  const canSeeAmounts = authorize(user, 'restaurant365:read').ok;
  return { ...score, rows: score.rows.filter(row => serverLocationAllowed(user, row.location)).map(row =>
    canSeeAmounts ? row : { ...row, sales: null, purchases: null, pending: 0 }) };
}

// The scorecard reads persisted snapshots only. Source workers fetch new data.
export async function getBeverageScore(organizationId: string, start: string, end: string): Promise<BeverageScoreResponse> {
  const chunks = beverageChunks(start, end);
  const params = beverageLocations.flatMap(location => chunks.map(chunk => ({ location, ...chunk })));
  const [salesJobs, purchaseJobs] = await Promise.all([
    readSavedSources(organizationId, 'toast-beverage', params.map(value => sourceKey('toast-beverage', value))),
    readSavedSources(organizationId, 'r365-beverage', params.map(value => sourceKey('r365-beverage', value))),
  ]);
  const saved = new Map([...salesJobs, ...purchaseJobs].map(job => [job.key, job]));
  const sources: BeverageSource[] = [];
  for (const location of beverageLocations) for (const chunk of chunks) {
    const params = { location, ...chunk };
    const sales = saved.get(sourceKey('toast-beverage', params));
    const purchases = saved.get(sourceKey('r365-beverage', params));
    if (!sales) await registerSource(organizationId, 'toast-beverage', params);
    if (!purchases) await registerSource(organizationId, 'r365-beverage', params);
    sources.push({ ...params, fetchedAt: [sales?.refreshedAt, purchases?.refreshedAt].filter(Boolean).sort()[0] || '',
      sales: sales?.payload || { categories: [], missingPrices: 0, unallocatedRefunds: 0, error: 'Ventas pendientes de sincronización' },
      purchases: purchases?.payload || { invoices: [], error: 'Compras pendientes de sincronización' },
      memory: { sales: sales ? sourceMemory(sales) : { stored: false, pending: true }, purchases: purchases ? sourceMemory(purchases) : { stored: false, pending: true } },
    });
  }
  const score = scoreBeverages(beverageLocations.map(location => compareBeverages(location, sources, chunks.length)));
  return { start, end, ...score, updatedAt: sources.map(source => source.fetchedAt).filter(Boolean).sort()[0] };
}
