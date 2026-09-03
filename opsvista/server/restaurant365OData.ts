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
    throw new Error(`Restaurant365 OData respondió con estado ${response.status}.`);
  }
  return responseRows(await response.json());
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

  try {
    const [locations, glAccounts, transactions] = await Promise.all([
      odata(resolved.credentials, 'Location', { '$select': 'locationId,locationNumber,name', '$orderby': 'name', '$top': '250' }),
      odata(resolved.credentials, 'GlAccount', { '$select': 'glAccountId,accountNumber,name,accountType,operationalCategory', '$top': '1' }),
      odata(resolved.credentials, 'Transaction', { '$select': 'transactionId,date,type,modifiedOn', '$orderby': 'modifiedOn desc', '$top': '1' }),
    ]);
    const mapped = locations.map(row => {
      const name = stringValue(row, ['name', 'locationName']);
      return {
        id: stringValue(row, ['locationId', 'id']),
        number: stringValue(row, ['locationNumber', 'number']) || undefined,
        name,
        opsVistaLocation: mappedLocation(name),
      };
    }).filter(location => location.id || location.name);
    const mappedLocationCount = new Set(mapped.map(location => location.opsVistaLocation).filter(Boolean)).size;
    const latestTransactionAt = transactions[0] ? stringValue(transactions[0], ['modifiedOn', 'date']) || undefined : undefined;
    return {
      ...empty, connected: true, checkedAt: new Date().toISOString(), locations: mapped, mappedLocationCount,
      probes: { locations: true, glAccounts: glAccounts.length > 0, transactions: transactions.length > 0 },
      latestTransactionAt,
      pnlReady: mappedLocationCount === opsVistaLocations.length && glAccounts.length > 0 && transactions.length > 0,
    };
  } catch (error) {
    return { ...empty, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'No se pudo validar Restaurant365.' };
  }
}
