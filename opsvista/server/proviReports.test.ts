import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { parseProviImport, summarizeProviComparison, type ProviReport } from '../shared/proviReports.js';
import type { BeverageInvoice } from '../shared/beverageMetrics.js';

const pg = new PGlite();
const sql: any = async (parts: TemplateStringsArray, ...values: any[]) => {
  const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return (await pg.query(query, values.map(value => value?.__json !== undefined ? JSON.stringify(value.__json) : value))).rows;
};
sql.json = (value: unknown) => ({ __json: value });
sql.begin = async (run: (tx: any) => Promise<void>) => { await pg.exec('BEGIN'); try { await run(sql); await pg.exec('COMMIT'); } catch (error) { await pg.exec('ROLLBACK'); throw error; } };
mock.module('postgres', { defaultExport: () => sql });
process.env.OPSVISTA_DATABASE_URL = 'postgres://synthetic-test';
const { saveProviReports, getProviReports } = await import('./proviReports.js');
const cache = await import('./sourceCache.js');
const invoice = (overrides: Partial<BeverageInvoice> = {}): BeverageInvoice => ({ id: 'synthetic-invoice', number: 'SYNTHETIC-1', date: '2026-01-01', vendor: 'Brescome Barton Inc.', amount: 300, approved: true, kind: 'invoice', suggested: true, ...overrides });
const report = (): ProviReport => ({ location: 'Avon', start: '2026-01-01', end: '2026-01-07', spend: 1000, orders: 4, productCount: 10, distributorCount: 1,
  topProducts: [{ name: 'Synthetic example', distributor: 'Example', quantity: '1 case', spend: 100 }], sourceNote: 'Synthetic report for tests only.',
  baseline: { capturedAt: '2026-01-08T12:00:00Z', note: 'Synthetic pre-credit baseline.', invoices: [invoice()] } });

test('repeated report uploads and duplicate invoices do not increase purchases', () => {
  const input = report(); input.baseline!.invoices.push(invoice());
  const result = parseProviImport({ schemaVersion: 1, reports: [input, input] });
  assert.equal(result.length, 1); assert.equal(result[0].baseline?.invoices.length, 1);
  assert.equal(summarizeProviComparison(result[0], []).invoiceTotal, 300);
});
test('reject malformed amounts, out-of-period documents and conflicting duplicates before saving', () => {
  for (const change of [{ spend: -1 }, { spend: '1000' }, { start: '2026-02-31' }, { location: 'Other' }]) assert.throws(() => parseProviImport({ schemaVersion: 1, reports: [{ ...report(), ...change }] }));
  const input = report(); input.baseline!.invoices[0].date = '2025-12-31';
  assert.throws(() => parseProviImport({ schemaVersion: 1, reports: [input] }));
  assert.throws(() => parseProviImport({ schemaVersion: 1, reports: [report(), { ...report(), spend: 900 }] }));
});
test('automatic comparison includes pending invoices, subtracts credits and excludes unrelated vendors', () => {
  const rows = [invoice(), invoice({ id: 'pending', number: 'SYNTHETIC-2', amount: 150, approved: false }), invoice({ id: 'credit', kind: 'credit', amount: 25 }), invoice({ id: 'food', vendor: 'Synthetic food supplier', amount: 5000, suggested: false })];
  const result = summarizeProviComparison(report(), [{ invoices: rows, pending: false, updatedAt: '2026-01-08T12:00:00Z' }]);
  assert.equal(result.source, 'automatic'); assert.equal(result.invoiceTotal, 450); assert.equal(result.credits, 25); assert.equal(result.net, 425); assert.equal(result.pendingAmount, 150); assert.equal(result.difference, -575);
});
test('incomplete periods keep the imported baseline and never assume missing credits are zero', () => {
  const result = summarizeProviComparison(report(), [{ pending: true }]);
  assert.equal(result.source, 'imported'); assert.equal(result.pending, true); assert.equal(result.invoiceTotal, 300); assert.equal(result.credits, null); assert.equal(result.net, null);
});
test('source failures preserve the last successful automatic invoices and disclose pending status', () => {
  const result = summarizeProviComparison(report(), [{ invoices: [invoice({ amount: 500 })], pending: true, error: 'source unavailable' }]);
  assert.equal(result.source, 'automatic'); assert.equal(result.invoiceTotal, 500); assert.equal(result.pending, true);
});
test('permanent storage isolates organizations, replaces same-period reports and retains overlapping periods separately', async () => {
  await saveProviReports('test-org-a', 'test-actor', [report()]);
  await saveProviReports('test-org-a', 'test-actor', [report()]);
  assert.equal((await getProviReports('test-org-a')).length, 1);
  assert.equal((await getProviReports('test-org-b')).length, 0);
  await saveProviReports('test-org-a', 'test-actor', [{ ...report(), spend: 1100 }, { ...report(), end: '2026-01-08' }]);
  const stored = await getProviReports('test-org-a'); assert.equal(stored.length, 2); assert.equal(stored.find(row => row.end === '2026-01-07')?.spend, 1100);
  assert.equal((await cache.readSavedSources('test-org-a', 'r365-beverage')).length, 2);
});
test('reading saved reports picks up newly synchronized R365 invoices without calling external sources', async () => {
  const key = cache.sourceKey('r365-beverage', { location: 'Avon', start: '2026-01-01', end: '2026-01-07' });
  const job = await cache.claimSource('test-org-a', key); assert.ok(job);
  await cache.finishSource(job!, { invoices: [invoice({ amount: 725 })] }, new Date().toISOString());
  const stored = (await getProviReports('test-org-a')).find(row => row.end === '2026-01-07')!;
  assert.equal(stored.comparison.source, 'automatic'); assert.equal(stored.comparison.net, 725); assert.equal(stored.spend, 1100); assert.equal(stored.baseline?.invoices[0].amount, 300);
});
