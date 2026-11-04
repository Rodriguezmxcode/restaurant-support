import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { addDays, money, type BeverageInvoice, type BeverageSource } from '../shared/beverageMetrics.js';
import { parseProviEvidenceDrafts, proviEvidenceKey, reconcileProviEvidence, type ProviEvidenceDraft, type ProviSourceFile, type StoredProviEvidence } from '../shared/proviEvidence.js';
import { readSavedSources, registerSource } from './sourceCache.js';

let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<void> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('El guardado permanente de OpsVista no está disponible.');
  return client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 });
}
async function schema() {
  if (!ready) ready = (async () => {
    await db()`create table if not exists opsvista_provi_documents (
      organization_id text not null, document_id text not null, source_hash text not null,
      source_files jsonb not null, uploaded_by text not null, created_at timestamptz not null default now(),
      primary key (organization_id, document_id), unique (organization_id, source_hash))`;
    await db()`create table if not exists opsvista_provi_evidence (
      organization_id text not null, evidence_id text not null, document_id text not null,
      evidence_key text not null, payload jsonb not null, imported_by text not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      primary key (organization_id, evidence_id), unique (organization_id, document_id, evidence_key))`;
    await db()`create index if not exists opsvista_provi_evidence_lookup on opsvista_provi_evidence(organization_id,evidence_key)`;
  })().catch(error => { ready = undefined; throw error; });
  await ready;
}

const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export function parseProviSourceFiles(input: unknown): ProviSourceFile[] {
  if (!Array.isArray(input) || !input.length || input.length > 4) throw new Error('Selecciona entre 1 y 4 fotos/PDF por compra.');
  let bytes = 0;
  const files = input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Archivo de evidencia inválido.');
    const row = value as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const mime = typeof row.mime === 'string' ? row.mime.toLowerCase().trim() : '';
    const data = typeof row.data === 'string' ? row.data.trim() : '';
    if (!name || name.length > 180 || !allowedMimes.has(mime) || !data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Solo se aceptan PDF, JPG, PNG o WEBP válidos.');
    bytes += Math.floor(data.length * 3 / 4);
    return { name, mime, data };
  });
  if (bytes > 3_000_000) throw new Error('Las fotos/PDF pueden pesar hasta 3 MB combinados por carga.');
  return files;
}

function documentHash(files: ProviSourceFile[]) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(file.name).update('\0').update(file.mime).update('\0').update(file.data).update('\0');
  return hash.digest('hex');
}

export async function saveProviEvidence(organizationId: string, actor: string, filesInput: unknown, draftsInput: unknown) {
  await schema();
  const files = parseProviSourceFiles(filesInput), drafts = parseProviEvidenceDrafts(draftsInput), hash = documentHash(files);
  let documentId = '';
  const existing = await db()`select document_id from opsvista_provi_documents where organization_id=${organizationId} and source_hash=${hash}`;
  if (existing[0]) documentId = String(existing[0].document_id);
  else {
    documentId = randomUUID();
    await db()`insert into opsvista_provi_documents (organization_id,document_id,source_hash,source_files,uploaded_by)
      values (${organizationId},${documentId},${hash},${db().json(files as never)},${actor})`;
  }
  let saved = 0, duplicates = 0;
  for (const draft of drafts) {
    const evidenceId = randomUUID(), key = proviEvidenceKey(draft);
    const rows = await db()`insert into opsvista_provi_evidence (organization_id,evidence_id,document_id,evidence_key,payload,imported_by)
      select ${organizationId},${evidenceId},${documentId},${key},${db().json(draft as never)},${actor}
      where not exists (select 1 from opsvista_provi_evidence where organization_id=${organizationId} and evidence_key=${key})
      on conflict (organization_id,document_id,evidence_key) do nothing returning evidence_id`;
    if (rows.length) {
      saved++;
      await registerSource(organizationId, 'r365-beverage', { location: draft.location, start: addDays(draft.orderDate, -3), end: addDays(draft.orderDate, 3) });
    } else duplicates++;
  }
  return { saved, duplicates, documentId };
}

