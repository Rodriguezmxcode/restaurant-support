export type LiveRampRow = {
  id: string;
  date: string;
  transactionTime?: string;
  merchant: string;
  amount: number;
  cardholder?: string;
  department?: string;
  memo?: string;
  receiptAttached: boolean;
  state: 'CLEARED' | 'PENDING';
  source: 'Ramp';
};

function nameOf(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return [value.first_name, value.last_name].filter(Boolean).join(' ').trim() || value.name || value.display_name || value.email;
}

function dollars(value: any): number {
  if (typeof value === 'number') return value;
  const raw = Number(value?.amount ?? 0);
  const rate = Number(value?.minor_unit_conversion_rate ?? 100) || 100;
  return raw / rate;
}

export function normalizeRampTransaction(tx: any, memo?: string, hasReceipt = false): LiveRampRow {
  const status = String(tx.state || tx.status || tx.transaction_state || '').toUpperCase();
  const transactionTime = String(tx.user_transaction_time || tx.transaction_time || tx.transaction_date || tx.created_at || '');
  const date = transactionTime.slice(0, 10);
  return {
    id: String(tx.id || tx.transaction_id || ''),
    date,
    transactionTime: transactionTime || undefined,
    merchant: tx.merchant_name || tx.merchant?.name || tx.merchant?.merchant_name || 'Unknown merchant',
    amount: dollars(tx.amount ?? tx.amount_details ?? tx.total_amount ?? tx.cardholder_amount),
    cardholder: nameOf(tx.cardholder) || nameOf(tx.user) || tx.cardholder_name || tx.user_name,
    department: nameOf(tx.department) || tx.department_name || nameOf(tx.location) || tx.location_name,
    memo: memo || tx.memo || tx.memo_text || '',
    receiptAttached: hasReceipt || Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length),
    state: status.includes('PENDING') ? 'PENDING' : 'CLEARED',
    source: 'Ramp',
  };
}
