import test from 'node:test';
import assert from 'node:assert/strict';
import { beverageChunks, compareBeverages, rankBeverages, suggestBeverageGroup, validBeverageRange, type BeverageSource } from '../shared/beverageMetrics.js';
import { summarizeBeverageSales } from './toastBeverageSales.js';
import { getRestaurant365BeveragePurchases } from './restaurant365OData.js';

const source = (overrides: Partial<BeverageSource> = {}): BeverageSource => ({ location: 'Avon', start: '2026-09-02', end: '2026-09-08', fetchedAt: '2026-09-15T00:00:00Z',
  sales: { categories: [{ id: 'beer', name: 'Beer', group: 'beer', netSales: 1000, selections: 40 }], missingPrices: 0, unallocatedRefunds: 0 },
  purchases: { invoices: [{ id: 'inv1', number: '1', date: '2026-09-02', vendor: 'Example distributor', approved: true, amount: 300, kind: 'invoice', suggested: true }] }, ...overrides });

test('approved purchases less credits, margin and ratio are reconciled in cents', () => {
  const data = source(); data.purchases.invoices.push({ ...data.purchases.invoices[0], id: 'credit1', amount: 50, kind: 'credit' });
  const result = compareBeverages('Avon', [data], 1);
  assert.equal(result.sales, 1000); assert.equal(result.purchases, 250); assert.equal(result.purchasePct, 25);
  assert.equal(result.salesLessPurchases, 750); assert.equal(result.purchaseMarginPct, 75); assert.equal(result.creditCount, 1);
});
test('pending documents block ranking without pretending approved amount is zero', () => {
  const data = source(); data.purchases.invoices.push({ ...data.purchases.invoices[0], id: 'pending', approved: false, amount: 80 });
  const result = compareBeverages('Avon', [data], 1);
  assert.equal(result.purchases, 300); assert.equal(result.pending, 80); assert.equal(result.purchasePct, null);
});
test('missing source, missing amount and no invoices cannot win a ranking', () => {
  assert.equal(compareBeverages('Avon', [], 8).purchasePct, null);
  const data = source(); data.purchases.invoices[0].amount = null;
  assert.equal(compareBeverages('Avon', [data], 1).purchases, null);
  assert.equal(compareBeverages('Avon', [source({ purchases: { invoices: [], error: 'Unavailable' } })], 1).purchasePct, null);
  assert.equal(compareBeverages('Avon', [source({ purchases: { invoices: [] } })], 1).purchases, null);
});
test('duplicate invoices across adjacent reads count once; source periods must all complete', () => {
  const first = source(), second = source({ start: '2026-09-09', end: '2026-09-15' });
  const result = compareBeverages('Avon', [first, second], 2);
  assert.equal(result.sales, 2000); assert.equal(result.purchases, 300); assert.equal(result.invoiceCount, 1);
  assert.equal(compareBeverages('Avon', [first, second], 8).purchasePct, null);
});
test('ambiguous sales categories require explicit review, never total restaurant sales', () => {
  const data = source(); data.sales.categories.push({ id: 'bev', name: 'Beverage', group: 'unclassified', netSales: 500, selections: 20 });
  assert.equal(compareBeverages('Avon', [data], 1).sales, null);
  assert.equal(compareBeverages('Avon', [data], 1, { 'Avon:bev': 'excluded' }).sales, 1000);
  assert.equal(compareBeverages('Avon', [data], 1, { 'Avon:bev': 'spirits' }).sales, 1500);
  assert.equal(suggestBeverageGroup('Non Alcoholic Beer'), 'excluded');
  assert.equal(suggestBeverageGroup('Beverage'), 'unclassified');
  assert.equal(suggestBeverageGroup('Liquor'), 'spirits');
});
test('vendor selection only affects selected invoice totals', () => {
  assert.equal(compareBeverages('Avon', [source()], 1, {}, { 'Example distributor': false }).purchasePct, null);
});
test('zero sales and negative net purchases do not produce a profitability winner', () => {
  const noSales = source(); noSales.sales.categories[0].netSales = 0;
  assert.equal(compareBeverages('Avon', [noSales], 1).purchasePct, null);
  const credits = source(); credits.purchases.invoices.push({ ...credits.purchases.invoices[0], id: 'credit', amount: 500, kind: 'credit' });
  assert.equal(compareBeverages('Avon', [credits], 1).purchasePct, null);
});
test('ranks use ratios, preserve ties and put unavailable locations last', () => {
  const a = compareBeverages('Avon', [source()], 1);
  const rows = rankBeverages([{ ...a, location: 'Stamford', purchasePct: 25 }, { ...a, location: 'Orange', purchasePct: 25 }, a, { ...a, location: 'Danbury', purchasePct: null }]);
  assert.deepEqual(rows.map(row => row.rank), [1, 1, 3, null]);
});
test('56 days split into eight disjoint seven-day windows; invalid calendar dates rejected', () => {
  const chunks = beverageChunks('2026-07-15', '2026-09-08');
  assert.equal(chunks.length, 8); assert.deepEqual(chunks[7], { start: '2026-09-02', end: '2026-09-08' });
  assert.equal(validBeverageRange('2026-02-30', '2026-03-02'), false);
  assert.equal(validBeverageRange('2026-09-02', '2026-09-09'), false);
  assert.equal(validBeverageRange('2026-09-02', '2026-09-08'), true);
});
test('Toast selection net price includes quantity, modifiers and discounts exactly once', () => {
  const result = summarizeBeverageSales([{ guid: 'order', businessDate: 20260902, checks: [{ selections: [
    { salesCategory: { guid: 'liquor' }, price: 36, quantity: 3, modifiers: [{ price: 6 }] },
    { salesCategory: { guid: 'food' }, price: 50 },
    { salesCategory: { guid: 'liquor' }, price: 99, voided: true },
    { salesCategory: { guid: 'liquor' }, price: 20, deleted: true },
    { price: 50, deferred: true },
  ] }] }], '2026-09-02', '2026-09-08', new Map([['liquor', 'Liquor'], ['food', 'Food']]));
  assert.equal(result.categories.find(row => row.id === 'liquor')?.netSales, 36);
  assert.equal(result.categories.find(row => row.id === 'food')?.group, 'excluded');
});
test('item refunds are deducted once, excluding refunded tax', () => {
  const result = summarizeBeverageSales([{ businessDate: 20260902, checks: [{ selections: [{ salesCategory: { guid: 'beer' }, price: 40, refundDetails: { refundAmount: 10, taxRefundAmount: 0.7 } }], payments: [{ refund: { refundAmount: 10.7 } }] }] }], '2026-09-02', '2026-09-08', new Map([['beer', 'Beer']]));
  assert.equal(result.categories[0].netSales, 30); assert.equal(result.unallocatedRefunds, 0);
});
test('unallocated or partially allocated refunds and missing prices remain unresolved', () => {
  const result = summarizeBeverageSales([{ businessDate: 20260902, checks: [{ selections: [{ salesCategory: { guid: 'beer' }, price: 40, refundDetails: { refundAmount: 10 } }, { salesCategory: { guid: 'beer' } }], payments: [{ refund: { refundAmount: 20 } }] }] }], '2026-09-02', '2026-09-08', new Map([['beer', 'Beer']]));
  assert.equal(result.missingPrices, 1); assert.equal(result.unallocatedRefunds, 1);
  assert.equal(compareBeverages('Avon', [source({ sales: result })], 1).sales, null);
});
test('Toast order duplicates, void orders and outside-period data are excluded', () => {
  const order = { guid: 'same', businessDate: 20260902, checks: [{ selections: [{ salesCategory: { guid: 'beer' }, price: 20 }] }] };
  const result = summarizeBeverageSales([order, order, { ...order, guid: 'old', businessDate: 20260901 }, { ...order, guid: 'void', voided: true }], '2026-09-02', '2026-09-08', new Map([['beer', 'Beer']]));
  assert.equal(result.categories[0].netSales, 20);
});

