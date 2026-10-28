import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { partnerLocations } from '../shared/partnerApi.js';

export type PvInvoice = {
  client_id: string; source: 'pv-control'; location_id: string; transaction_date: string;
  vendor_name: string; number: string; amount: number; currency: 'USD';
  lane: 'vendor' | 'receiving'; key_item: string; notes: string;
};
export class PvInvoiceConflict extends Error {}
export function parsePvInvoice(input: unknown): PvInvoice {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Factura no válida.');
  const row = input as Record<string, unknown>;
  const fields = ['client_id', 'source', 'location_id', 'transaction_date', 'vendor_name', 'number', 'amount', 'currency', 'lane', 'key_item', 'notes'];
  if (Object.keys(row).some(key => !fields.includes(key))) throw new Error('La factura contiene campos no permitidos.');
  const str = (key: string, max: number, optional = false) => {
    const raw = row[key] ?? (optional ? '' : null);
    if (typeof raw !== 'string' || raw.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw) || (!optional && !raw.trim())) throw new Error(`Revisa ${key}.`);
    return raw.trim();
  };
  const client_id = str('client_id', 36).toLowerCase();
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(client_id)) throw new Error('Identificador de factura no válido.');
  const location_id = str('location_id', 40);
  if (!partnerLocations.some(loc => loc.id === location_id)) throw new Error('Sucursal no válida.');
  const transaction_date = str('transaction_date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction_date) || !Number.isFinite(Date.parse(transaction_date)) || new Date(transaction_date).toISOString().slice(0, 10) !== transaction_date) throw new Error('Fecha de factura no válida.');
  if (row.source !== 'pv-control' || row.currency !== 'USD' || !['vendor', 'receiving'].includes(String(row.lane))) throw new Error('Origen, moneda o carril no válido.');
  const amount = row.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new Error('Indica un importe positivo en USD, con hasta dos decimales.');
  return { client_id, source: 'pv-control', location_id, transaction_date, vendor_name: str('vendor_name', 200), number: str('number', 100), amount,
    currency: 'USD', lane: row.lane as PvInvoice['lane'], key_item: str('key_item', 200, true), notes: str('notes', 2000, true) };
}
let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<unknown> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('PV invoice database unavailable');
  return client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 5 });
}
async function schema() {
  ready ||= db()`create table if not exists opsvista_pv_invoices (
    id uuid primary key, organization_id text not null, client_id uuid not null,
    duplicate_key text not null, content_hash text not null, payload jsonb not null,
    created_by text not null, created_at timestamptz not null default now(),
    unique(organization_id,client_id), unique(organization_id,duplicate_key)
  )`.catch(error => { ready = undefined; throw error; });
  await ready;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function project(row: any) {
  return { ...row.payload as PvInvoice, id: row.id as string, received_at: new Date(row.created_at).toISOString(),
    receipt_status: 'received' as const, payment_status: 'unavailable' as const };
}
export async function receivePvInvoice(org: string, actor: string, invoice: PvInvoice) {
  await schema();
  const { client_id, ...content } = invoice;
  const hash = digest(content);
  const duplicate = digest([invoice.location_id, canonical(invoice.vendor_name), canonical(invoice.number), invoice.lane]);
  return db().begin(async sql => {
    // Serialize duplicate detection and insertion, including concurrent retries.
    await sql`select pg_advisory_xact_lock(hashtext(${`pv-invoices:${org}`}))`;
    const existing = await sql`select * from opsvista_pv_invoices where organization_id=${org}
      and (client_id=${client_id} or duplicate_key=${duplicate})`;
    if (existing.length) {
      if (existing.length !== 1 || existing[0].content_hash !== hash) throw new PvInvoiceConflict('Ya existe una factura con ese identificador o proveedor/número/sucursal/carril y datos distintos. Revisa el registro recibido.');
      return { created: false, invoice: project(existing[0]), client_id };
    }
    const [row] = await sql`insert into opsvista_pv_invoices (id,organization_id,client_id,duplicate_key,content_hash,payload,created_by)
      values (${randomUUID()},${org},${client_id},${duplicate},${hash},${JSON.stringify(invoice)}::jsonb,${actor}) returning *`;
    return { created: true, invoice: project(row), client_id };
  });
}
export async function listPvInvoices(org: string) {
  await schema();
  const rows = await db()`select *,count(*) over()::int as total from opsvista_pv_invoices
    where organization_id=${org} order by created_at desc,id desc limit 100`;
  return { data: rows.map(project), total: rows[0]?.total ?? 0, limit: 100 };
}
