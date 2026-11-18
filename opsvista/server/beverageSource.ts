import { getIntegrationSnapshot } from './integrationStore.js';
import { cachedSource } from './sourceCache.js';
import { loadSource } from './sourceLoaders.js';
import type { BeverageSource } from '../shared/beverageMetrics.js';

export async function getBeverageSource(organizationId: string, location: string, start: string, end: string, refresh = false): Promise<BeverageSource> {
  if (organizationId !== 'org-puerto-vallarta') throw new Error('Toast no está conectado para esta organización');
  const params = { location, start, end };
  const previous = await getIntegrationSnapshot<BeverageSource>(organizationId, 'restaurant365-odata', `beverage-v3:${location}:${start}:${end}`);
  const [sales, purchases] = await Promise.all([
    cachedSource<BeverageSource['sales']>(organizationId, 'toast-beverage', params, loadSource, refresh,
      async () => previous && !previous.payload.sales.error ? { payload: previous.payload.sales, updatedAt: previous.payload.fetchedAt } : null),
    cachedSource<BeverageSource['purchases']>(organizationId, 'r365-beverage', params, loadSource, refresh,
      async () => previous && !previous.payload.purchases.error ? { payload: previous.payload.purchases, updatedAt: previous.payload.fetchedAt } : null),
  ]);
  const legacy = previous?.payload;
  return {
    location, start, end,
    fetchedAt: [sales.memory.updatedAt || legacy?.fetchedAt, purchases.memory.updatedAt || legacy?.fetchedAt].filter(Boolean).sort()[0] || new Date().toISOString(),
    sales: sales.data || legacy?.sales || { categories: [], missingPrices: 0, unallocatedRefunds: 0, error: sales.memory.error || 'Toast pendiente de sincronización' },
    purchases: purchases.data || legacy?.purchases || { invoices: [], error: purchases.memory.error || 'R365 pendiente de sincronización' },
    memory: { sales: sales.memory, purchases: purchases.memory },
  };
}
