import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { beverageChunks, beverageLocations, compareBeverages, type BeverageSource } from '../shared/beverageMetrics.js';
import { scoreBeverages } from '../shared/beverageScore.js';
import { proviBonusReference, type ProviReport } from '../shared/proviReports.js';
import { beverageBonusRange, closedBonusWeek, scheduledBonusWeek } from '../shared/bonusWeek.js';
import { calculateWeeklyBonus } from '../src/bonusEngine.js';
import { authorize } from './authorization.js';
import type { SessionUser } from './authSession.js';

const pg = new PGlite();
const sql: any = async (parts: TemplateStringsArray, ...values: any[]) => {
  const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return (await pg.query(query, values.map(value => value?.__json !== undefined ? JSON.stringify(value.__json) : value))).rows;
};
sql.json = (value: unknown) => ({ __json: value });
sql.begin = async (run: (tx: any) => Promise<void>) => { await pg.exec('BEGIN'); try { await run(sql); await pg.exec('COMMIT'); } catch (error) { await pg.exec('ROLLBACK'); throw error; } };
mock.module('postgres', { defaultExport: () => sql });
process.env.OPSVISTA_DATABASE_URL = 'postgres://synthetic-test';
const { getBeverageScore, visibleBeverageScore } = await import('./beverageScore.js');
const cache = await import('./sourceCache.js');
const { saveProviReports } = await import('./proviReports.js');
const { getProviReports } = await import('./proviReports.js');
const { applyProviEvidenceToSources, saveProviEvidence } = await import('./proviEvidence.js');
const { prepareClosedBonusWeek } = await import('./bonusWeek.js');
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
  pending.memory = { sales: { stored: true, pending: false }, purchases: { stored: true, pending: true } };
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
test('weekly cutoff waits until Wednesday in Connecticut and the scheduler honors DST', () => {
  assert.deepEqual(closedBonusWeek(new Date('2026-09-16T03:59:00Z')), { start: '2026-09-02', end: '2026-09-08' });
  assert.deepEqual(closedBonusWeek(new Date('2026-09-16T04:00:00Z')), { start: '2026-09-09', end: '2026-09-15' });
  assert.equal(scheduledBonusWeek(new Date('2026-09-16T07:29:00Z')), undefined);
  assert.deepEqual(scheduledBonusWeek(new Date('2026-09-16T07:30:00Z')), { start: '2026-09-09', end: '2026-09-15' });
  assert.equal(scheduledBonusWeek(new Date('2026-11-04T08:29:00Z')), undefined);
  assert.deepEqual(scheduledBonusWeek(new Date('2026-11-04T08:30:00Z')), { start: '2026-10-28', end: '2026-11-03' });
});
test('Wednesday prepares both sources for six locations once; Thursday keeps the same week open for updates', async () => {
  await prepareClosedBonusWeek('weekly-test', new Date('2026-09-16T07:29:00Z'));
  assert.equal((await cache.readSavedSources('weekly-test', 'r365-beverage')).length, 0);
  await prepareClosedBonusWeek('weekly-test', new Date('2026-09-16T07:37:00Z'));
  const saved = await cache.readSavedSources('weekly-test', 'r365-beverage');
  assert.equal(saved.length, 48); assert.equal((await cache.readSavedSources('weekly-test', 'toast-beverage')).length, 48);
  assert.ok(saved.every(job => job.params.start! >= '2026-07-22' && job.params.end! <= '2026-09-15'));
  for (const location of beverageLocations) assert.equal(saved.filter(job=>job.params.location===location).length,8);
  const claimed = await cache.claimSource('weekly-test', saved[0].key); assert.ok(claimed);
  await cache.finishSource(claimed!, { invoices: [] }, new Date().toISOString());
  await prepareClosedBonusWeek('weekly-test', new Date('2026-09-17T12:00:00Z'));
  assert.equal((await cache.readSavedSources('weekly-test', 'r365-beverage')).find(job => job.key === saved[0].key)?.due, false);
  // A user-requested update can still enqueue the completed week on Thursday.
  await cache.queueSourceRefresh('weekly-test', saved[0].key);
  assert.equal((await cache.readSavedSources('weekly-test', 'r365-beverage')).find(job => job.key === saved[0].key)?.due, true);
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

test('alcohol uses exactly eight inclusive weeks ending at the selected cutoff, including across DST', () => {
  assert.deepEqual(beverageBonusRange('2026-09-22'), { start: '2026-07-29', end: '2026-09-22' });
  const range = beverageBonusRange('2026-11-03');
  assert.deepEqual(range, { start: '2026-09-09', end: '2026-11-03' });
  assert.equal(beverageChunks(range.start, range.end).length, 8);
});

test('overlapping aggregate reports are attached once as dated references, never apportioned or added to points', async () => {
  const makeReport = (end: string, spend: number): ProviReport => ({ location: 'Avon', start: '2025-12-01', end, spend,
    orders: 4, productCount: 20, distributorCount: 2, topProducts: [], sourceNote: 'Synthetic aggregate, includes mixers; no order dates.' });
  await saveProviReports('test-org-a', 'synthetic-actor', [makeReport('2026-01-12', 8000), makeReport('2026-01-15', 9000)]);
  const score = await getBeverageScore('test-org-a', start, end);
  const row = score.rows.find(row => row.location === 'Avon')!;
  assert.equal(row.purchases, 500); assert.equal(row.purchasePct, 50); assert.equal(row.points, 2);
  assert.equal(row.provi?.spend, 9000); assert.equal(row.provi?.end, '2026-01-15');
  assert.equal(row.provi?.periodMatches, false); assert.equal(row.provi?.reconciliationPending, true);
  const missing = await getBeverageScore('test-org-a', '2025-12-01', '2025-12-07');
  const pending = missing.rows.find(row => row.location === 'Avon')!;
  assert.equal(pending.provi?.spend, 9000); assert.equal(pending.purchases, null); assert.equal(pending.points, null);
  const other = await getBeverageScore('test-org-b', start, end);
  assert.ok(other.rows.every(row => !row.provi));
  const manager = { id: 'synthetic-manager', role: 'Location Manager', organizationId: 'org-puerto-vallarta', locations: ['Avon'] } as SessionUser;
  const visible = visibleBeverageScore(score, manager);
  assert.equal(visible.rows.length, 1); assert.equal(visible.rows[0].provi?.spend, null); assert.equal(visible.rows[0].provi?.r365Net, null);
  assert.equal(visible.rows[0].points, row.points);
  assert.equal(proviBonusReference(await getProviReports('test-org-a'), 'Avon', '2026-02-01', '2026-02-07'), undefined);
});

test('unapproved payment invoices remain incurred purchases and credits reduce the same cost', () => {
  const data = source('Avon', 500);
  data.purchases.invoices[0].approved = false;
  data.purchases.invoices.push({ ...data.purchases.invoices[0], id: 'synthetic-credit', kind: 'credit', amount: 50 });
  const result = compareBeverages('Avon', [data], 1);
  assert.equal(result.purchases, 450); assert.equal(result.pending, 450); assert.equal(result.purchasePct, 45);
});

test('the full 56-day score sums all weeks and incorporates a corrected invoice only once', async () => {
  const range = beverageBonusRange('2026-01-13'), chunks = beverageChunks(range.start, range.end);
  for (const [index, location] of beverageLocations.entries()) for (const chunk of chunks) {
    const data = source(location, (index + 1) * 100);
    data.purchases.invoices[0].id += chunk.start;
    data.purchases.invoices[0].date = chunk.start;
    for (const provider of ['toast-beverage', 'r365-beverage'] as const) {
      const registered = await cache.registerSource('rolling-org', provider, { location, ...chunk });
      const job = await cache.claimSource('rolling-org', registered.key); assert.ok(job);
      await cache.finishSource(job!, provider === 'toast-beverage' ? data.sales : data.purchases, new Date().toISOString());
    }
  }
  const first = await getBeverageScore('rolling-org', range.start, range.end);
  assert.equal(first.readyCount, 6); assert.equal(first.rows[0].sales, 8000); assert.equal(first.rows[0].purchases, 800);
  assert.deepEqual(first.rows.map(row => row.points), [5, 4, 3, 2, 1, 0]);
  const job = await cache.claimSource('rolling-org', cache.sourceKey('r365-beverage', { location: 'Stamford', ...chunks[0] }));
  const corrected = source('Stamford', 1000).purchases;
  corrected.invoices[0].id += chunks[0].start; corrected.invoices[0].date = chunks[0].start;
  await cache.finishSource(job!, corrected, new Date().toISOString());
  const updated = await getBeverageScore('rolling-org', range.start, range.end);
  assert.equal(updated.rows.find(row => row.location === 'Stamford')?.purchases, 1700);
  assert.equal(updated.rows.find(row => row.location === 'Stamford')?.points, 4);
});

test('Provi reconciliation replaces the same-location invoice without masking source failures', async () => {
  const invoice = { id: 'same-id', number: 'SYNTHETIC-ORDER', date: start, vendor: 'Synthetic supplier', amount: 105, approved: true, kind: 'invoice' as const, suggested: true };
  const registered = await cache.registerSource('evidence-org', 'r365-beverage', { location: 'Avon', start, end });
  const job = await cache.claimSource('evidence-org', registered.key);
  await cache.finishSource(job!, { invoices: [invoice] }, new Date().toISOString());
  await saveProviEvidence('evidence-org', 'actor', [{ name: 'synthetic.png', mime: 'image/png', data: 'YQ==' }], [{
    location: 'Avon', orderDate: start, deliveryDate: start, vendor: invoice.vendor, orderNumber: invoice.number,
    orderedAmount: 100, items: [], confidence: 1, sourceNote: 'Synthetic test evidence.' }]);
  const avon = source('Avon', 100); avon.purchases = { invoices: [invoice], error: 'Incomplete upstream coverage' };
  const orange = source('Orange', 200); orange.purchases.invoices[0].id = 'same-id';
  const adjusted = await applyProviEvidenceToSources('evidence-org', start, end, [avon, orange]);
  assert.equal(adjusted[0].purchases.invoices.length, 1); assert.equal(adjusted[0].purchases.invoices[0].amount, 105);
  assert.equal(adjusted[0].purchases.error, 'Incomplete upstream coverage');
  assert.equal(compareBeverages('Avon', adjusted, 1).purchasePct, null);
  assert.equal(adjusted[1].purchases.invoices.length, 1); assert.equal(adjusted[1].purchases.invoices[0].amount, 200);
});