test('repeated source chunks do not double sales', () => {
  const data = source();
  assert.equal(compareBeverages('Avon', [data, data], 1).sales, 1000);
});
test('unidentified R365 suppliers require an explicit selection before ranking', () => {
  const data = source(); data.purchases.invoices.push({ ...data.purchases.invoices[0], id: 'unknown', vendor: 'Proveedor sin identificar', suggested: false });
  assert.equal(compareBeverages('Avon', [data], 1).purchases, null);
});
test('R365 reads current approved amounts, credits and pending invoices without restoring vanished history', async () => {
  const keys = ['RESTAURANT365_DOMAIN', 'RESTAURANT365_USERNAME', 'RESTAURANT365_PASSWORD', 'OPSVISTA_DATABASE_URL', 'OPSVISTA_DATABASE_DATABASE_URL'];
  const saved = keys.map(key => process.env[key]);
  process.env.RESTAURANT365_DOMAIN = 'synthetic'; process.env.RESTAURANT365_USERNAME = 'test'; process.env.RESTAURANT365_PASSWORD = 'test-only-not-a-real-credential';
  delete process.env.OPSVISTA_DATABASE_URL; delete process.env.OPSVISTA_DATABASE_DATABASE_URL;
  const originalFetch = globalThis.fetch;
  const id = (value: number) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
  let revision = 0, detailReads = 0;
  const invoice = { transactionId: id(1), locationId: id(10), locationName: 'Puerto Vallarta Avon', date: '2026-09-02T00:00:00Z', transactionNumber: 'TEST-1', name: 'Test invoice', type: 'AP Invoice', isApproved: true, companyId: id(20) };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    let value: unknown[];
    if (url.pathname.endsWith('/Location')) value = [{ locationId: id(10), name: 'Puerto Vallarta Avon' }];
    else if (url.pathname.endsWith('/Transaction')) {
      assert.match(url.searchParams.get('$filter') || '', /locationId eq/);
      value = revision ? [invoice] : [invoice, { ...invoice, transactionId: id(2), type: 'AP Credit Memo' }, { ...invoice, transactionId: id(3), isApproved: false }];
    } else if (url.pathname.endsWith('/Company')) value = [{ companyId: id(20), name: 'Example distributor' }];
    else if (url.pathname.endsWith('/TransactionDetail')) {
      detailReads++;
      value = (revision ? [1] : [1, 2, 3]).flatMap(index => [{ transactionDetailAutoId: index * 2, transactionId: id(index), debit: index === 1 ? revision ? 200 : 300 : 50, credit: 0 }, { transactionDetailAutoId: index * 2 + 1, transactionId: id(index), debit: 0, credit: index === 1 ? revision ? 200 : 300 : 50 }]);
    } else throw new Error(`Unexpected synthetic test request: ${url.pathname}`);
    return new Response(JSON.stringify({ value }), { status: 200 });
  };
  try {
    const first = await getRestaurant365BeveragePurchases('test-org', '2026-09-02', '2026-09-08', 'Avon');
    assert.equal(first.invoices.length, 3); assert.equal(first.invoices[0].amount, 300);
    assert.equal(first.invoices[1].kind, 'credit'); assert.equal(first.invoices[2].approved, false);
    revision++;
    const second = await getRestaurant365BeveragePurchases('test-org', '2026-09-02', '2026-09-08', 'Avon');
    assert.equal(second.invoices.length, 1); assert.equal(second.invoices[0].amount, 200); assert.equal(detailReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});
