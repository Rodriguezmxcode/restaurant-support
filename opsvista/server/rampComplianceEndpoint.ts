import { rampGet } from './rampClient';
import { normalizeRampTransaction, type RampReferences } from './rampNormalize';

type Page<T> = { data?: T[]; page?: { next?: string | null } };

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validateRange(fromDate?: string, toDate?: string) {
  if (!fromDate || !toDate || !isoDatePattern.test(fromDate) || !isoDatePattern.test(toDate)) {
    throw new Error('Ramp requires fromDate and toDate in YYYY-MM-DD format.');
  }
  if (fromDate > toDate) throw new Error('Ramp fromDate cannot be after toDate.');
  const start = Date.parse(`${fromDate}T00:00:00.000Z`);
  const end = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Ramp date range is invalid.');
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days > 31) throw new Error('Ramp custom ranges can include up to 31 days.');
  return { fromDate, toDate };
}

async function collect<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const rows: T[] = [];
  let start: string | undefined;

  for (let i = 0; i < 50; i += 1) {
    const page = await rampGet<Page<T>>(path, { ...query, page_size: 100, start });
    rows.push(...(page.data ?? []));
    start = page.page?.next || undefined;
    if (!start) break;
  }

  return rows;
}

function referenceName(row: any): string | undefined {
  if (!row) return undefined;
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    || row.name || row.display_name || row.email || row.label;
}

function referenceMap(rows: any[]) {
  return new Map(rows.flatMap(row => {
    const id = String(row?.id || row?.ramp_id || '').trim();
    const name = referenceName(row);
    return id && name ? [[id, name] as const] : [];
  }));
}

function idOf(...values: any[]): string | undefined {
  for (const value of values) {
    const id = typeof value === 'string' ? value : value?.id || value?.ramp_id;
    if (id) return String(id);
  }
  return undefined;
}

async function optionalLookup(path: string) {
  try { return await collect<any>(path); } catch (error) {
    console.warn(`[OpsVista Ramp] Optional ${path} enrichment unavailable`, error instanceof Error ? error.message : error);
    return [];
  }
}

export async function getRampCompliancePayload(params?: { fromDate?: string; toDate?: string }) {
  const range = validateRange(params?.fromDate, params?.toDate);
  const transactionQuery: Record<string, string | undefined> = {
    from_date: range.fromDate,
    to_date: range.toDate,
    transactions_to_retrieve: 'all_transactions_across_entire_business',
  };

  // Transactions are the required source. Ramp includes memo, receipt and
  // accounting selections on the transaction payload when the app has access.
  // Do not fail the complete expense feed because an optional enrichment
  // endpoint or scope is unavailable.
  const transactions = await collect<any>('transactions', transactionQuery);
  const [users, departments, locations, entities] = transactions.length ? await Promise.all([
    optionalLookup('users'),
    optionalLookup('departments'),
    optionalLookup('locations'),
    optionalLookup('entities'),
  ]) : [[], [], [], []];
  const userNames = referenceMap(users);
  const departmentNames = referenceMap(departments);
  const locationNames = referenceMap(locations);
  const entityNames = referenceMap(entities);
  const normalized = transactions
    .map(tx => {
      const references: RampReferences = {
        cardholder: userNames.get(idOf(tx.cardholder_id, tx.user_id, tx.cardholder, tx.user) || ''),
        department: departmentNames.get(idOf(tx.department_id, tx.department) || ''),
        location: locationNames.get(idOf(tx.location_id, tx.location) || ''),
        entity: entityNames.get(idOf(tx.entity_id, tx.entity) || ''),
      };
      return normalizeRampTransaction(
        tx,
        tx.memo || tx.memo_text || tx.memos?.[0]?.memo,
        Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length || tx.receipt_attached),
        references,
      );
    })
    .filter(tx => tx.id && tx.date >= range.fromDate && tx.date <= range.toDate);

  return {
    source: 'live' as const,
    fetchedAt: new Date().toISOString(),
    fromDate: range.fromDate,
    toDate: range.toDate,
    transactions: normalized,
  };
}
