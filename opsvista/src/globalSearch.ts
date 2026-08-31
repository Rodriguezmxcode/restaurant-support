import type { OpsVistaModule } from './accessControl';
import type { RampTransaction } from './rampCompliance';
import { loadRampTransactions } from './rampDataSource';
import { scopeRampTransactionsForLocations } from '../shared/rampAccess';

export type SearchHorizon = 'today' | 'tomorrow' | 'next_7' | 'next_14' | 'next_30';

export type GlobalSearchResult = {
  id: string;
  section: OpsVistaModule;
  label: string;
  description: string;
  badge: string;
  query?: string;
  recordId?: string;
  location?: string;
  date?: string;
  horizon?: SearchHorizon;
};

type JsonRecord = Record<string, unknown>;
type CacheEntry = { expiresAt: number; value: Promise<unknown> };

const responseCache = new Map<string, CacheEntry>();
let rampCache: { expiresAt: number; value: Promise<RampTransaction[]> } | null = null;
const cacheMs = 60_000;

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' ? value as JsonRecord : {};
const asArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(asRecord) : [];
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const normalize = (value: unknown) =>
  text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const money = (value: unknown) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(Number(value) || 0);

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function matches(values: unknown[], query: string) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const haystack = normalize(values.filter(Boolean).join(' '));
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function locationAllowed(value: unknown, allowedLocations: string[]) {
  const candidate = normalize(value);
  return allowedLocations.some(location => normalize(location) === candidate);
}

async function cachedJson(url: string): Promise<unknown> {
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = fetch(url, { credentials: 'include', cache: 'no-store' })
    .then(async response => response.ok ? response.json() : Promise.reject(new Error(`Search source ${response.status}`)));
  responseCache.set(url, { expiresAt: Date.now() + cacheMs, value });
  try { return await value; } catch (error) { responseCache.delete(url); throw error; }
}

function unique(results: GlobalSearchResult[]) {
  const seen = new Set<string>();
  return results.filter(result => {
    if (seen.has(result.id)) return false;
    seen.add(result.id);
    return true;
  });
}

async function cachedRampTransactions() {
  if (rampCache && rampCache.expiresAt > Date.now()) return rampCache.value;
  const today = easternToday();
  const value = loadRampTransactions({ fromDate: addDays(today, -29), toDate: today }).then(envelope => envelope.transactions);
  rampCache = { expiresAt: Date.now() + cacheMs, value };
  try { return await value; } catch (error) { rampCache = null; throw error; }
}

async function searchRamp(query: string, allowedLocations: string[]): Promise<GlobalSearchResult[]> {
  const transactions = scopeRampTransactionsForLocations(await cachedRampTransactions(), allowedLocations);
  return transactions
    .filter(transaction => matches([
      transaction.id, transaction.merchant, transaction.merchantLocation, transaction.cardholder,
      transaction.restaurant, transaction.department, transaction.memo, transaction.category,
      transaction.accountingCategory, transaction.date, transaction.amount,
    ], query))
    .slice(0, 6)
    .map(transaction => ({
      id: `ramp-${transaction.id}`,
      section: 'Gastos',
      label: `${transaction.merchant || 'Ramp expense'} · ${money(transaction.amount)}`,
      description: [transaction.cardholder, transaction.restaurant || transaction.department, transaction.date].filter(Boolean).join(' · '),
      badge: 'RAMP',
      query,
      recordId: transaction.id,
      location: transaction.restaurant || transaction.department,
    }));
}

async function searchPayments(query: string, allowedLocations: string[], section: 'Pagos' | 'Finanzas'): Promise<GlobalSearchResult[]> {
  const payload = asRecord(await cachedJson('/api/payments'));
  return asArray(payload.payments)
    .filter(payment => locationAllowed(payment.location, allowedLocations))
    .filter(payment => matches([
      payment.id, payment.title, payment.payee, payment.reason, payment.requestedByName,
      payment.approvedByName, payment.issuedByName, payment.location, payment.status,
      payment.requestDate, payment.checkNumber,
    ], query))
    .slice(0, 6)
    .map(payment => ({
      id: `payment-${text(payment.id)}`,
      section,
      label: text(payment.title) || text(payment.payee) || 'Payment request',
      description: [text(payment.payee), text(payment.location), money(payment.amount), text(payment.status)].filter(Boolean).join(' · '),
      badge: 'PAGO',
      query,
      recordId: text(payment.id),
      location: text(payment.location),
    }));
}

