import type { SessionUser } from './authSession.js';
import { partnerLocations, partnerScopes } from '../shared/partnerApi.js';
import { PUERTO_VALLARTA_ORG } from '../shared/tenantAccess.js';
import { authenticatePartnerKey, createPartnerKey, listPartnerKeys, reservePartnerRequest, revokePartnerKey } from './partnerApiStore.js';
import { cachedSource } from './sourceCache.js';
import { loadSource } from './sourceLoaders.js';
import { getIntegrationSnapshot } from './integrationStore.js';
import type { Restaurant365ApSnapshot } from './restaurant365OData.js';

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, string | string[]>; body?: Record<string, unknown> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (key: string, value: string) => void };
const value = (req: Request, key: string) => typeof req.query?.[key] === 'string' ? req.query[key] as string : '';
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const headers = (res: Response) => { res.setHeader?.('Cache-Control', 'private, no-store'); res.setHeader?.('X-OpsVista-API-Version', '1'); };
export async function partnerKeyEndpoint(req: Request, res: Response, user: SessionUser) {
  headers(res);
  if (user.role !== 'Founder' || (user.organizationId && user.organizationId !== PUERTO_VALLARTA_ORG)) return fail(res, 403, 'forbidden', 'Solo Founder puede administrar esta conexión.');
  try {
    if (!req.method || req.method === 'GET') return res.status(200).json({ keys: await listPartnerKeys(PUERTO_VALLARTA_ORG), scopes: partnerScopes, locations: partnerLocations, expiresInDays: 90 });
    if (req.method !== 'POST') { res.setHeader?.('Allow', 'GET, POST'); return fail(res, 405, 'method_not_allowed', 'Usa GET o POST.'); }
    const origin = req.headers?.origin, host = req.headers?.host;
    // Issuance/revocation requires an authenticated same-origin JSON request.
    if (typeof origin !== 'string' || typeof host !== 'string' || new URL(origin).host !== host || req.headers?.['sec-fetch-site'] === 'cross-site') return fail(res, 403, 'forbidden_origin', 'Solicitud fuera de OpsVista.');
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return fail(res, 415, 'json_required', 'Se requiere JSON.');
    if (req.body?.action === 'create') {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > 80) return fail(res, 400, 'invalid_name', 'Escribe un nombre de hasta 80 caracteres.');
      const result = await createPartnerKey(PUERTO_VALLARTA_ORG, user.id, name);
      return result ? res.status(201).json(result) : fail(res, 409, 'key_limit', 'Hay cinco claves activas. Revoca una antes de crear otra.');
    }
    if (req.body?.action === 'revoke' && typeof req.body.id === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.body.id)) {
      return await revokePartnerKey(PUERTO_VALLARTA_ORG, req.body.id) ? res.status(200).json({ revoked: true }) : fail(res, 404, 'key_not_found', 'Clave no encontrada.');
    }
    return fail(res, 400, 'invalid_action', 'Acción no válida.');
  } catch { return fail(res, 503, 'unavailable', 'No se pudo administrar la conexión. Intenta de nuevo.'); }
}

