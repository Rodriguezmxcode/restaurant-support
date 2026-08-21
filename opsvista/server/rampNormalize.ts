export type LiveRampRow = {
  id: string;
  date: string;
  transactionTime?: string;
  merchant: string;
  merchantLocation?: string;
  amount: number;
  cardholder?: string;
  department?: string;
  restaurant?: string;
  entity?: string;
  category?: string;
  accountingCategory?: string;
  cardLastFour?: string;
  memo?: string;
  receiptAttached: boolean;
  state: 'CLEARED' | 'PENDING';
  source: 'Ramp';
};

export type RampReferences = {
  cardholder?: string;
  department?: string;
  location?: string;
  entity?: string;
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

function textOf(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  return nameOf(value) || value.label || value.value || value.display_name || value.category_name;
}

function merchantLocationOf(tx: any): string | undefined {
  const location = tx.merchant_location || tx.merchant?.location || tx.merchant?.address || tx.merchant_address;
  if (typeof location === 'string') return location.trim() || undefined;
  if (!location) return undefined;
  const cityState = [location.city, location.state].filter(Boolean).join(', ');
  return [location.address_line_1 || location.line1 || location.street, cityState, location.postal_code || location.zip]
    .filter(Boolean).join(' · ') || undefined;
}

function easternDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

export function normalizeRampTransaction(tx: any, memo?: string, hasReceipt = false, references: RampReferences = {}): LiveRampRow {
  const status = String(tx.state || tx.status || tx.transaction_state || '').toUpperCase();
  const transactionTime = String(tx.user_transaction_time || tx.transaction_time || tx.transaction_date || tx.created_at || '');
  const date = easternDate(transactionTime);
  return {
    id: String(tx.id || tx.transaction_id || ''),
    date,
    transactionTime: transactionTime || undefined,
    merchant: tx.merchant_name || tx.merchant?.name || tx.merchant?.merchant_name || 'Unknown merchant',
    merchantLocation: merchantLocationOf(tx),
    amount: dollars(tx.amount ?? tx.amount_details ?? tx.total_amount ?? tx.cardholder_amount),
    cardholder: nameOf(tx.cardholder) || nameOf(tx.user) || tx.cardholder_name || tx.user_name || references.cardholder,
    department: nameOf(tx.department) || tx.department_name || references.department,
    restaurant: nameOf(tx.location) || tx.location_name || references.location,
    entity: nameOf(tx.entity) || tx.entity_name || references.entity,
    category: textOf(tx.category) || textOf(tx.merchant_category) || tx.sk_category_name || tx.category_name || tx.merchant_category_code_description,
    accountingCategory: textOf(tx.accounting_category) || textOf(tx.gl_account) || tx.accounting_category_name || tx.gl_account_name,
    cardLastFour: String(tx.card?.last_four || tx.card?.last_four_digits || tx.card_last_four || tx.last_four || '').trim() || undefined,
    memo: memo || tx.memo || tx.memo_text || '',
    receiptAttached: hasReceipt || Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length),
    state: status.includes('PENDING') ? 'PENDING' : 'CLEARED',
    source: 'Ramp',
  };
}
