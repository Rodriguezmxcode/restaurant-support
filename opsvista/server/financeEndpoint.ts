import type { SessionUser } from './authSession.js';
import { PUERTO_VALLARTA_ORG } from '../shared/tenantAccess.js';
import { financeKey, parseFinanceImport } from '../shared/finance.js';
import { FinanceConflict, listFinance, saveFinance } from './financeStore.js';

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown; query?: Record<string, string | string[]> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (key: string, value: string) => void };
const dependencies = { list: listFinance, save: saveFinance };
export async function financeEndpoint(req: Request, res: Response, user: SessionUser | null, deps = dependencies) {
  const fail = (code: number, message: string) => res.status(code).json({ error: message });
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (!user) return fail(401, 'Inicia sesión en OpsVista.');
  if (!['Founder', 'Corporate', 'Administration'].includes(user.role) || (user.organizationId !== PUERTO_VALLARTA_ORG && !(user.role === 'Founder' && !user.organizationId))) return fail(403, 'No tienes acceso a estos reportes financieros.');
  if (Object.keys(req.query || {}).some(key => key !== 'resource') || Object.values(req.query || {}).some(Array.isArray)) return fail(400, 'Consulta no válida.');
  try {
    if (req.method === 'GET') return res.status(200).json({ records: await deps.list(PUERTO_VALLARTA_ORG) });
    if (req.method !== 'POST') { res.setHeader?.('Allow', 'GET, POST'); return fail(405, 'Método no permitido.'); }
    if (!['Founder', 'Corporate'].includes(user.role)) return fail(403, 'Solo Founder o Corporate pueden importar P&L.');
    let sameOrigin = false;
    try { const origin = new URL(String(req.headers?.origin)); sameOrigin = origin.protocol === 'https:' && origin.host === req.headers?.host; } catch { /* Invalid origin. */ }
    if (!sameOrigin || req.headers?.['sec-fetch-site'] !== 'same-origin' || req.headers?.['x-opsvista-finance'] !== 'import') return fail(403, 'Revisa e importa el archivo dentro de Finanzas.');
    if (!String(req.headers?.['content-type']).toLowerCase().startsWith('application/json')) return fail(415, 'Se requiere un archivo JSON de Finanzas.');
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 500_000) return fail(413, 'El archivo supera el tamaño permitido.');
    let batch, expected: Record<string, string | null>;
    try {
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['batch', 'expected'].includes(key))) throw new Error('Solicitud no válida.');
      batch = parseFinanceImport(body.batch);
      if (!body.expected || typeof body.expected !== 'object' || Array.isArray(body.expected)) throw new Error('Actualiza Finanzas antes de importar.');
      expected = body.expected as Record<string, string | null>;
      const keys = batch.records.map(financeKey);
      if (Object.keys(expected).length !== keys.length || keys.some(key => !(key in expected)) || Object.values(expected).some(value => value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)))) throw new Error('La revisión del archivo no es válida.');
    } catch (error) { return fail(400, error instanceof Error ? error.message : 'Archivo no válido.'); }
    return res.status(200).json(await deps.save(PUERTO_VALLARTA_ORG, user.id, batch, expected));
  } catch (error) {
    if (error instanceof FinanceConflict) return fail(409, error.message);
    return fail(503, 'Finanzas no está disponible. Puedes reintentar la misma importación sin duplicar los reportes.');
  }
}
