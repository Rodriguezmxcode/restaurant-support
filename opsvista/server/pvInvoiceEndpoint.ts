import type { SessionUser } from './authSession.js';
import { PUERTO_VALLARTA_ORG } from '../shared/tenantAccess.js';
import { parsePvInvoice, receivePvInvoice, listPvInvoices, PvInvoiceConflict } from './pvInvoiceStore.js';

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, string | string[]>; body?: unknown };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (key: string, value: string) => void };
const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
export const pvInvoiceDependencies = { receive: receivePvInvoice, list: listPvInvoices };
export async function pvInvoiceEndpoint(req: Request, res: Response, user: SessionUser | null, deps = pvInvoiceDependencies) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (!user) return fail(res, 401, 'session_required', 'Inicia sesión en OpsVista.');
  if (user.role !== 'Founder' || (user.organizationId && user.organizationId !== PUERTO_VALLARTA_ORG)) return fail(res, 403, 'forbidden', 'Solo Founder de Puerto Vallarta puede recibir estas facturas.');
  if (req.headers?.['sec-fetch-site'] !== 'same-origin' || req.headers?.['x-pv-source'] !== 'pv-control') return fail(res, 403, 'forbidden_origin', 'Abre la conexión desde OpsVista.');
  if (Object.keys(req.query || {}).some(key => !['resource', 'endpoint'].includes(key)) || Object.values(req.query || {}).some(Array.isArray)) return fail(res, 400, 'invalid_query', 'Consulta no válida.');
  try {
    if (req.method === 'GET') return res.status(200).json({ organization_id: PUERTO_VALLARTA_ORG, ...await deps.list(PUERTO_VALLARTA_ORG) });
    if (req.method !== 'POST') { res.setHeader?.('Allow', 'GET, POST'); return fail(res, 405, 'method_not_allowed', 'Usa GET o POST.'); }
    const origin = req.headers?.origin, host = req.headers?.host;
    let sameOrigin = false;
    try { sameOrigin = typeof origin === 'string' && typeof host === 'string' && new URL(origin).host === host && new URL(origin).protocol === 'https:'; } catch {}
    if (!sameOrigin) return fail(res, 403, 'forbidden_origin', 'Confirma el envío dentro de OpsVista.');
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return fail(res, 415, 'json_required', 'Se requiere JSON.');
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 16_384) return fail(res, 413, 'payload_too_large', 'La factura supera el tamaño permitido.');
    let invoice;
    try { invoice = parsePvInvoice(req.body); } catch (error) { return fail(res, 400, 'invalid_invoice', error instanceof Error ? error.message : 'Revisa la factura.'); }
    const result = await deps.receive(PUERTO_VALLARTA_ORG, user.id, invoice);
    return res.status(result.created ? 201 : 200).json({ organization_id: PUERTO_VALLARTA_ORG, ...result });
  } catch (error) {
    if (error instanceof PvInvoiceConflict) return fail(res, 409, 'invoice_conflict', error.message);
    return fail(res, 503, 'unavailable', 'No se pudo confirmar el guardado. Puedes reintentar el mismo envío sin crear un duplicado.');
  }
}
