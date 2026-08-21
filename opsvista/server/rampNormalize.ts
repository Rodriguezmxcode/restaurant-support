export type LiveRampRow = {
  id: string;
  date: string;
  transactionTime?: string;
  merchant: string;
  merchantLocation?: string;
  amount: number;
  cardholder?: string;
  role?: string;
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
  role?: string;
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

function asObject(value: any): Record<string, any> {
  return value && typeof value === 'object' ? value : {};
}

function firstText(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function accountingSelection(tx: any, pattern: RegExp): string | undefined {
  const lineItemSelections = (Array.isArray(tx.line_items) ? tx.line_items : []).flatMap((line: any) => Array.isArray(line?.accounting_field_selections) ? line.accounting_field_selections : []);
  const selections = [...(Array.isArray(tx.accounting_field_selections) ? tx.accounting_field_selections : []), ...lineItemSelections];
  for (const raw of selections) {
    const item = asObject(raw);
    const field = firstText(item.field_name, item.name, item.display_name, item.label) || '';
    if (!pattern.test(field)) continue;
    const selected = asObject(item.selected_value);
    const value = firstText(
      item.value,
      typeof item.selected_value === 'string' ? item.selected_value : undefined,
      selected.name,
      selected.display_name,
      item.name,
      item.category_name,
    );
    if (value) return value;
  }
  return undefined;
}

function lineItemMemo(tx: any): string | undefined {
  const items = Array.isArray(tx.line_items) ? tx.line_items : [];
  return items.map((item: any) => firstText(item?.memo, item?.description)).find(Boolean);
}

function operationalRole(...values: any[]): string | undefined {
  const value = values.filter(item => typeof item === 'string').join(' ').toLowerCase();
  if (/sub\s*chef|sous\s*chef|chef|kitchen|cocina/.test(value)) return 'Chef';
  if (/manager|general manager|assistant manager|gerente/.test(value)) return 'Manager';
  if (/maintenance|mantenimiento|facilities/.test(value)) return 'Maintenance';
  if (/corporate|executive|president|owner|founder|operations|office|administration|administrative|admin|human resources|payroll/.test(value)) return 'Corporate';
  return undefined;
}

function accountingCategoryOf(tx: any): string | undefined {
  const categories = Array.isArray(tx.accounting_categories) ? tx.accounting_categories : [];
  const labels = categories.flatMap((raw: any) => {
    const item = asObject(raw);
    return [firstText(item.category_name, item.tracking_category_remote_name, item.name)].filter(Boolean) as string[];
  });
  return labels.join(' · ') || undefined;
}

function canonicalRestaurant(...values: any[]): string | undefined {
  const restaurants = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington', 'Middletown'];
  const source = values.filter(value => typeof value === 'string').join(' ').toLowerCase();
  return restaurants.find(name => new RegExp(`\\b${name.toLowerCase()}\\b`, 'i').test(source));
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
  const cardHolder = asObject(tx.card_holder);
  const embeddedCardholder = asObject(tx.cardholder);
  const cardUser = asObject(asObject(tx.card).card_holder);
  const spentBy = asObject(tx.spent_by);
  const user = asObject(tx.user);
  const department = asObject(tx.department);
  const location = asObject(tx.location);
  const resolvedMemo = memo || tx.memo || tx.memo_text || lineItemMemo(tx) || '';
  const resolvedCardholder = firstText(
    typeof tx.card_holder === 'string' ? tx.card_holder : undefined,
    tx.cardholder_name,
    tx.card_holder_name,
    tx.cardholder_full_name,
    nameOf(cardHolder),
    nameOf(embeddedCardholder),
    nameOf(cardUser),
    nameOf(spentBy),
    tx.user_name,
    nameOf(user),
    references.cardholder,
  );
  const resolvedDepartment = firstText(
    tx.department_name,
    nameOf(department),
    cardHolder.department_name,
    accountingSelection(tx, /department|departamento/i),
    references.department,
  );
  const accountingCategory = firstText(
    textOf(tx.accounting_category),
    textOf(tx.gl_account),
    tx.accounting_category_name,
    tx.gl_account_name,
    accountingCategoryOf(tx),
  );
  const category = firstText(
    textOf(tx.category),
    textOf(tx.merchant_category),
    tx.sk_category_name,
    tx.category_name,
    tx.merchant_category_code_description,
    accountingSelection(tx, /category|categor[ií]a|class|clase/i),
  );
  const resolvedRestaurant = canonicalRestaurant(
    tx.location_name,
    nameOf(location),
    cardHolder.location_name,
    resolvedDepartment,
    references.location,
    resolvedMemo,
    category,
    accountingCategory,
  ) || firstText(tx.location_name, nameOf(location), references.location);
  const role = operationalRole(
    references.role,
    tx.job_title,
    tx.position,
    cardHolder.job_title,
    cardHolder.role,
    cardHolder.department_name,
    resolvedDepartment,
  );
  return {
    id: String(tx.id || tx.transaction_id || ''),
    date,
    transactionTime: transactionTime || undefined,
    merchant: tx.merchant_name || tx.merchant?.name || tx.merchant?.merchant_name || 'Unknown merchant',
    merchantLocation: merchantLocationOf(tx),
    amount: dollars(tx.amount ?? tx.amount_details ?? tx.total_amount ?? tx.cardholder_amount),
    cardholder: resolvedCardholder,
    role,
    department: resolvedDepartment,
    restaurant: resolvedRestaurant,
    entity: nameOf(tx.entity) || tx.entity_name || references.entity,
    category,
    accountingCategory,
    cardLastFour: String(tx.card?.last_four || tx.card?.last_four_digits || tx.card_last_four || tx.last_four || '').trim() || undefined,
    memo: resolvedMemo,
    receiptAttached: hasReceipt || Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length || tx.receipt_attached || tx.has_receipt),
    state: status.includes('PENDING') ? 'PENDING' : 'CLEARED',
    source: 'Ramp',
  };
}
