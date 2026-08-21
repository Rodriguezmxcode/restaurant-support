import { rampGet } from './rampClient.js';
import { normalizeRampTransaction } from './rampNormalize.js';

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

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function collect<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const rows: T[] = [];
  let start: string | undefined;

  for (let i = 0; i < 10; i += 1) {
    const page = await rampGet<Page<T>>(path, { ...query, page_size: 100, start });
    rows.push(...(page.data ?? []));
    start = page.page?.next || undefined;
    if (!start) break;
  }

  return rows;
}

export async function getRampCompliancePayload(params?: { fromDate?: string; toDate?: string }) {
  const range = validateRange(params?.fromDate, params?.toDate);
  const transactionQuery: Record<string, string | undefined> = {
    // Query slightly wider UTC boundaries, then enforce the exact Connecticut
    // calendar dates after normalization. This prevents midnight/DST gaps.
    from_date: `${range.fromDate}T00:00:00.000Z`,
    to_date: `${addDays(range.toDate, 1)}T06:00:00.000Z`,
    transactions_to_retrieve: 'all_transactions_across_entire_business',
  };

  // Transactions are the required source. Ramp includes memo, receipt and
  // accounting selections on the transaction payload when the app has access.
  // Do not fail the complete expense feed because an optional enrichment
  // endpoint or scope is unavailable.
  const transactions = await collect<any>('transactions', transactionQuery);
  const normalized = transactions
    .map(tx => normalizeRampTransaction(
      tx,
      tx.memo || tx.memo_text || tx.memos?.[0]?.memo,
      Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length || tx.receipt_attached),
    ))
    .filter(tx => tx.id && tx.date >= range.fromDate && tx.date <= range.toDate);

  return {
    source: 'live' as const,
    fetchedAt: new Date().toISOString(),
    fromDate: range.fromDate,
    toDate: range.toDate,
    serverVersion: 'ramp-live-v2',
    rawTransactionCount: transactions.length,
    transactions: normalized,
  };
}
