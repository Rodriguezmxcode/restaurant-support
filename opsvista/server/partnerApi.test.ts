import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerApiEndpoint, partnerKeyEndpoint, parseInvoiceQuery, projectPartnerInvoices } from './partnerApi.js';
import { createPartnerKey, authenticatePartnerKey, listPartnerKeys, reservePartnerRequest, revokePartnerKey } from './partnerApiStore.js';
import { PUERTO_VALLARTA_ORG as org } from '../shared/tenantAccess.js';
import type { SessionUser } from './authSession.js';

const founder: SessionUser = { id: 'fixture-founder', email: 'fixture@example.invalid', name: 'Fixture', title: '', role: 'Founder', organizationId: org, locations: [] };
const snapshot: any = { provider: 'restaurant365-odata', period: { start: '2026-08-01', endExclusive: '2026-09-01' }, fetchedAt: '2026-09-21T12:00:00.000Z', transactions: [
  { id: '1', number: '100', date: '2026-08-04', entity: 'Avon', vendor: 'Vendor', approved: true, amount: 120, createdBy: 'PRIVATE_USER' },
  { id: '2', number: '101', date: '2026-08-05', entity: 'Orange', vendor: 'Vendor', approved: false, amount: null },
  { id: '3', number: '102', date: '2026-08-06', entity: 'Corporate Office', approved: true, amount: 25 },
  { id: '4', number: 'PRIVATE', date: '2026-08-06', entity: 'Other tenant', approved: true, amount: 999 },
  { id: '5', number: 'OUT_OF_RANGE', date: '2026-07-31', entity: 'Avon', approved: true, amount: 999 },
] };
const params = { endpoint: 'invoices', start: '2026-08-01', end: '2026-08-31' };
const deps: any = { authenticate: async () => ({ id: 'fixture', organizationId: org }), reserve: async () => true,
  readInvoices: async (organization: string) => { assert.equal(organization, org); return { data: snapshot, memory: { pending: true } }; } };
