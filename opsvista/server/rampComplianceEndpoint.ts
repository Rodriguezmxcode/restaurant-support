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

function asObject(value: any): Record<string, any> {
  return value && typeof value === 'object' ? value : {};
}

function firstText(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function personName(user: any): string | undefined {
  return firstText(
    user.display_name,
    user.full_name,
    user.name,
    [user.first_name, user.last_name].filter(Boolean).join(' '),
    user.email,
  );
}

function classifyRole(...values: any[]): string | undefined {
  const original = values.find(value => typeof value === 'string' && value.trim())?.trim();
  if (!original) return undefined;
  const value = values.filter(item => typeof item === 'string').join(' ').toLowerCase();
  if (/sub\s*chef|sous\s*chef|chef|kitchen|cocina/.test(value)) return 'Chef';
  if (/manager|general manager|assistant manager|gerente/.test(value)) return 'Manager';
  if (/maintenance|mantenimiento|facilities/.test(value)) return 'Maintenance';
  if (/corporate|operations|office|administration|administrative|admin/.test(value)) return 'Corporate';
  return original;
}

function userIdOf(value: any): string | undefined {
  const object = asObject(value);
  return firstText(object.id, object.user_id, object.uuid);
}

function transactionUserId(tx: any): string | undefined {
  return firstText(
    tx.card_holder_id,
    tx.cardholder_id,
    tx.user_id,
    tx.user_uuid,
    userIdOf(tx.card_holder),
    userIdOf(tx.cardholder),
    userIdOf(tx.user),
    userIdOf(asObject(tx.card).card_holder),
    userIdOf(tx.spent_by),
  );
}

function userReferences(user: any) {
  const department = asObject(user.department);
  const location = asObject(user.location);
  const entity = asObject(user.entity);
  const role = asObject(user.role);
  const jobTitle = firstText(
    user.job_title,
    user.title,
    user.position,
    user.role_name,
    role.name,
    role.display_name,
  );
  const departmentName = firstText(user.department_name, department.name, department.display_name);
  return {
    cardholder: personName(user),
    role: classifyRole(jobTitle, departmentName),
    department: departmentName,
    location: firstText(user.location_name, location.name, location.display_name),
    entity: firstText(user.entity_name, entity.name, entity.display_name),
  };
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
  let users: any[] = [];
  let userEnrichmentWarning: string | undefined;
  try {
    users = await collect<any>('users');
  } catch (error) {
    userEnrichmentWarning = error instanceof Error
      ? `Ramp user enrichment unavailable: ${error.message}`
      : 'Ramp user enrichment unavailable.';
  }
  const usersById = new Map<string, any>();
  users.forEach(user => {
    const id = userIdOf(user);
    if (id) usersById.set(id, user);
  });
  const normalized = transactions
    .map(tx => {
      const user = usersById.get(transactionUserId(tx) || '');
      return normalizeRampTransaction(
        tx,
        tx.memo || tx.memo_text || tx.memos?.[0]?.memo,
        Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length || tx.receipt_attached),
        user ? userReferences(user) : {},
      );
    })
    .filter(tx => tx.id && tx.date >= range.fromDate && tx.date <= range.toDate);

  return {
    source: 'live' as const,
    fetchedAt: new Date().toISOString(),
    fromDate: range.fromDate,
    toDate: range.toDate,
    serverVersion: 'ramp-live-v3-users',
    rawTransactionCount: transactions.length,
    userEnrichment: {
      available: users.length > 0,
      userCount: users.length,
      matchedTransactions: normalized.filter(tx => Boolean(tx.cardholder)).length,
      warning: userEnrichmentWarning,
    },
    warning: userEnrichmentWarning,
    transactions: normalized,
  };
}
