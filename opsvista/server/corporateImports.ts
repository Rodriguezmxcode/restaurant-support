import postgres from 'postgres';
import { summarizeCorporateRows, type CorporateExpenseRow } from '../shared/corporateImports.js';

let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<void> | undefined;

function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('El guardado permanente de OpsVista no está disponible.');
  return client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 });
}

async function schema() {
  if (!ready) ready = db()`create table if not exists opsvista_corporate_import_rows (
    organization_id text not null,
    row_key text not null,
    source_file text not null,
    transaction_date date not null,
    payload jsonb not null,
    imported_by text not null,
    updated_at timestamptz not null default now(),
    primary key (organization_id, row_key)
  )`.then(() => {}).catch(error => { ready = undefined; throw error; });
  await ready;
}

export async function saveCorporateImport(organizationId: string, actor: string, sourceFile: string, rows: CorporateExpenseRow[]) {
  await schema();
  await db().begin(async tx => {
    await tx`delete from opsvista_corporate_import_rows where organization_id=${organizationId} and source_file=${sourceFile}`;
    for (const row of rows) await tx`insert into opsvista_corporate_import_rows
      (organization_id,row_key,source_file,transaction_date,payload,imported_by)
      values (${organizationId},${row.key},${sourceFile},${row.date},${tx.json(row as never)},${actor})
      on conflict (organization_id,row_key) do update set
        source_file=excluded.source_file,
        transaction_date=excluded.transaction_date,
        payload=excluded.payload,
        imported_by=excluded.imported_by,
        updated_at=now()`;
  });
  return { saved: rows.length, sourceFile };
}

export async function getCorporateImport(organizationId: string, start?: string, end?: string) {
  await schema();
  const rows = start && end
    ? await db()`select payload,updated_at from opsvista_corporate_import_rows where organization_id=${organizationId} and transaction_date>=${start} and transaction_date<=${end} order by transaction_date,row_key`
    : await db()`select payload,updated_at from opsvista_corporate_import_rows where organization_id=${organizationId} order by transaction_date,row_key`;
  const parsed = rows.map(row => row.payload as CorporateExpenseRow);
  const updatedAt = rows.length ? new Date(rows.reduce((latest, row) => Math.max(latest, new Date(row.updated_at).getTime()), 0)).toISOString() : undefined;
  return { rows: parsed, summary: summarizeCorporateRows(parsed), updatedAt };
}
