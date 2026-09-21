import type { SessionUser } from './authSession.js';
import { CopilotError, copilotScope, parseCopilotInput } from './copilotPolicy.js';
import { copilotConfigured, reserveCopilotRequest } from './copilotQuota.js';
import { openAIResponse, runCopilot } from './copilotEngine.js';
import { copilotSourceReader } from './copilotSources.js';

type Request = { method?: string; headers?: Record<string, string | string[] | undefined> & { cookie?: string }; body?: Record<string, unknown> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (key: string, value: string) => void };
export async function copilotEndpoint(req: Request, res: Response, user: SessionUser, tasks: Parameters<typeof copilotSourceReader>[2]) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  try {
    const scope = copilotScope(user);
    if (!req.method || req.method === 'GET') return res.status(200).json({ configured: copilotConfigured(), ...scope });
    if (req.method !== 'POST') { res.setHeader?.('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    // Same-origin JSON only; existing HttpOnly session is validated by workflows.
    const origin = req.headers?.origin, host = req.headers?.host;
    if (req.headers?.['sec-fetch-site'] === 'cross-site' || (typeof origin === 'string' && typeof host === 'string' && new URL(origin).host !== host)) throw new CopilotError(403, 'Solicitud fuera de OpsVista.');
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) throw new CopilotError(415, 'Se requiere una solicitud JSON.');
    parseCopilotInput(req.body || {});
    if (!copilotConfigured()) throw new CopilotError(503, 'La IA aún no está activada. Falta configurar la conexión de OpenAI en OpsVista. Puedes seguir usando la guía de módulos.');
    await reserveCopilotRequest(user);
    const answer = await runCopilot(user, req.body || {}, { read: copilotSourceReader(user, req.headers?.cookie, tasks), respond: openAIResponse });
    return res.status(200).json(answer);
  } catch (error) {
    const known = error instanceof CopilotError;
    if (known && error.details.retryAfterSeconds !== undefined) res.setHeader?.('Retry-After', String(error.details.retryAfterSeconds));
    return res.status(known ? error.status : 503).json({ error: known ? error.message : 'No se pudo consultar el asistente. Intenta de nuevo.', ...(known ? error.details : {}) });
  }
}