function response() { return { code: 0, body: null as any, headers: {} as Record<string, string>, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; }, setHeader(key: string, value: string) { this.headers[key] = value; } }; }
async function request(query: any = params, overrides: any = {}, extra: any = {}) {
  const res = response(); await partnerApiEndpoint({ method: 'GET', query, ...extra }, res, { ...deps, ...overrides }); return res;
}
test('external routes require an API key and reject another organization', async () => {
  for (const key of [null, { id: 'x', organizationId: 'other' }]) {
    const res = await request(params, { authenticate: async () => key, reserve: async () => { throw new Error('MUST NOT RESERVE'); } });
    assert.equal(res.code, 401); assert.equal(res.body.error.code, 'invalid_api_key');
  }
  for (const header of [undefined, 'Bearer invalid', ['Bearer invalid'], 'Basic value']) assert.equal(await authenticatePartnerKey(header), null);
});
test('API is read-only and has no arbitrary resource or query execution', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await request(params, {}, { method })).code, 405);
  assert.equal((await request({ endpoint: 'payments' })).code, 404);
  for (const field of ['organization_id', 'sql', 'token', 'refresh']) assert.equal((await request({ ...params, [field]: 'injected' })).code, 400);
});
test('locations have stable IDs including Corporate Office', async () => {
  const res = await request({ endpoint: 'locations' });
  assert.equal(res.code, 200); assert.equal(res.body.data.length, 7);
  assert.equal(res.body.data.find((row: any) => row.name === 'Corporate Office').id, 'corporate-office');
});
test('invoice export scopes rows, preserves null amounts, freshness and unavailable payments', async () => {
  const res = await request(); assert.equal(res.code, 200);
  assert.equal(res.body.pagination.total, 3); assert.equal(res.body.totals.known_invoice_amount, 145);
  assert.equal(res.body.totals.missing_amounts, 1); assert.equal(res.body.source.refresh_pending, true);
  assert.equal(res.body.data[0].id, 'r365:1'); assert.equal(res.body.data[0].payment_status, 'unavailable');
  assert.equal(res.body.data[0].paid_amount, null); assert.equal(res.body.data[1].amount, null);
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE|OUT_OF_RANGE|999/);
  assert.equal((await request({ ...params, location_id: 'avon', approval_status: 'approved' })).body.pagination.total, 1);
  assert.equal((await request({ ...params, approval_status: 'unapproved' })).body.totals.known_invoice_amount, null);
});
test('pagination is stable and rejects changing snapshots', async () => {
  const first = await request({ ...params, limit: '1' });
  assert.equal(first.body.pagination.next_offset, 1);
  const second = await request({ ...params, limit: '1', offset: '1', snapshot_at: first.body.pagination.snapshot_at });
  assert.equal(second.body.data[0].id, 'r365:2'); assert.equal(second.body.totals.invoice_count, 3);
  assert.equal((await request({ ...params, offset: '1' })).code, 400);
  assert.equal((await request({ ...params, offset: '1', snapshot_at: 'old' })).code, 409);
});
test('invalid dates, long ranges, repeated and oversized parameters fail closed', () => {
  for (const query of [{ ...params, start: '2026-02-30' }, { ...params, start: '2026-07-31' }, { ...params, start: '2026-09-01' }, { ...params, limit: '201' }, { ...params, offset: '-1' }, { ...params, location_id: 'Other tenant' }, { ...params, approval_status: 'paid' }, { ...params, start: ['2026-08-01'] }]) assert.throws(() => parseInvoiceQuery({ query }));
  assert.equal(parseInvoiceQuery({ query: params }).period.endExclusive, '2026-09-01');
});
test('zero amounts and unknown approvals do not become paid invoices', () => {
  const data = projectPartnerInvoices({ ...snapshot, transactions: [{ ...snapshot.transactions[0], amount: 0, approved: undefined }] }, parseInvoiceQuery({ query: params }));
  assert.equal(data.totals.known_invoice_amount, 0);
  assert.equal(data.data[0].approval_status, 'unknown'); assert.equal(data.data[0].outstanding_amount, null);
});
test('unavailable source and throttling never turn into empty success responses', async () => {
  assert.equal((await request(params, { reserve: async () => false })).code, 429);
  assert.equal((await request(params, { readInvoices: async () => ({ data: null, memory: { error: 'SECRET' } }) })).code, 503);
  const res = await request(params, { readInvoices: async () => { throw new Error('SECRET database URL'); } });
  assert.equal(res.code, 503); assert.doesNotMatch(JSON.stringify(res.body), /SECRET/);
  assert.equal((await request(params, { readInvoices: async () => ({ data: { ...snapshot, period: { start: '2026-07-01' } }, memory: {} }) })).code, 503);
});
test('key issuance requires Founder, the right tenant, same origin, and JSON', async () => {
  const base = { method: 'POST', headers: { host: 'opsvista.invalid', origin: 'https://opsvista.invalid', 'content-type': 'application/json' }, body: { action: 'create', name: 'Fixture' } };
  for (const user of [{ ...founder, role: 'Corporate' }, { ...founder, role: 'Location Manager' }, { ...founder, organizationId: 'other' }]) {
    const res = response(); await partnerKeyEndpoint(base, res, user as SessionUser); assert.equal(res.code, 403);
  }
  for (const origin of ['https://evil.invalid', undefined]) {
    const res = response(); await partnerKeyEndpoint({ ...base, headers: { ...base.headers, origin } }, res, founder); assert.equal(res.code, 403);
  }
  const res = response(); await partnerKeyEndpoint({ ...base, headers: { ...base.headers, 'content-type': 'text/plain' } }, res, founder); assert.equal(res.code, 415);
});
test('real key storage hashes tokens, enforces expiry/revocation and a concurrent quota', async () => {
  process.env.OPSVISTA_DATABASE_URL = 'postgres://fixture';
  const created = await createPartnerKey(org, founder.id, 'PV fixture'); assert.ok(created);
  assert.equal(/^ovp_[A-Za-z0-9_-]{43}$/.test(created.token), true);
  const principal = await authenticatePartnerKey(`Bearer ${created.token}`); assert.equal(principal?.organizationId, org);
  const listed = await listPartnerKeys(org); assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes(created.token), false); assert.equal('token_hash' in listed[0], false);
  // @ts-expect-error test adapter exports a direct database query
  const { fixtureQuery } = await import('postgres');
  const stored = await fixtureQuery('select token_hash from opsvista_partner_keys where id=$1', [created.key.id]);
  assert.equal(stored.rows[0].token_hash.length, 64); assert.notEqual(stored.rows[0].token_hash, created.token);
  const allowed = await Promise.all(Array.from({ length: 35 }, () => reservePartnerRequest(created.key.id)));
  assert.equal(allowed.filter(Boolean).length, 30);
  assert.equal(await revokePartnerKey('other', created.key.id), false);
  assert.equal(await revokePartnerKey(org, created.key.id), true);
  assert.equal(await authenticatePartnerKey(`Bearer ${created.token}`), null);
  assert.equal(await reservePartnerRequest(created.key.id), false);
  const expired = await createPartnerKey(org, founder.id, 'Expired'); assert.ok(expired);
  await fixtureQuery("update opsvista_partner_keys set expires_at=now()-interval '1 day' where id=$1", [expired.key.id]);
  assert.equal(await authenticatePartnerKey(`Bearer ${expired.token}`), null);
  for (let i = 0; i < 5; i++) assert.ok(await createPartnerKey(org, founder.id, `Key ${i}`));
  assert.equal(await createPartnerKey(org, founder.id, 'Sixth key'), null);
});