async function searchActions(query: string, allowedLocations: string[], section: 'Action Center' | 'Prioridades'): Promise<GlobalSearchResult[]> {
  const payload = asRecord(await cachedJson('/api/workflows?resource=actions'));
  return asArray(payload.actions)
    .filter(action => locationAllowed(action.location, allowedLocations))
    .filter(action => matches([
      action.id, action.title, action.location, action.category, action.ownerName, action.accountableName, action.accountableRole,
      action.signal, action.cause, action.recommendation, action.status,
    ], query))
    .slice(0, 6)
    .map(action => ({
      id: `action-${text(action.id)}`,
      section,
      label: text(action.title) || 'Operational action',
      description: [text(action.location), text(action.ownerName) || 'Unassigned', text(action.status)].join(' · '),
      badge: 'ACCIÓN',
      query,
      recordId: text(action.id),
      location: text(action.location),
    }));
}

async function searchProjects(query: string, allowedLocations: string[]): Promise<GlobalSearchResult[]> {
  const payload = asRecord(await cachedJson('/api/workflows?resource=projects'));
  const scope = new Set(allowedLocations.map(normalize));
  return asArray(payload.projects)
    .filter(project => {
      const projectLocations = Array.isArray(project.locations) ? project.locations.map(text) : [];
      return projectLocations.length > 0 && projectLocations.every(location => scope.has(normalize(location)));
    })
    .filter(project => matches([
      project.id, project.name, project.description, project.objective, project.ownerName,
      ...(Array.isArray(project.collaborators) ? project.collaborators : []),
      ...(Array.isArray(project.locations) ? project.locations : []),
      project.status, project.priority,
    ], query))
    .slice(0, 6)
    .map(project => ({
      id: `project-${text(project.id)}`,
      section: 'Proyectos',
      label: text(project.name) || 'Project',
      description: [
        ...(Array.isArray(project.locations) ? project.locations.map(text) : []),
        text(project.ownerName), text(project.status),
      ].filter(Boolean).join(' · '),
      badge: 'PROYECTO',
      query,
      recordId: text(project.id),
    }));
}

async function searchTransfers(query: string, allowedLocations: string[]): Promise<GlobalSearchResult[]> {
  const payload = asRecord(await cachedJson('/api/transfers'));
  return asArray(payload.transfers)
    .filter(transfer => locationAllowed(transfer.sourceLocation, allowedLocations) || locationAllowed(transfer.destinationLocation, allowedLocations))
    .filter(transfer => matches([
      transfer.id, transfer.sourceLocation, transfer.destinationLocation, transfer.createdByName,
      transfer.receiverName, transfer.notes, transfer.status, transfer.receiptStatus,
      ...asArray(transfer.items).flatMap(item => [item.name, item.note]),
    ], query))
    .slice(0, 6)
    .map(transfer => ({
      id: `transfer-${text(transfer.id)}`,
      section: 'Transferencias',
      label: `${text(transfer.sourceLocation)} → ${text(transfer.destinationLocation)}`,
      description: [text(transfer.id), text(transfer.createdByName), text(transfer.receiptStatus)].filter(Boolean).join(' · '),
      badge: 'TRANSFER',
      query,
      recordId: text(transfer.id),
    }));
}

async function searchTasks(query: string, allowedLocations: string[]): Promise<GlobalSearchResult[]> {
  const today = easternToday();
  const url = `/api/tasks/weekly?start=${addDays(today, -29)}&end=${today}`;
  const payload = asRecord(await cachedJson(url));
  const taskResults = asArray(payload.accountability)
    .filter(task => locationAllowed(task.locationName, allowedLocations))
    .filter(task => matches([
      task.key, task.taskName, task.taskListName, task.position, task.userName,
      task.locationName, task.date, task.completed ? 'complete completed cumplida' : 'pending incomplete pendiente',
    ], query))
    .slice(0, 5)
    .map(task => ({
      id: `task-${text(task.key)}`,
      section: 'Tasks' as OpsVistaModule,
      label: text(task.taskName) || text(task.taskListName) || '7shifts task',
      description: [text(task.locationName), text(task.userName), text(task.date), task.completed ? 'Completed' : 'Pending'].filter(Boolean).join(' · '),
      badge: 'TASK',
      query,
      recordId: text(task.key),
      location: text(task.locationName),
      date: text(task.date),
    }));
  const logbookResults = asArray(payload.logbook)
    .filter(entry => locationAllowed(entry.locationName, allowedLocations))
    .filter(entry => matches([
      entry.id, entry.author, entry.category, entry.message, entry.locationName, entry.date, 'logbook',
    ], query))
    .slice(0, 4)
    .map(entry => ({
      id: `logbook-${text(entry.id)}`,
      section: 'Tasks' as OpsVistaModule,
      label: `Logbook · ${text(entry.author) || text(entry.category) || 'Entry'}`,
      description: [text(entry.locationName), text(entry.date), text(entry.category)].filter(Boolean).join(' · '),
      badge: 'LOGBOOK',
      query,
      recordId: text(entry.id),
      location: text(entry.locationName),
      date: text(entry.date),
    }));
  return [...taskResults, ...logbookResults];
}

