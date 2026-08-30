import { rampGet } from './rampClient.js';
import { normalizeRampTransaction } from './rampNormalize.js';
import { scopeRampTransactionsForLocations } from '../shared/rampAccess.js';
import { listManagedUsers, type ManagedDirectoryUser } from './managementStore.js';

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

  // A 30-day view can exceed 1,000 transactions across all restaurants.
  // Follow up to 5,000 records so the dashboard does not silently undercount.
  for (let i = 0; i < 50; i += 1) {
    const page = await rampGet<Page<T>>(path, { ...query, page_size: 100, start });
    rows.push(...(page.data ?? []));
    const next = page.page?.next || undefined;
    if (next) {
      try { start = new URL(next).searchParams.get('start') || next; }
      catch { start = next; }
    } else start = undefined;
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
  const value = values.filter(item => typeof item === 'string').join(' ').toLowerCase();
  if (/sub\s*chef|sous\s*chef|chef|kitchen|cocina/.test(value)) return 'Chef';
  if (/manager|general manager|assistant manager|gerente/.test(value)) return 'Manager';
  if (/maintenance|mantenimiento|facilities/.test(value)) return 'Maintenance';
  if (/corporate|executive|president|owner|founder|operations|office|administration|administrative|admin/.test(value)) return 'Corporate';
  return undefined;
}

function normalizeIdentity(value: string | undefined) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function managedRole(user: ManagedDirectoryUser): string {
  if (user.role === 'Kitchen') return 'Chef';
  if (user.role === 'Location Manager') return 'Manager';
  if (user.role === 'Maintenance') return 'Maintenance';
  return 'Corporate';
}

function managedDepartment(user: ManagedDirectoryUser): string {
  if (user.role === 'Kitchen') return 'Kitchen';
  if (user.role === 'Location Manager') return 'Restaurant Management';
  if (user.role === 'Maintenance') return 'Maintenance';
  if (user.role === 'Administration') return 'Administration';
  if (user.role === 'HR') return 'Human Resources';
  return 'Corporate';
}

function managedLocation(user: ManagedDirectoryUser): string | undefined {
  if (user.locations.length === 1) return user.locations[0];
  if (['Founder', 'Corporate', 'Administration', 'HR', 'Maintenance'].includes(user.role)) return 'Corporate';
  return undefined;
}

function transactionEmails(tx: any): string[] {
  return [
    tx.card_holder_email,
    tx.cardholder_email,
    asObject(tx.card_holder).email,
    asObject(tx.cardholder).email,
    asObject(tx.user).email,
    asObject(tx.spent_by).email,
  ].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim().toLowerCase());
}

function userIdOf(value: any): string | undefined {
  const object = asObject(value);
  return firstText(object.id, object.user_id, object.uuid);
}

