import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, companyFinanceResult, financeImportKeys, financeKey, financeLocations, parseFinanceImport, summarizeFinance, type CorporateFinanceRecord, type FinanceRecord } from '../shared/finance.js';
import { FinanceConflict, listCorporateFinance, listFinance, saveFinance } from './financeStore.js';
import { financeEndpoint } from './financeEndpoint.js';
import { canAccessModule, normalizeModule } from '../src/accessControl.js';
import type { SessionUser } from './authSession.js';

const org = 'org-puerto-vallarta';
const user: SessionUser = { id: 'fixture', name: 'Fixture', email: 'fixture@example.invalid', title: '', role: 'Founder', organizationId: org, locations: [] };
const sample = (changes: Partial<FinanceRecord> = {}): FinanceRecord => ({
  location: 'Avon', month: '2026-08', currency: 'USD', status: 'provisional', sales: 1000, cogs: 250, labor: 300, operatingExpenses: 350, operatingResult: 100,
  extraordinary: null, payrollBasis: 'Four payroll payments (test fixture)', corporateStatus: 'incomplete', rampIncluded: null, notes: ['Test fixture, not a business report.'],
  source: { file: 'fixture.xlsx', sha256: 'a'.repeat(64), references: { sales: 'PNL!B1', cogs: 'PNL!B2', labor: 'PNL!B3', operatingExpenses: 'PNL!B4', operatingResult: 'PNL!B5' } }, bank: null, ...changes,
});
const batch = (...records: FinanceRecord[]) => parseFinanceImport({ format: 'opsvista-finance-v1', records });
const expected = (records: FinanceRecord[]) => Object.fromEntries(records.map(row => [financeKey(row), null]));
const headers = { host: 'opsvista.invalid', origin: 'https://opsvista.invalid', 'sec-fetch-site': 'same-origin', 'x-opsvista-finance': 'import', 'content-type': 'application/json' };
function response() { return { code: 0, body: null as any, headers: {} as Record<string, string>, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; }, setHeader(key: string, value: string) { this.headers[key] = value; } }; }

