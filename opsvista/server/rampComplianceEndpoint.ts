import { rampGet } from './rampClient';
import { normalizeRampTransaction } from './rampNormalize';

type Page<T> = { data?: T[]; page?: { next?: string | null } };

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

export async function getRampCompliancePayload(params?: { fromDate?: string; toDate?: string }) {
  const transactionQuery: Record<string, string | undefined> = {
    from_date: params?.fromDate,
    to_date: params?.toDate,
  };

  // Transactions are the required source. Ramp includes memo, receipt and
  // accounting selections on the transaction payload when the app has access.
  // Do not fail the complete expense feed because an optional enrichment
  // endpoint or scope is unavailable.
  const transactions = await collect<any>('transactions', transactionQuery);

  return {
    source: 'live' as const,
    fetchedAt: new Date().toISOString(),
    transactions: transactions
      .map(tx => normalizeRampTransaction(
        tx,
        tx.memo || tx.memo_text || tx.memos?.[0]?.memo,
        Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length || tx.receipt_attached),
      ))
      .filter(tx => tx.id),
  };
}
