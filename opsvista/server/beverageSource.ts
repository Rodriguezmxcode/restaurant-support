import { getIntegrationSnapshot, saveIntegrationSnapshot } from './integrationStore.js';
import { getRestaurant365BeveragePurchases } from './restaurant365OData.js';
import { getToastBeverageSales } from './toastBeverageSales.js';
import type { BeverageSource } from '../shared/beverageMetrics.js';

export async function getBeverageSource(organizationId: string, location: string, start: string, end: string): Promise<BeverageSource> {
  const key = `beverage-v2:${location}:${start}:${end}`;
  try {
    const cached = (await getIntegrationSnapshot<BeverageSource>(organizationId, 'restaurant365-odata', key))?.payload;
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < 300_000) return cached;
  } catch { /* Live sources remain available if snapshot storage is unavailable. */ }
  const [salesResult, purchaseResult] = await Promise.allSettled([
    getToastBeverageSales(location, start, end), getRestaurant365BeveragePurchases(organizationId, start, end, location),
  ]);
  const errorText = (error: unknown) => error instanceof Error ? error.message : 'Fuente no disponible';
  const source: BeverageSource = {
    location, start, end, fetchedAt: new Date().toISOString(),
    sales: salesResult.status === 'fulfilled' ? salesResult.value : { categories: [], missingPrices: 0, unallocatedRefunds: 0, error: errorText(salesResult.reason) },
    purchases: purchaseResult.status === 'fulfilled' ? purchaseResult.value : { invoices: [], error: errorText(purchaseResult.reason) },
  };
  if (!source.sales.error && !source.purchases.error) {
    try { await saveIntegrationSnapshot(organizationId, 'restaurant365-odata', key, source); } catch { /* No stale fallback. */ }
  }
  return source;
}