test('validates financial reconciliation, dates, precision, provenance, missingness and duplicate keys', () => {
  assert.equal(calendarDays('2026-09'), 30); assert.equal(calendarDays('2026-08'), 31); assert.equal(calendarDays('2028-02'), 29);
  assert.equal(batch(sample()).records[0].extraordinary, null);
  for (const change of [{ month: '2026-13' }, { location: 'Other' }, { sales: null }, { sales: '1000' }, { sales: 1000.001 }, { labor: -3 }, { operatingResult: 200 }, { corporateStatus: 'complete' }, { extraordinary: 20 }, { rampIncluded: 10 }, { bank: { asOf: '2026-09-31', closingBalance: 50, reference: 'Bank!A1', note: 'Fixture' } }, { source: { file: 'x', sha256: 'a'.repeat(64), references: {} } }, { organizationId: 'other' }]) assert.throws(() => batch(sample(change as any)));
  assert.throws(() => batch(sample(), sample()));
  const negative = batch(sample({ operatingExpenses: 550, operatingResult: -100 })); assert.equal(negative.records[0].operatingResult, -100);
  const expensesAlreadyIncludeRamp = sample({ rampIncluded: 30, extraordinary: 40, source: { ...sample().source, references: { ...sample().source.references, rampIncluded: 'PNL!B6', extraordinary: 'PNL!B7' } } });
  assert.equal(summarizeFinance(batch(expensesAlreadyIncludeRamp).records).operatingResult, 100);
});
test('aggregates cents and weighted margins without treating missing reports as zero', () => {
  assert.equal(summarizeFinance([]).sales, null); assert.equal(summarizeFinance([]).margin, null);
  const totals = summarizeFinance([sample(), sample({ location: 'Orange', sales: 9000, operatingExpenses: 8250, operatingResult: 200 })]);
  assert.equal(totals.sales, 10000); assert.equal(totals.operatingResult, 300); assert.equal(totals.margin, 3); assert.equal(totals.count, 2);
  assert.equal(summarizeFinance([sample({ sales: 0, cogs: 0, labor: 0, operatingExpenses: 0, operatingResult: 0 })]).margin, null);
});
test('Finance has its own restricted destination while payment and action routes stay distinct', () => {
  assert.equal(normalizeModule('Finanzas'), 'Finanzas'); assert.equal(normalizeModule('Prioridades'), 'Action Center');
  for (const role of ['Founder', 'Corporate', 'Administration']) assert.equal(canAccessModule({ ...user, active: true, role } as any, 'Finanzas'), true);
  for (const role of ['Location Manager', 'Kitchen', 'HR', 'Maintenance', 'Online Reputation Manager']) assert.equal(canAccessModule({ ...user, active: true, role } as any, 'Finanzas'), false);
  assert.equal(canAccessModule({ ...user, active: true, role: 'Location Manager' } as any, 'Pagos'), true);
});
test('denies unsigned, wrong-role, cross-tenant and cross-origin operations before accessing storage', async () => {
  const payload = batch(sample()); const base = { method: 'POST', headers, query: { resource: 'finance' }, body: { batch: payload, expected: expected(payload.records) } };
  const deps = { save: async () => { throw Error('must not write'); }, list: async () => { throw Error('must not read'); }, listCorporate: async () => { throw Error('must not read'); } };
  for (const [actor, status] of [[null, 401], [{ ...user, role: 'Location Manager' }, 403], [{ ...user, role: 'Administration' }, 403], [{ ...user, organizationId: 'other' }, 403], [{ ...user, role: 'Corporate', organizationId: undefined }, 403]] as const) {
    const res = response(); await financeEndpoint(base, res, actor as SessionUser | null, deps); assert.equal(res.code, status);
  }
  for (const override of [{ origin: undefined }, { origin: 'https://evil.invalid' }, { origin: 'http://opsvista.invalid' }, { 'sec-fetch-site': 'same-site' }, { 'x-opsvista-finance': undefined }]) { const res = response(); await financeEndpoint({ ...base, headers: { ...headers, ...override } }, res, user, deps); assert.equal(res.code, 403); }
  const wrongQuery = response(); await financeEndpoint({ ...base, query: { resource: 'finance', organizationId: 'other' } }, wrongQuery, user, deps); assert.equal(wrongQuery.code, 400);
  const missingReview = response(); await financeEndpoint({ ...base, body: { batch: payload, expected: {} } }, missingReview, user, deps); assert.equal(missingReview.code, 400);
  const invalid = response(); await financeEndpoint({ ...base, body: { batch: { ...payload, records: [sample({ operatingResult: 999 })] }, expected: expected(payload.records) } }, invalid, user, deps); assert.equal(invalid.code, 400);
  const read = response(); await financeEndpoint({ method: 'GET', query: { resource: 'finance' } }, read, { ...user, role: 'Administration' }, { ...deps, list: async () => [], listCorporate: async () => [] }); assert.equal(read.code, 200); assert.equal(read.headers['Cache-Control'], 'private, no-store');
  const unavailable = response(); await financeEndpoint(base, unavailable, user, deps); assert.equal(unavailable.code, 503); assert.doesNotMatch(JSON.stringify(unavailable.body), /must not write/);
});
test('SQL storage is atomic, tenant-isolated, retry-safe and preserves old versions on correction', async () => {
  process.env.OPSVISTA_DATABASE_URL = 'postgres://fixture';
  const payload = batch(sample());
  const results = await Promise.all(Array.from({ length: 4 }, () => saveFinance(org, user.id, payload, expected(payload.records))));
  assert.equal(results.reduce((n, row) => n + row.saved, 0), 1);
  assert.equal((await listFinance(org)).length, 1); assert.equal((await listFinance('other')).length, 0);
  const original = (await listFinance(org))[0];
  const changed = batch(sample({ operatingExpenses: 340, operatingResult: 110 }));
  await assert.rejects(() => saveFinance(org, user.id, changed, expected(changed.records)), FinanceConflict);
  await saveFinance(org, user.id, changed, { [financeKey(original.record)]: original.revision });
  const updated = (await listFinance(org))[0]; assert.equal(updated.record.operatingResult, 110); assert.notEqual(updated.revision, original.revision);
  // First insert would succeed but the second conflicts: the entire batch rolls back.
  const conflicting = batch(sample({ month: '2026-07' }), sample());
  await assert.rejects(() => saveFinance(org, user.id, conflicting, expected(conflicting.records)), FinanceConflict);
  assert.equal((await listFinance(org)).length, 1);
  await saveFinance('other', 'other', payload, expected(payload.records)); assert.equal((await listFinance('other'))[0].record.operatingResult, 100);
  const { fixtureQuery } = await import('postgres') as any;
  const versions = await fixtureQuery('select payload,imported_by from opsvista_finance_versions where organization_id=$1 order by version_id', [org]);
  assert.equal(versions.rows.length, 2); assert.equal(versions.rows[0].payload.operatingResult, 100); assert.equal(versions.rows[1].payload.operatingResult, 110); assert.equal(versions.rows[1].imported_by, user.id);
});
test('real endpoint persists a valid batch and acknowledges identical retries only after commit', async () => {
  const payload = batch(sample({ month: '2026-09' }));
  const request = { method: 'POST', query: { resource: 'finance' }, headers, body: { batch: payload, expected: expected(payload.records) } };
  const first = response(); await financeEndpoint(request, first, user); assert.equal(first.code, 200); assert.equal(first.body.saved, 1);
  const retry = response(); await financeEndpoint(request, retry, user); assert.equal(retry.code, 200); assert.equal(retry.body.unchanged, 1);
  const edit = response(); await financeEndpoint({ ...request, body: { ...request.body, batch: batch(sample({ month: '2026-09', operatingExpenses: 320, operatingResult: 130 })) } }, edit, user); assert.equal(edit.code, 409);
});
test('corporate cost reconciles to its components and stays distinct until existing allocations are known', async () => {
  const corporate: CorporateFinanceRecord = { month: '2026-08', currency: 'USD', status: 'provisional', totalExpenses: 75, labor: 50, operatingExpenses: 10, occupancy: 15, cogs: 0, otherExpenses: 0, alreadyAllocated: null, sourceLabel: 'User-provided fixture excerpt', notes: ['Corporate allocation pending.'] };
  const records = financeLocations.map(location => sample({ location }));
  const payload = parseFinanceImport({ format: 'opsvista-finance-v1', records, corporate: [corporate] });
  assert.deepEqual(companyFinanceResult(records, corporate), { simpleDifference: 525, reconciledResult: null });
  assert.deepEqual(companyFinanceResult(records, { ...corporate, alreadyAllocated: 25 }), { simpleDifference: 525, reconciledResult: 550 });
  assert.equal(companyFinanceResult(records.slice(0, 5), corporate).simpleDifference, null);
  assert.equal(companyFinanceResult(records, { ...corporate, month: '2026-09' }).simpleDifference, null);
  for (const change of [{ totalExpenses: 80 }, { alreadyAllocated: 76 }, { alreadyAllocated: -1 }]) assert.throws(() => parseFinanceImport({ ...payload, corporate: [{ ...corporate, ...change }] }));
  assert.throws(() => parseFinanceImport({ ...payload, corporate: [corporate, corporate] }));
  const review = Object.fromEntries(financeImportKeys(payload).map(key => [key, null]));
  assert.equal((await saveFinance('corporate-fixture', user.id, payload, review)).saved, 7);
  assert.equal((await saveFinance('corporate-fixture', user.id, payload, review)).unchanged, 7);
  assert.equal((await listFinance('corporate-fixture')).length, 6);
  assert.equal((await listCorporateFinance('corporate-fixture'))[0].record.totalExpenses, 75);
  assert.equal((await listCorporateFinance('unrelated')).length, 0);
});
