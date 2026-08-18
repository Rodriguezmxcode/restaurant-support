import { rampGet } from './rampClient';
import { normalizeRampTransaction } from './rampNormalize';

type Page<T> = { data?: T[]; page?: { next?: string | null } };

type Memo = { transaction_id?: string; memo?: string };
type Receipt = { transaction_id?: string };

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

  const [transactions, memos, receipts] = await Promise.all([
    collect<any>('transactions', transactionQuery),
    collect<Memo>('memos', transactionQuery),
    collect<Receipt>('receipts', transactionQuery),
  ]);

  const memoByTransaction = new Map<string, string>();
  memos.forEach(row => {
    if (row.transaction_id && row.memo) memoByTransaction.set(row.transaction_id, row.memo);
  });

  const receiptTransactions = new Set(
    receipts.map(row => row.transaction_id).filter((id): id is string => Boolean(id))
  );

  return {
    source: 'live' as const,
    fetchedAt: new Date().toISOString(),
    transactions: transactions
      .map(tx => {
        const id = String(tx.id || tx.transaction_id || '');
        return normalizeRampTransaction(tx, memoByTransaction.get(id), receiptTransactions.has(id));
      })
      .filter(tx => tx.id),
  };
}
