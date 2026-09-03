import { getRestaurant365Credentials, type Restaurant365Credentials } from './integrationStore.js';

const DEFAULT_BASE_URL = 'https://odata.restaurant365.net/api/v2/views';
const opsVistaLocations = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington'];

type ODataRow = Record<string, unknown>;

export type Restaurant365Location = {
  id: string;
  number?: string;
  name: string;
  opsVistaLocation?: string;
};

export type Restaurant365Status = {
  provider: 'restaurant365-odata';
  mode: 'read-only';
  configured: boolean;
  connected: boolean;
  credentialSource?: 'encrypted-store' | 'environment';
  domain?: string;
  usernameHint?: string;
  savedAt?: string;
  checkedAt?: string;
  latestTransactionAt?: string;
  locations: Restaurant365Location[];
  expectedLocations: string[];
  mappedLocationCount: number;
  probes: { locations: boolean; glAccounts: boolean; transactions: boolean };
  probeErrors?: Partial<Record<'locations' | 'glAccounts' | 'transactions', string>>;
  pnlReady: boolean;
  error?: string;
};

function environmentCredentials(): Restaurant365Credentials | null {
  const domain = process.env.RESTAURANT365_DOMAIN?.trim();
  const username = process.env.RESTAURANT365_USERNAME?.trim();
  const password = process.env.RESTAURANT365_PASSWORD;
  return domain && username && password ? { domain, username, password } : null;
}

async function credentialsFor(organizationId: string) {
  const stored = await getRestaurant365Credentials(organizationId);
  if (stored) return { credentials: stored, source: 'encrypted-store' as const };
  const environment = environmentCredentials();
  return environment ? { credentials: environment, source: 'environment' as const } : null;
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/puerto\s+vallarta|mexican\s+restaurant|restaurant/g, '').replace(/[^a-z0-9]/g, '');
}

function mappedLocation(name: string) {
  const candidate = normalized(name);
  return opsVistaLocations.find(location => {
    const expected = normalized(location);
    return candidate === expected || candidate.includes(expected) || expected.includes(candidate);
  });
}

function value(row: ODataRow, candidates: string[]) {
  const entry = Object.entries(row).find(([key]) => candidates.some(candidate => key.toLowerCase() === candidate.toLowerCase()));
  return entry?.[1];
}

function stringValue(row: ODataRow, candidates: string[]) {
  const result = value(row, candidates);
  return result === undefined || result === null ? '' : String(result);
}

function responseRows(payload: unknown): ODataRow[] {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === 'object') as ODataRow[];
  if (!payload || typeof payload !== 'object') return [];
  const rows = (payload as { value?: unknown }).value;
  return Array.isArray(rows) ? rows.filter(item => item && typeof item === 'object') as ODataRow[] : [];
}

function usernameHint(username: string) {
  if (username.includes('@')) {
    const [local, host] = username.split('@');
    return `${local.slice(0, 2)}***@${host}`;
  }
  return username.length <= 3 ? '***' : `${username.slice(0, 2)}***${username.slice(-1)}`;
}

async function odata(credentials: Restaurant365Credentials, view: 'Location' | 'GlAccount' | 'Transaction', params: Record<string, string>) {
  const base = (process.env.RESTAURANT365_ODATA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(`${base}/${view}`);
  Object.entries(params).forEach(([key, parameter]) => url.searchParams.set(key, parameter));
  const authorization = Buffer.from(`${credentials.domain}\\${credentials.username}:${credentials.password}`, 'utf8').toString('base64');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Basic ${authorization}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Restaurant365 rechazó el usuario, la contraseña o el permiso OData.');
    if (response.status === 429) throw new Error('Restaurant365 limitó temporalmente las consultas. Intenta de nuevo en unos minutos.');
    throw new Error(`${view}: Restaurant365 OData respondió con estado ${response.status}.`);
  }
  return responseRows(await response.json());
}

async function probe(credentials: Restaurant365Credentials, view: 'Location' | 'GlAccount' | 'Transaction', params: Record<string, string>) {
  try { return { ok: true as const, rows: await odata(credentials, view, params) }; }
  catch (error) { return { ok: false as const, rows: [] as ODataRow[], error: error instanceof Error ? error.message : `${view}: validación no disponible.` }; }
}

export async function getRestaurant365Status(organizationId: string): Promise<Restaurant365Status> {
  const resolved = await credentialsFor(organizationId);
  const empty: Restaurant365Status = {
    provider: 'restaurant365-odata', mode: 'read-only', configured: Boolean(resolved), connected: false,
    credentialSource: resolved?.source, domain: resolved?.credentials.domain,
    usernameHint: resolved ? usernameHint(resolved.credentials.username) : undefined,
    savedAt: resolved?.credentials.savedAt, locations: [], expectedLocations: opsVistaLocations,
    mappedLocationCount: 0, probes: { locations: false, glAccounts: false, transactions: false }, pnlReady: false,
  };
  if (!resolved) return empty;

  const [locationProbe, glProbe, transactionProbe] = await Promise.all([
    probe(resolved.credentials, 'Location', { '$select': 'locationId,locationNumber,name', '$orderby': 'name', '$top': '250' }),
    probe(resolved.credentials, 'GlAccount', { '$select': 'glAccountId,glAccountNumber,name,glType,operationalCategory', '$top': '1' }),
    probe(resolved.credentials, 'Transaction', { '$select': 'transactionId,date,type,modifiedOn', '$orderby': 'modifiedOn desc', '$top': '1' }),
  ]);
  const failures = {
    locations: locationProbe.ok ? undefined : locationProbe.error,
    glAccounts: glProbe.ok ? undefined : glProbe.error,
    transactions: transactionProbe.ok ? undefined : transactionProbe.error,
  };
  const authenticationError = [locationProbe,glProbe,transactionProbe].find(result=>!result.ok&&/rechazó el usuario/i.test(result.error||''));
  const connected = locationProbe.ok || glProbe.ok || transactionProbe.ok;
  const mapped = locationProbe.rows.map(row => {
    const name = stringValue(row, ['name', 'locationName']);
    return {
      id: stringValue(row, ['locationId', 'id']),
      number: stringValue(row, ['locationNumber', 'number']) || undefined,
      name,
      opsVistaLocation: mappedLocation(name),
    };
  }).filter(location => location.id || location.name);
  const mappedLocationCount = new Set(mapped.map(location => location.opsVistaLocation).filter(Boolean)).size;
  const latestTransactionAt = transactionProbe.rows[0] ? stringValue(transactionProbe.rows[0], ['modifiedOn', 'date']) || undefined : undefined;
  const failedNames = Object.entries(failures).filter(([,message])=>message).map(([name])=>name==='glAccounts'?'plan de cuentas':name==='transactions'?'transacciones':'locaciones');
  return {
    ...empty, connected, checkedAt: new Date().toISOString(), locations: mapped, mappedLocationCount,
    probes: { locations: locationProbe.ok, glAccounts: glProbe.ok, transactions: transactionProbe.ok },
    probeErrors: failures,
    latestTransactionAt,
    pnlReady: mappedLocationCount === opsVistaLocations.length && glProbe.ok && transactionProbe.ok,
    error: authenticationError?.error || (failedNames.length ? `La autenticación funcionó, pero falta validar: ${failedNames.join(', ')}.` : undefined),
  };
}