function invoicesByLocation(sources: Awaited<ReturnType<typeof readSavedSources>>) {
  const result = new Map<string, BeverageInvoice[]>();
  for (const source of sources) {
    const location = source.params.location || '';
    if (!location || !Array.isArray(source.payload?.invoices)) continue;
    const rows = result.get(location) || [];
    rows.push(...source.payload.invoices);
    result.set(location, rows);
  }
  for (const [location, rows] of result) result.set(location, [...new Map(rows.map(invoice => [invoice.id, invoice])).values()]);
  return result;
}

export async function getProviEvidence(organizationId: string): Promise<StoredProviEvidence[]> {
  await schema();
  const [rows, sources] = await Promise.all([
    db()`select e.evidence_id,e.document_id,e.payload,e.created_at,d.source_files
      from opsvista_provi_evidence e join opsvista_provi_documents d
      on d.organization_id=e.organization_id and d.document_id=e.document_id
      where e.organization_id=${organizationId} order by e.created_at,e.evidence_id`,
    readSavedSources(organizationId, 'r365-beverage'),
  ]);
  const byLocation = invoicesByLocation(sources), used = new Set<string>(), result: StoredProviEvidence[] = [];
  for (const row of rows) {
    const draft = row.payload as ProviEvidenceDraft;
    const match = reconcileProviEvidence(draft, (byLocation.get(draft.location) || []).filter(invoice => !used.has(`${draft.location}:${invoice.id}`)));
    if (match.status === 'verified' && match.invoice) used.add(`${draft.location}:${match.invoice.id}`);
    const sourceFiles = (Array.isArray(row.source_files) ? row.source_files : []).map((file: any) => ({ name: String(file.name || ''), mime: String(file.mime || '') }));
    result.push({ ...draft, id: String(row.evidence_id), documentId: String(row.document_id), savedAt: new Date(row.created_at).toISOString(), sourceFiles, match });
  }
  return result;
}

export async function applyProviEvidenceToSources(organizationId: string, start: string, end: string, sources: BeverageSource[]) {
  const evidence = await getProviEvidence(organizationId);
  if (!evidence.length) return sources;
  const adjusted = sources.map(source => ({
    ...source,
    purchases: { ...source.purchases, invoices: [...source.purchases.invoices] },
    memory: source.memory ? { ...source.memory, sales: { ...source.memory.sales }, purchases: { ...source.memory.purchases } } : undefined,
  }));
  const matchedInvoiceIds = new Set(evidence.filter(row => row.match.status === 'verified' && row.match.invoice).map(row => `${row.location}:${row.match.invoice!.id}`));
  for (const source of adjusted) source.purchases.invoices = source.purchases.invoices.filter(invoice => !matchedInvoiceIds.has(`${source.location}:${invoice.id}`));

  for (const row of evidence.filter(row => row.orderDate >= start && row.orderDate <= end)) {
    const target = adjusted.find(source => source.location === row.location && row.orderDate >= source.start && row.orderDate <= source.end);
    if (!target) continue;
    if (row.match.status === 'verified' && row.match.invoice?.amount !== null && row.match.invoice) {
      const invoice = row.match.invoice;
      target.purchases.invoices.push({
        id: `provi-verified:${row.id}`, number: invoice.number || row.orderNumber || undefined, date: row.orderDate,
        vendor: invoice.vendor || row.vendor, approved: invoice.approved, amount: Math.abs(invoice.amount || 0), kind: 'invoice', suggested: true,
      });
    } else if (row.match.status === 'provisional') {
      target.purchases.invoices.push({
        id: `provi-provisional:${row.id}`, number: row.orderNumber || undefined, date: row.orderDate,
        vendor: row.vendor, approved: false, amount: money(row.orderedAmount), kind: 'invoice', suggested: true,
      });
      if (target.memory) target.memory.purchases.pending = true;
    } else if (target.memory) target.memory.purchases.pending = true;
  }
  return adjusted;
}
