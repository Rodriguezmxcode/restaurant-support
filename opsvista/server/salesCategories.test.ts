import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCategorySales } from './toastCategorySales.js';
import { salesCategoriesEndpoint } from './salesCategoriesEndpoint.js';
import { categoryTotals, mergeCategoryReports } from '../shared/salesCategories.js';
import type { SessionUser } from './authSession.js';

const start = '2026-09-16', end = '2026-09-22';
const names = new Map([['food', 'Food'], ['bar', 'Liquor']]);
const item = { price: 90, preDiscountPrice: 100, quantity: 2, salesCategory: { guid: 'food' } };
test('uses final Toast selection amounts once, excluding tax and nested modifiers; separates refunds', () => {
  const order = { guid: 'order-1', businessDate: 20260916, checks: [{ selections: [{ ...item, modifiers: [{ price: 10, quantity: 2 }], refundDetails: { refundAmount: 20, taxRefundAmount: 1.5 } }], payments: [{ refund: { refundAmount: 21.5 } }] }] };
  const report = summarizeCategorySales([order, order], names, 'Orange', start, end);
  assert.deepEqual(categoryTotals(report.rows), { quantity: 2, grossSales: 100, discounts: 10, refunds: 20, netSales: 70 });
  assert.equal(report.warnings.unallocatedRefunds, 0);
});
test('excludes void, deleted, excess-food and deferred sales at every relevant level and honors business dates', () => {
  const valid = { businessDate: 20260916, checks: [{ selections: [item] }] };
  const report = summarizeCategorySales([
    valid, { ...valid, businessDate: 20260915 }, { ...valid, businessDate: 20260923 },
    { ...valid, deleted: true }, { ...valid, voided: true }, { ...valid, excessFood: true },
    { ...valid, checks: [{ voided: true, selections: [item] }, { deleted: true, selections: [item] }] },
    { ...valid, checks: [{ selections: [{ ...item, voided: true }, { ...item, deleted: true }, { ...item, deferred: true }, { ...item, selectionType: 'HOUSE_ACCOUNT_PAY_BALANCE' }, { ...item, selectionType: 'TOAST_CARD_SELL' }] }] },
  ], names, 'Orange', start, end);
  assert.equal(categoryTotals(report.rows).netSales, 90);
});
test('missing data is explicit, unknown categories stay separate, and payment refunds are not invented allocations', () => {
  const report = summarizeCategorySales([{ businessDate: 20260916, checks: [{ selections: [
    { price: 5, quantity: 0.5, salesCategory: { guid: 'unknown-a' } },
    { price: 2, preDiscountPrice: 2, salesCategory: { guid: 'unknown-b' } },
    { quantity: 1, salesCategory: { guid: 'food' } },
    { price: 3, preDiscountPrice: 3, quantity: 1 },
  ], payments: [{ refund: { refundAmount: 10 } }] }] }], names, 'Orange', start, end);
  assert.equal(report.rows.length, 3);
  assert.deepEqual(report.warnings, { missingPrices: 1, missingGross: 1, missingQuantities: 1, unallocatedRefunds: 1, unidentifiedCategories: 3 });
  assert.deepEqual(categoryTotals(report.rows), { quantity: null, grossSales: null, discounts: null, refunds: 0, netSales: 10 });
  assert.equal(report.rows[0].quantity, 0.5);
});
test('merges week chunks without merging distinct locations or category IDs', () => {
  const report = summarizeCategorySales([{ businessDate: 20260916, checks: [{ selections: [item] }] }], names, 'Orange', start, end);
  const other = { ...report, rows: report.rows.map(row => ({ ...row, location: 'Stamford' })) };
  const merged = mergeCategoryReports([report, report, other], start, end);
  assert.equal(merged.rows.length, 2);
  assert.equal(categoryTotals(merged.rows).netSales, 270);
  assert.equal(merged.rows.find(row => row.location === 'Orange')?.quantity, 4);
});

const manager: SessionUser = { id: 'test', name: 'Test', email: 'test@example.invalid', role: 'Location Manager', title: 'Manager', locations: ['Orange'], organizationId: 'org-puerto-vallarta' };
async function request(user: SessionUser, query: Record<string, string>, fail = false) {
  let status = 0, body: unknown, calls = 0;
  const res = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; } };
  await salesCategoriesEndpoint({ query }, res, user, async (location, from, to) => {
    calls++; if (fail) throw new Error('secret upstream detail');
    return summarizeCategorySales([], names, location, from, to);
  });
  return { status, body, calls };
}
const query = { start, end, location: 'Orange' };
test('rejects cross-location and cross-tenant requests before querying Toast', async () => {
  for (const [user, params] of [
    [manager, { ...query, location: 'Stamford' }],
    [{ ...manager, locations: [] }, query],
    [{ ...manager, role: 'Corporate', organizationId: 'other-org' }, query],
    [{ ...manager, role: 'Kitchen' }, query],
  ] as [SessionUser, Record<string, string>][]) {
    const result = await request(user, params); assert.equal(result.status, 403); assert.equal(result.calls, 0);
  }
});
test('rejects impossible dates, reversed/oversized periods, and ambiguous locations', async () => {
  for (const params of [{ ...query, start: '2026-02-30' }, { ...query, end: '2026-09-15' }, { ...query, end: '2026-09-23' }, { ...query, location: 'All locations' }, { ...query, location: 'Orange,Stamford' }]) {
    const result = await request(manager, params); assert.equal(result.status, 400); assert.equal(result.calls, 0);
  }
});
test('returns legitimate zero sales; upstream failure never becomes a zero total', async () => {
  assert.equal((await request(manager, query)).status, 200);
  const failure = await request(manager, query, true);
  assert.equal(failure.status, 502);
  assert.ok(!JSON.stringify(failure.body).includes('secret'));
});
