import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { financeKey, type FinanceImport, type SavedFinanceRecord } from '../shared/finance.js';

let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<void> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('Finance storage unavailable');
  return client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 5 });
}
async function schema() {
  ready ||= db()`create table if not exists opsvista_finance_versions (
    version_id bigserial primary key,
    organization_id text not null,
    record_key text not null,
    revision text not null,
    payload jsonb not null,
    imported_by text not null,
    saved_at timestamptz not null default now()
  )`.then(() => {}).catch(error => { ready = undefined; throw error; });
  await ready;
}
export class FinanceConflict extends Error {}
export async function listFinance(organizationId: string): Promise<SavedFinanceRecord[]> {
  await schema();
  const rows = await db()`select distinct on (record_key) payload,revision,saved_at from opsvista_finance_versions where organization_id=${organizationId} order by record_key,version_id desc`;
  return rows.map(row => ({ record: row.payload, revision: row.revision, savedAt: new Date(row.saved_at).toISOString() }));
}
// One transaction, serialized per tenant: retries are idempotent and stale
// reviews cannot overwrite someone else's import. Old versions remain intact.
export async function saveFinance(organizationId: string, actor: string, batch: FinanceImport, expected: Record<string, string | null>) {
  await schema();
  return db().begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${`finance:${organizationId}`}))`;
    let saved = 0, unchanged = 0;
    for (const record of batch.records) {
      const key = financeKey(record), payload = JSON.stringify(record);
      const revision = createHash('sha256').update(payload).digest('hex');
      const current = await tx`select revision from opsvista_finance_versions where organization_id=${organizationId} and record_key=${key} order by version_id desc limit 1`;
      const actual = current[0]?.revision ?? null;
      if (actual === revision) { unchanged++; continue; }
      if (!(key in expected) || expected[key] !== actual) throw new FinanceConflict('El reporte cambió desde la revisión. Actualiza Finanzas y vuelve a revisar el archivo.');
      await tx`insert into opsvista_finance_versions (organization_id,record_key,revision,payload,imported_by) values (${organizationId},${key},${revision},${payload}::jsonb,${actor})`;
      saved++;
    }
    return { saved, unchanged };
  });
}
