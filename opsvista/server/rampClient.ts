type RampTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

const tokenUrl = process.env.RAMP_TOKEN_URL || 'https://api.ramp.com/developer/v1/token';
const apiBaseUrl = process.env.RAMP_API_BASE_URL || 'https://api.ramp.com/developer/v1';

let cachedToken: { value: string; expiresAt: number } | null = null;

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

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Ramp token request failed: ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }

  const json = await response.json() as RampTokenResponse;
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(60, json.expires_in ?? 600) * 1000,
  };
  return json.access_token;
}

export async function rampGet<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${apiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ramp API ${response.status}: ${text.slice(0, 300)}`);
  }

  return await response.json() as T;
}
