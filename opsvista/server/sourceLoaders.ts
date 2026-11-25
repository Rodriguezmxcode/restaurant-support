import { getRestaurant365Ap, getRestaurant365BeveragePurchases, getRestaurant365Catalog, getRestaurant365Ledger } from './restaurant365OData.js';
import { getToastBeverageSales } from './toastBeverageSales.js';
import type { SourceJob } from './sourceCache.js';

export async function loadSource(job: SourceJob): Promise<any> {
  const { organizationId, params: p } = job;
  switch (job.provider) {
    case 'r365-beverage': return getRestaurant365BeveragePurchases(organizationId, p.start!, p.end!, p.location!);
    case 'toast-beverage':
      if (organizationId !== 'org-puerto-vallarta') throw new Error('Toast no está conectado para esta organización');
      return getToastBeverageSales(p.location!, p.start!, p.end!);
    case 'r365-ap': return getRestaurant365Ap(organizationId, p.start!, p.end);
    case 'r365-ledger': return getRestaurant365Ledger(organizationId, p.start!, p.location!, p.end);
    case 'r365-catalog': return getRestaurant365Catalog(organizationId, p.kind!);
    default: throw new Error('Fuente de sincronización desconocida');
  }
}
