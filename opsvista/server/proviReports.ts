import postgres from 'postgres';
import { beverageChunks } from '../shared/beverageMetrics.js';
import { proviReportKey, summarizeProviComparison, type ProviReport, type StoredProviReport } from '../shared/proviReports.js';
import { readSavedSources, registerSource, sourceKey, sourceMemory } from './sourceCache.js';

let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<void> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('El guardado permanente de OpsVista no está disponible.');
  return client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 });
}
async function schema() {
  if (!ready) ready = db()`create table if not exists opsvista_provi_reports (
    organization_id text not null, report_key text not null, payload jsonb not null,
    imported_by text not null, updated_at timestamptz not null default now(),
    primary key (organization_id, report_key))`.then(() => {}).catch(error => { ready = undefined; throw error; });
  await ready;
}
export async function saveProviReports(organizationId: string, actor: string, reports: ProviReport[]) {
  await schema();
  // Register purchases only. The existing worker detects modified R365 records
  // every half hour and refreshes all tracked periods during nightly reconciliation.
  for (const report of reports) for (const chunk of beverageChunks(report.start, report.end)) {
    await registerSource(organizationId, 'r365-beverage', { location: report.location, ...chunk });
  }
  await db().begin(async tx => {
    for (const report of reports) await tx`insert into opsvista_provi_reports (organization_id,report_key,payload,imported_by)
      values (${organizationId},${proviReportKey(report)},${tx.json(report as never)},${actor})
      on conflict (organization_id,report_key) do update set
        payload=excluded.payload, imported_by=excluded.imported_by, updated_at=now()`;
  });
  return { saved: reports.length };
}
export async function getProviReports(organizationId: string): Promise<StoredProviReport[]> {
  await schema();
  const rows = await db()`select report_key,payload,updated_at from opsvista_provi_reports where organization_id=${organizationId} order by report_key`;
  if (!rows.length) return [];
  // Reading this page never calls R365. It combines durable snapshots already
  // refreshed by the background worker, preserving the imported audit baseline.
  const sources = new Map((await readSavedSources(organizationId, 'r365-beverage')).map(source => [source.key, source]));
  return rows.map(row => {
    const report = row.payload as ProviReport;
    const slices = beverageChunks(report.start, report.end).map(chunk => {
      const source = sources.get(sourceKey('r365-beverage', { location: report.location, ...chunk }));
      return { invoices: source?.payload?.invoices, updatedAt: source?.refreshedAt, pending: !source || sourceMemory(source).pending, error: source?.payload?.error || source?.lastError };
    });
    return { ...report, id: String(row.report_key), savedAt: new Date(row.updated_at).toISOString(), comparison: summarizeProviComparison(report, slices) };
  });
}
