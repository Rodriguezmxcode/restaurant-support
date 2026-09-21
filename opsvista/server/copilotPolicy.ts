import type { SessionUser } from './authSession.js';
import { hasLegacyWorkspace } from '../shared/tenantAccess.js';
import type { CopilotDataset } from '../shared/copilotAgent.js';

const restaurants = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington'];
const datasetsByRole: Record<SessionUser['role'], CopilotDataset[]> = {
  Founder: ['performance', 'ramp', 'tasks', 'actions', 'provi', 'reviews'],
  Corporate: ['performance', 'ramp', 'tasks', 'actions', 'provi', 'reviews'],
  'Location Manager': ['performance', 'ramp', 'tasks', 'actions', 'reviews'],
  Administration: ['ramp', 'actions', 'provi'],
  Kitchen: ['tasks', 'actions'], HR: ['actions'], Maintenance: ['tasks', 'actions'],
  'Online Reputation Manager': [],
};

export class CopilotError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function copilotScope(user: SessionUser) {
  if (!hasLegacyWorkspace(user) || !datasetsByRole[user.role]?.length) throw new CopilotError(403, 'El asistente no está habilitado para esta cuenta.');
  const global = ['Founder', 'Corporate', 'Administration', 'HR', 'Maintenance'].includes(user.role);
  const locations = global ? [...restaurants] : restaurants.filter(name => user.locations.includes(name));
  if (!locations.length) throw new CopilotError(403, 'No hay locaciones autorizadas para consultar.');
  return { datasets: [...datasetsByRole[user.role]], locations };
}

export function easternToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export type CopilotQuery = { dataset: CopilotDataset; start: string; end: string; locations: string[] };
export function parseCopilotQuery(value: unknown, user: SessionUser, today = easternToday()): CopilotQuery {
  const scope = copilotScope(user);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CopilotError(400, 'Consulta inválida.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['dataset', 'start', 'end', 'locations'].includes(key))) throw new CopilotError(400, 'Parámetros no permitidos.');
  if (!scope.datasets.includes(row.dataset as CopilotDataset)) throw new CopilotError(403, 'Fuente fuera de los permisos de esta cuenta.');
  if (!validDate(row.start) || !validDate(row.end) || row.start > row.end || row.end > today) throw new CopilotError(400, 'Usa un período válido, sin fechas futuras.');
  const days = (Date.parse(row.end) - Date.parse(row.start)) / 86400000 + 1;
  if (days > (row.dataset === 'provi' ? 93 : 31)) throw new CopilotError(400, 'Consulta hasta 31 días por fuente, o 93 días para reportes Provi.');
  if (!Array.isArray(row.locations) || row.locations.length > 6 || row.locations.some(name => typeof name !== 'string' || !scope.locations.includes(name))) throw new CopilotError(403, 'Locación fuera de los permisos de esta cuenta.');
  const locations = row.locations.length ? [...new Set(row.locations as string[])] : scope.locations;
  return { dataset: row.dataset as CopilotDataset, start: row.start, end: row.end, locations };
}

export function parseCopilotInput(body: Record<string, unknown>) {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 4000) throw new CopilotError(400, 'Escribe una pregunta de hasta 4,000 caracteres.');
  if (body.history !== undefined && !Array.isArray(body.history)) throw new CopilotError(400, 'Historial inválido.');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new CopilotError(400, 'Historial inválido.');
    const row = value as Record<string, unknown>;
    if (!['user', 'assistant'].includes(String(row.role)) || typeof row.text !== 'string' || row.text.length > 4000) throw new CopilotError(400, 'Historial inválido.');
    return { role: row.role as 'user' | 'assistant', content: row.text };
  });
  return { question, history };
}