function referenceMap(rows: any[], idKeys: string[], nameKeys: string[]) {
  const result = new Map<string, string>();
  rows.forEach(row => {
    const object = asObject(row);
    const id = firstText(...idKeys.map(key => object[key]));
    const name = firstText(...nameKeys.map(key => object[key]));
    if (id && name) result.set(id, name);
  });
  return result;
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

function managerSafeTransaction<T extends ReturnType<typeof normalizeRampTransaction>>(tx: T) {
  return {
    id:tx.id,
    date:tx.date,
    transactionTime:tx.transactionTime,
    merchant:tx.merchant,
    merchantLocation:tx.merchantLocation,
    amount:tx.amount,
    cardholder:tx.cardholder,
    department:tx.department,
    restaurant:tx.verifiedRestaurant,
    verifiedRestaurant:tx.verifiedRestaurant,
    memo:tx.memo,
    receiptAttached:tx.receiptAttached,
    rampUrl:tx.rampUrl,
    state:tx.state,
    source:tx.source,
  };
}

export async function getRampCompliancePayload(
  params?: { fromDate?: string; toDate?: string },
  access?: { allowedLocations?: string[]; locationScoped?: boolean },
) {
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
  let departments: any[] = [];
  let locations: any[] = [];
  let managedUsers: ManagedDirectoryUser[] = [];
  let userEnrichmentWarning: string | undefined;
  const [rampUsersResult, managedUsersResult, departmentsResult, locationsResult] = await Promise.allSettled([
    collect<any>('users'),
    listManagedUsers(),
    collect<any>('departments'),
    collect<any>('locations'),
  ]);
  if (rampUsersResult.status === 'fulfilled') users = rampUsersResult.value;
  else userEnrichmentWarning = rampUsersResult.reason instanceof Error
    ? `Ramp user enrichment unavailable: ${rampUsersResult.reason.message}`
    : 'Ramp user enrichment unavailable.';
  if (managedUsersResult.status === 'fulfilled') managedUsers = managedUsersResult.value.filter(user => user.active);
  if (departmentsResult.status === 'fulfilled') departments = departmentsResult.value;
  if (locationsResult.status === 'fulfilled') locations = locationsResult.value;
  const departmentsById = referenceMap(departments, ['id', 'uuid', 'department_id'], ['name', 'display_name', 'department_name']);
  const locationsById = referenceMap(locations, ['id', 'uuid', 'location_id'], ['name', 'display_name', 'location_name']);
  const usersById = new Map<string, any>();
  users.forEach(user => {
    const id = userIdOf(user);
    if (id) usersById.set(id, user);
  });
  const managedByEmail = new Map(managedUsers.filter(user => user.email).map(user => [String(user.email).toLowerCase(), user]));
  const managedByName = new Map(managedUsers.map(user => [normalizeIdentity(user.name), user]));
  let directoryMatchedTransactions = 0;
  const normalized = transactions
    .map(tx => {
      const user = usersById.get(transactionUserId(tx) || '');
      const rampUserReferences = user ? userReferences(user) : {};
      const transactionDepartment = asObject(tx.department);
      const transactionLocation = asObject(tx.location);
      const userDepartment = asObject(user?.department);
      const userLocation = asObject(user?.location);
      const departmentId = firstText(
        tx.department_id,
        transactionDepartment.id,
        transactionDepartment.uuid,
        user?.department_id,
        userDepartment.id,
        userDepartment.uuid,
      );
      const locationId = firstText(
        tx.location_id,
        transactionLocation.id,
        transactionLocation.uuid,
        user?.location_id,
        userLocation.id,
        userLocation.uuid,
      );
      const officialDepartment = firstText(
        tx.department_name,
        transactionDepartment.name,
        transactionDepartment.display_name,
        departmentId ? departmentsById.get(departmentId) : undefined,
        rampUserReferences.department,
      );
      const officialLocation = firstText(
        tx.location_name,
        transactionLocation.name,
        transactionLocation.display_name,
        locationId ? locationsById.get(locationId) : undefined,
        rampUserReferences.location,
      );
      // Department/location IDs are official Ramp relationships. Resolve them
      // to names before normalization so manager scoping never depends on a
      // cardholder name, merchant, or free-form memo.
      const enrichedTx = {
        ...tx,
        department_name: officialDepartment,
        location_name: officialLocation,
      };
      const memo = tx.memo || tx.memo_text || tx.memos?.[0]?.memo;
      const receipt = Boolean(tx.receipt || tx.receipt_url || tx.receipts?.length || tx.receipt_attached || tx.has_receipt);
      const initial = normalizeRampTransaction(
        enrichedTx,
        memo,
        receipt,
        rampUserReferences,
      );
      const managed = transactionEmails(tx).map(email => managedByEmail.get(email)).find(Boolean)
        || managedByName.get(normalizeIdentity(initial.cardholder));
      if (!managed) return initial;
      directoryMatchedTransactions += 1;
      return normalizeRampTransaction(enrichedTx, memo, receipt, {
        cardholder: initial.cardholder || managed.name,
        role: initial.role || managedRole(managed),
        department: initial.department || managedDepartment(managed),
        location: initial.restaurant || managedLocation(managed),
        entity: initial.entity,
      });
    })
    .filter(tx => tx.id && tx.date >= range.fromDate && tx.date <= range.toDate);

  const allowedLocationNames = Array.from(new Set((access?.allowedLocations ?? []).map(location=>location.trim()).filter(Boolean)));
  const scopedTransactions = access?.locationScoped
    ? scopeRampTransactionsForLocations(normalized,allowedLocationNames)
    : normalized;
  const scopedCardholders = new Set(scopedTransactions.map(tx=>tx.cardholder?.trim()).filter(Boolean));
  const responseTransactions = access?.locationScoped ? scopedTransactions.map(managerSafeTransaction) : scopedTransactions;

  return {
    source: 'live' as const,
    fetchedAt: new Date().toISOString(),
    fromDate: range.fromDate,
    toDate: range.toDate,
    serverVersion: 'ramp-live-v6-reference-scope',
    rawTransactionCount: access?.locationScoped ? scopedTransactions.length : transactions.length,
    accessScope: {
      mode: access?.locationScoped ? 'location' as const : 'portfolio' as const,
      locations: access?.locationScoped ? allowedLocationNames : [],
      verifiedLocationOnly: Boolean(access?.locationScoped),
    },
    userEnrichment: {
      available: users.length > 0,
      userCount: access?.locationScoped ? scopedCardholders.size : users.length,
      matchedTransactions: scopedTransactions.filter(tx => Boolean(tx.cardholder)).length,
      directoryMatchedTransactions: access?.locationScoped ? undefined : directoryMatchedTransactions,
      warning: access?.locationScoped ? undefined : userEnrichmentWarning,
    },
    warning: access?.locationScoped ? undefined : userEnrichmentWarning,
    transactions: responseTransactions,
  };
}
