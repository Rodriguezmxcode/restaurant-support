import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { beverageLocations, compareBeverages, type BeverageSource } from '../shared/beverageMetrics.js';
import { scoreBeverages } from '../shared/beverageScore.js';
import { calculateWeeklyBonus } from '../src/bonusEngine.js';
import { authorize } from './authorization.js';
import type { SessionUser } from './authSession.js';

const pg = new PGlite();
const sql: any = async (parts: TemplateStringsArray, ...values: any[]) => {
  const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return (await pg.query(query, values.map(value => value?.__json !== undefined ? JSON.stringify(value.__json) : value))).rows;
};
sql.json = (value: unknown) => ({ __json: value });
mock.module('postgres', { defaultExport: () => sql });
process.env.OPSVISTA_DATABASE_URL = 'postgres://synthetic-test';
const { getBeverageScore, visibleBeverageScore } = await import('./beverageScore.js');
const cache = await import('./sourceCache.js');
const start = '2026-01-07', end = '2026-01-13';
function source(location: string, amount: number): BeverageSource {
  return { location, start, end, fetchedAt: '2026-01-14T12:00:00Z',
    sales: { categories: [{ id: 'beer', name: 'Beer', group: 'beer', netSales: 1000, selections: 30 }], missingPrices: 0, unallocatedRefunds: 0 },
    purchases: { invoices: [{ id: `synthetic-${location}`, date: start, vendor: 'Synthetic supplier', amount, approved: true, kind: 'invoice', suggested: true }] } };
}
const comparisons = (amounts: number[]) => beverageLocations.map((location, index) => compareBeverages(location, [source(location, amounts[index])], 1));

test('six restaurants earn 5 through 0 points by efficiency; the zero is a ready metric', () => {
  const result = scoreBeverages(comparisons([100, 200, 300, 400, 500, 600]));
  assert.deepEqual(result.rows.map(row => row.points), [5, 4, 3, 2, 1, 0]);
  assert.equal(result.provisional, false);
  for (const row of result.rows) {
    const metric = calculateWeeklyBonus({ liquorCostScorePct: row.points! * 20 }).metrics.find(metric => metric.key === 'liquorCost')!;
    assert.equal(metric.points, row.points); assert.equal(metric.ready, true);
  }
});
test('tied ratios share points and rank, even when the restaurants have different sales volumes', () => {
  const rows = comparisons([100, 100, 300, 400, 500, 600]);
  rows[1] = { ...rows[1], purchases: 200, sales: 2000 };
  const result = scoreBeverages(rows);
  assert.deepEqual(result.rows.map(row => row.rank), [1, 1, 3, 4, 5, 6]);
  assert.deepEqual(result.rows.map(row => row.points), [5, 5, 3, 2, 1, 0]);
});
test('missing and pending sources show reviewable ratios but never earn zero or winning points', () => {
  const rows = comparisons([100, 200, 300, 400, 500, 600]);
  const pending = source(beverageLocations[0], 100);
  pending.purchases.invoices[0].approved = false;
  rows[0] = compareBeverages(beverageLocations[0], [pending], 1);
  rows[1] = compareBeverages(beverageLocations[1], [], 1);
  const result = scoreBeverages(rows);
  assert.equal(result.provisional, true); assert.equal(result.readyCount, 4);
  assert.equal(result.rows.find(row => row.location === beverageLocations[0])?.points, null);
  assert.equal(result.rows.find(row => row.location === beverageLocations[1])?.points, null);
  assert.equal(calculateWeeklyBonus({}).metrics.find(metric => metric.key === 'liquorCost')?.ready, false);
});
test('a single comparable restaurant cannot award itself five points', () => {
  const row = comparisons([100, 200, 300, 400, 500, 600])[0];
  assert.equal(scoreBeverages([row]).rows[0].points, null);
});
test('a restaurant with no orders cannot win by appearing to have zero purchases', () => {
  const data = source('Stamford', 0); data.purchases.invoices = [];
  const rows = comparisons([100, 200, 300, 400, 500, 600]);
  rows[0] = compareBeverages('Stamford', [data], 1);
  const result = scoreBeverages(rows).rows.find(row => row.location === 'Stamford')!;
  assert.equal(result.purchasePct, null); assert.equal(result.points, null); assert.equal(result.rank, null);
});
test('the fixed cohort excludes Corporate Office and filtering never changes a manager rank', () => {
  const base = comparisons([100, 200, 300, 400, 500, 600]);
  const score = { start, end, ...scoreBeverages([...base, { ...base[0], location: 'Corporate Office', purchasePct: 0 }]) };
  const manager = { id: 'synthetic-manager', role: 'Location Manager', organizationId: 'org-puerto-vallarta', locations: ['Avon'] } as SessionUser;
  const visible = visibleBeverageScore(score, manager);
  assert.equal(visible.rows.length, 1); assert.equal(visible.rows[0].rank, 5); assert.equal(visible.rows[0].points, 1);
  assert.equal(visible.rows[0].sales, null); assert.equal(visible.rows[0].purchases, null);
  assert.equal(authorize(manager, 'bonus:read').ok, true);
  assert.equal(authorize(manager, 'restaurant365:read').ok, false);
  assert.equal(authorize({ ...manager, organizationId: 'other-org' }, 'bonus:read').ok, false);
});
test('the score reads only the selected saved period, isolates tenants and incorporates changed invoices', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Scorecard must not call external sources'); };
  try {
    for (const [index, location] of beverageLocations.entries()) {
      const data = source(location, 100 + index * 100);
      for (const provider of ['toast-beverage', 'r365-beverage'] as const) {
        const registered = await cache.registerSource('test-org-a', provider, { location, start, end });
        const job = await cache.claimSource('test-org-a', registered.key); assert.ok(job);
        await cache.finishSource(job!, provider === 'toast-beverage' ? data.sales : data.purchases, new Date().toISOString());
      }
    }
    const first = await getBeverageScore('test-org-a', start, end);
    assert.equal(first.readyCount, 6); assert.equal(first.rows[0].purchasePct, 10);
    const repeated = await getBeverageScore('test-org-a', start, end);
    assert.deepEqual(repeated, first);
    assert.equal((await getBeverageScore('test-org-b', start, end)).readyCount, 0);
    assert.equal((await getBeverageScore('test-org-a', '2026-01-14', '2026-01-20')).readyCount, 0);
    const job = await cache.claimSource('test-org-a', cache.sourceKey('r365-beverage', { location: 'Stamford', start, end }));
    await cache.finishSource(job!, source('Stamford', 900).purchases, new Date().toISOString());
    const updated = await getBeverageScore('test-org-a', start, end);
    assert.equal(updated.rows.find(row => row.location === 'Stamford')?.points, 0);
    assert.equal(updated.rows.find(row => row.location === 'Orange')?.points, 5);
  } finally { globalThis.fetch = originalFetch; }
});
