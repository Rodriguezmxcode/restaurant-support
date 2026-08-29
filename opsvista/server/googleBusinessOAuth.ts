import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { GoogleBusinessCredentials } from './integrationStore.js';

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/business.manage'];

type Headers = Record<string, string | string[] | undefined>;
type OAuthState = { organizationId: string; userId: string; exp: number; nonce: string };

function stateSecret() {
  const secret = process.env.OPSVISTA_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('OPSVISTA_SESSION_SECRET must be configured before Google authorization');
  return secret;
}

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function publicOrigin(headers: Headers) {
  const configured = process.env.OPSVISTA_PUBLIC_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  const host = first(headers['x-forwarded-host']) || first(headers.host);
  if (!host) throw new Error('OpsVista public URL could not be determined');
  const protocol = first(headers['x-forwarded-proto']) || (host.includes('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

export function googleBusinessRedirectUri(headers: Headers) {
  return `${publicOrigin(headers)}/api/integrations/google-business/callback`;
}

function sign(body: string) {
  return createHmac('sha256', stateSecret()).update(body).digest('base64url');
}

export function createOAuthState(organizationId: string, userId: string) {
  const body = Buffer.from(JSON.stringify({ organizationId, userId, exp: Date.now() + 10 * 60_000, nonce: randomBytes(12).toString('base64url') } satisfies OAuthState)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyOAuthState(value: string): OAuthState {
  const [body, signature] = value.split('.');
  if (!body || !signature) throw new Error('Google authorization state is missing');
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Google authorization state is invalid');
  const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
  if (!state.organizationId || !state.userId || state.exp < Date.now()) throw new Error('Google authorization state expired');
  return state;
}

export function authorizationUrl(credential: GoogleBusinessCredentials, redirectUri: string, state: string) {
  const query = new URLSearchParams({
    client_id: credential.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: SCOPES.join(' '),
    state,
    login_hint: process.env.GOOGLE_BUSINESS_PROFILE_OWNER_EMAIL?.trim() || 'roberto@puertovallartausa.com',
  });
  return `${AUTHORIZATION_URL}?${query}`;
}

export async function exchangeAuthorizationCode(credential: GoogleBusinessCredentials, code: string, redirectUri: string) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(payload.error_description || payload.error || 'Google did not return a reusable authorization');
  }
  const userResponse = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${payload.access_token}` } });
  const user = await userResponse.json().catch(() => ({})) as { email?: string };
  return { refreshToken: payload.refresh_token, email: user.email };
}
