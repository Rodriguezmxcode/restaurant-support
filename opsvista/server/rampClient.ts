type RampTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

const tokenUrl = process.env.RAMP_TOKEN_URL || 'https://api.ramp.com/developer/v1/token';
const apiBaseUrl = process.env.RAMP_API_BASE_URL || 'https://api.ramp.com/developer/v1';

let cachedToken: { value: string; expiresAt: number; scopes: string } | null = null;

async function timedFetch(url: string | URL, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`${label} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestAccessToken(scopes: string, clientId: string, clientSecret: string) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: scopes,
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return await timedFetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  }, 7_000, 'Ramp token request');
}

async function getAccessToken(): Promise<string> {
  if (process.env.RAMP_ACCESS_TOKEN) return process.env.RAMP_ACCESS_TOKEN;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const clientId = process.env.RAMP_CLIENT_ID;
  const clientSecret = process.env.RAMP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Ramp credentials are not configured in the server environment.');
  }

  const configuredScopes = process.env.RAMP_SCOPES?.trim();
  const requestedScopes = [...new Set([
    ...(configuredScopes?.split(/\s+/).filter(Boolean) ?? []),
    'transactions:read',
    'users:read',
  ])].join(' ');
  let scopes = requestedScopes;
  let response = await requestAccessToken(scopes, clientId, clientSecret);

  // Transactions remain available when an older Ramp app has not yet been
  // granted users:read. The API payload will disclose that enrichment is
  // unavailable instead of dropping the complete expense ledger.
  if (!response.ok && response.status !== 401) {
    scopes = configuredScopes || 'transactions:read';
    response = await requestAccessToken(scopes, clientId, clientSecret);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Ramp token request failed: ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }

  const json = await response.json() as RampTokenResponse;
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(60, json.expires_in ?? 600) * 1000,
    scopes,
  };
  return json.access_token;
}

export async function rampGet<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${apiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });

  const response = await timedFetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  }, 8_000, `Ramp ${path} request`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ramp API ${response.status}: ${text.slice(0, 300)}`);
  }

  return await response.json() as T;
}