export function parseInvoiceQuery(req: Request) {
  if (Object.values(req.query || {}).some(Array.isArray)) throw new Error('Repeated parameter');
  if (Object.keys(req.query || {}).some(key => !['resource', 'endpoint', 'start', 'end', 'location_id', 'approval_status', 'limit', 'offset', 'snapshot_at'].includes(key))) throw new Error('Unknown parameter');
  const start = value(req, 'start'), end = value(req, 'end');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Dates required');
  const valid = (date: string) => Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!valid(start) || !valid(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 >= 31) throw new Error('Invalid date range');
  const period = { start, endExclusive: new Date(Date.parse(end) + 86400000).toISOString().slice(0, 10) };
  const locationId = value(req, 'location_id');
  if (locationId && !partnerLocations.some(row => row.id === locationId)) throw new Error('Invalid location');
  const approval = value(req, 'approval_status') || 'all';
  if (!['all', 'approved', 'unapproved'].includes(approval)) throw new Error('Invalid approval');
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = value(req, key);
    if (raw && !/^\d+$/.test(raw)) throw new Error('Invalid pagination');
    const n = raw ? Number(raw) : fallback;
    if (n < min || n > max) throw new Error('Invalid pagination');
    return n;
  };
  const limit = integer('limit', 100, 1, 200), offset = integer('offset', 0, 0, 10000), snapshotAt = value(req, 'snapshot_at');
  if (offset > 0 && !snapshotAt) throw new Error('Snapshot required for later pages');
  return { start, end, period, locationId, approval, limit, offset, snapshotAt };
}
export function projectPartnerInvoices(snapshot: Restaurant365ApSnapshot, query: ReturnType<typeof parseInvoiceQuery>) {
  const rows = snapshot.transactions.filter(row => {
    const location = partnerLocations.find(location => location.name === row.entity);
    return location && (!query.locationId || location.id === query.locationId) && row.date.slice(0, 10) >= query.start && row.date.slice(0, 10) <= query.end
      && (query.approval === 'all' || row.approved === (query.approval === 'approved'));
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const amounts = rows.filter(row => typeof row.amount === 'number' && Number.isFinite(row.amount));
  const nextOffset = query.offset + query.limit < rows.length ? query.offset + query.limit : null;
  return {
    data: rows.slice(query.offset, query.offset + query.limit).map(row => ({
      id: `r365:${row.id}`, source_id: row.id, number: row.number || null, transaction_date: row.date.slice(0, 10),
      location_id: partnerLocations.find(location => location.name === row.entity)!.id,
      vendor_name: row.vendor || null, amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null, currency: 'USD',
      approval_status: row.approved === true ? 'approved' : row.approved === false ? 'unapproved' : 'unknown',
      payment_status: 'unavailable', paid_amount: null, outstanding_amount: null,
    })),
    pagination: { limit: query.limit, offset: query.offset, total: rows.length, next_offset: nextOffset, snapshot_at: snapshot.fetchedAt },
    totals: { invoice_count: rows.length, known_invoice_amount: amounts.length ? money(amounts.reduce((sum, row) => sum + row.amount!, 0)) : null, missing_amounts: rows.length - amounts.length },
  };
}
async function readInvoices(org: string, start: string, end: string) {
  const until = new Date(Date.parse(end) + 86400000).toISOString().slice(0, 10);
  return cachedSource<Restaurant365ApSnapshot>(org, 'r365-ap', { start, end }, loadSource, false, async () => {
    const prior = await getIntegrationSnapshot<Restaurant365ApSnapshot>(org, 'restaurant365-odata', `ap:${start}:${until}`);
    return prior ? { payload: prior.payload, updatedAt: prior.payload.fetchedAt || prior.updatedAt } : null;
  });
}
export const partnerDependencies = { authenticate: authenticatePartnerKey, reserve: reservePartnerRequest, readInvoices };
export async function partnerApiEndpoint(req: Request, res: Response, deps = partnerDependencies) {
  headers(res);
  try {
    if (req.method && req.method !== 'GET') { res.setHeader?.('Allow', 'GET'); return fail(res, 405, 'read_only', 'Esta API solo permite GET.'); }
    const endpoint = value(req, 'endpoint');
    if (!['locations', 'invoices'].includes(endpoint)) return fail(res, 404, 'not_found', 'Ruta no disponible.');
    const key = await deps.authenticate(req.headers?.authorization);
    if (!key || key.organizationId !== PUERTO_VALLARTA_ORG) { res.setHeader?.('WWW-Authenticate', 'Bearer'); return fail(res, 401, 'invalid_api_key', 'Se requiere una clave de API válida.'); }
    if (!await deps.reserve(key.id)) { res.setHeader?.('Retry-After', '60'); return fail(res, 429, 'rate_limit', 'Límite de 30 solicitudes por minuto. Reintenta en 60 segundos.'); }
    if (endpoint === 'locations') return res.status(200).json({ api_version: '1', organization_id: key.organizationId, scopes: partnerScopes, data: partnerLocations });
    let query: ReturnType<typeof parseInvoiceQuery>;
    try { query = parseInvoiceQuery(req); } catch { return fail(res, 400, 'invalid_query', 'Usa start/end YYYY-MM-DD (máximo 31 días), location_id válido, approval_status all/approved/unapproved, limit 1–200 y offset 0–10000; conserva snapshot_at para páginas posteriores.'); }
    const result = await deps.readInvoices(key.organizationId, query.start, query.end);
    if (!result.data) { res.setHeader?.('Retry-After', '60'); return fail(res, 503, 'source_unavailable', 'Sin copia disponible de R365. La sincronización está pendiente; reintenta más tarde.'); }
    const snapshot = result.data;
    if (snapshot.provider !== 'restaurant365-odata' || snapshot.period.start !== query.start || snapshot.period.endExclusive !== query.period.endExclusive || !snapshot.fetchedAt || !Array.isArray(snapshot.transactions)) throw new Error('Invalid source snapshot');
    if (query.snapshotAt && query.snapshotAt !== snapshot.fetchedAt) return fail(res, 409, 'snapshot_changed', 'La copia se actualizó. Reinicia la paginación con offset=0.');
    return res.status(200).json({ api_version: '1', organization_id: key.organizationId, ...projectPartnerInvoices(snapshot, query),
      source: { provider: 'restaurant365-odata', snapshot_at: snapshot.fetchedAt, refresh_pending: result.memory.pending, date_basis: 'transaction_date' },
      limitations: ['Approval does not confirm payment. Applied payments, remaining balances and receipt files are unavailable.', 'Invoice amounts are not outstanding balances. Dates filter transactions, not payment or approval dates.', 'This is an OpsVista export of R365 data; PV Control is not yet the accounting source.'],
    });
  } catch { return fail(res, 503, 'unavailable', 'No se pudo consultar la fuente. Intenta de nuevo.'); }
}