async function searchLocalIntelligence(query: string, allowedLocations: string[]): Promise<GlobalSearchResult[]> {
  const payload = asRecord(await cachedJson('/api/local-intelligence?location=All+locations&horizon=next_30'));
  const results: GlobalSearchResult[] = [];
  for (const row of asArray(payload.locations)) {
    if (!locationAllowed(row.location, allowedLocations)) continue;
    const location = text(row.location);
    const weather = asRecord(row.weather);
    const traffic = asRecord(row.traffic);
    const events = asArray(asRecord(row.events).events);
    if (matches([
      location, weather.phrase, weather.temperature, weather.feelsLike,
      traffic.topIncident, traffic.congestionPct, asRecord(row.assessment).summary,
      'weather clima traffic trafico local intelligence',
    ], query)) {
      results.push({
        id: `local-${location}`,
        section: 'Local Intelligence',
        label: `Local Intelligence · ${location}`,
        description: [text(weather.phrase), text(traffic.topIncident)].filter(Boolean).join(' · ') || 'Clima, tráfico y señales locales',
        badge: 'LOCAL',
        query,
        location,
        horizon: 'next_30',
      });
    }
    for (const event of events) {
      if (!matches([event.id, event.name, event.venue, event.city, event.category, event.date, location], query)) continue;
      results.push({
        id: `event-${text(event.id)}-${location}`,
        section: 'Local Intelligence',
        label: text(event.name) || 'Nearby event',
        description: [location, text(event.date), text(event.venue)].filter(Boolean).join(' · '),
        badge: 'EVENTO',
        query,
        recordId: text(event.id),
        location,
        horizon: 'next_30',
      });
      if (results.length >= 6) break;
    }
    if (results.length >= 6) break;
  }
  return results.slice(0, 6);
}

export async function searchLiveOpsVista(
  query: string,
  modules: OpsVistaModule[],
  allowedLocations: string[],
): Promise<GlobalSearchResult[]> {
  if (normalize(query).length < 2 || !allowedLocations.length) return [];
  const jobs: Array<Promise<GlobalSearchResult[]>> = [];
  if (modules.includes('Gastos')) jobs.push(searchRamp(query, allowedLocations));
  if (modules.includes('Pagos') || modules.includes('Finanzas')) jobs.push(searchPayments(query, allowedLocations, modules.includes('Pagos') ? 'Pagos' : 'Finanzas'));
  if (modules.includes('Action Center') || modules.includes('Prioridades')) jobs.push(searchActions(query, allowedLocations, modules.includes('Action Center') ? 'Action Center' : 'Prioridades'));
  if (modules.includes('Proyectos')) jobs.push(searchProjects(query, allowedLocations));
  if (modules.includes('Transferencias')) jobs.push(searchTransfers(query, allowedLocations));
  if (modules.includes('Tasks')) jobs.push(searchTasks(query, allowedLocations));
  if (modules.includes('Local Intelligence')) jobs.push(searchLocalIntelligence(query, allowedLocations));

  const settled = await Promise.allSettled(jobs);
  const results = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const normalizedQuery = normalize(query);
  return unique(results)
    .sort((left, right) => {
      const leftLabel = normalize(left.label);
      const rightLabel = normalize(right.label);
      const leftScore = leftLabel === normalizedQuery ? 0 : leftLabel.startsWith(normalizedQuery) ? 1 : 2;
      const rightScore = rightLabel === normalizedQuery ? 0 : rightLabel.startsWith(normalizedQuery) ? 1 : 2;
      return leftScore - rightScore || left.label.localeCompare(right.label);
    })
    .slice(0, 12);
}
