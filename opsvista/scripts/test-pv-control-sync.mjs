import test from 'node:test';
import assert from 'node:assert/strict';
import { collectInvoices } from '../public/pv-control-sync.js';
const dates = { start: '2026-09-01', end: '2026-09-22' };
const row = (id, amount = null) => ({ id, location_id: 'avon', amount });
function page(rows, offset, total, next, snapshot = '2026-09-22T10:00:00.000Z') {
  return { api_version: '1', organization_id: 'org-puerto-vallarta', data: rows, pagination: { offset, total, next_offset: next, snapshot_at: snapshot }, source: { snapshot_at: snapshot, refresh_pending: false } };
}
test('complete pages retain null and zero amounts and the exact snapshot', async () => {
  const calls = [];
  const result = await collectInvoices(async path => { calls.push(path); return calls.length === 1 ? page([row('a', null)], 0, 2, 1) : page([row('b', 0)], 1, 2, null); }, dates);
  assert.equal(result.rows.length, 2); assert.equal(result.rows[0].amount, null); assert.equal(result.rows[1].amount, 0);
  assert.match(calls[1], /snapshot_at=2026-09-22T10%3A00%3A00.000Z/);
});
test('failed page never returns partial data or empty success', async () => {
  for (const status of [401, 429, 503]) {
    let count = 0;
    await assert.rejects(collectInvoices(async () => { if (++count === 1) return page([row('partial')], 0, 2, 1); throw Object.assign(new Error('failed'), { status }); }, dates), /failed/);
  }
});
test('snapshot conflict discards old pages and restarts once', async () => {
  let count = 0;
  const result = await collectInvoices(async path => {
    if (++count === 1) return page([row('old')], 0, 2, 1);
    if (count === 2) throw Object.assign(new Error('changed'), { status: 409, code: 'snapshot_changed' });
    assert.match(path, /offset=0/); assert.doesNotMatch(path, /snapshot_at/);
    return page([row('new')], 0, 1, null, '2026-09-22T11:00:00.000Z');
  }, dates);
  assert.deepEqual(result.rows.map(row => row.id), ['new']);
  let attempts = 0;
  await assert.rejects(collectInvoices(async () => { attempts++; throw Object.assign(new Error('changed'), { status: 409, code: 'snapshot_changed' }); }, dates), /changed/);
  assert.equal(attempts, 2);
});
test('invalid totals, duplicates, tenant, pagination and dates fail closed', async () => {
  for (const response of [page([row('a')], 0, 2, null), page([row('a'), row('a')], 0, 2, null), page([row('a')], 0, 2, 0), { ...page([], 0, 0, null), organization_id: 'other' }]) await assert.rejects(collectInvoices(async () => response, dates));
  await assert.rejects(collectInvoices(async () => { throw new Error('must not call'); }, { start: '2026-08-01', end: '2026-09-22' }), /31 días/);
});
