import { createHmac, timingSafeEqual, scryptSync } from 'node:crypto';
import { getManagedUser, getManagedUserByEmail } from './managementStore.js';
import { authenticateStoredCredential } from './accountStore.js';
import { getOrganizationMembership } from './organizationStore.js';

export type ServerRole = 'Founder' | 'Corporate' | 'Location Manager' | 'Kitchen' | 'HR' | 'Administration' | 'Maintenance';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: ServerRole;
  title: string;
  locations: string[];
  organizationId?: string;
  organizationName?: string;
  organizationSlug?: string;
  clientNumber?: number;
};

type AuthUserRecord = SessionUser & {
  active?: boolean;
  passwordSalt: string;
  passwordHash: string;
};

type SessionPayload = SessionUser & { exp: number; iat: number };

const COOKIE_NAME = 'opsvista_session';
// Supabase owns the long-lived browser session. This short server session is
// refreshed silently while the user is active and limits stale role access.
const SESSION_TTL_SECONDS = 60 * 60 * 2;

function configuredSecret() {
  const value = process.env.OPSVISTA_SESSION_SECRET;
  return value && value.length >= 32 ? value : null;
}

function requiredSecret() {
  const value = configuredSecret();
  if (!value) throw new Error('OPSVISTA_SESSION_SECRET must be configured with at least 32 characters');
  return value;
}

function b64url(input: string | Buffer) { return Buffer.from(input).toString('base64url'); }
function sign(body: string, key = requiredSecret()) { return createHmac('sha256', key).update(body).digest('base64url'); }

function parseCookies(raw?: string) {
  const result: Record<string, string> = {};
  for (const pair of (raw || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function authUsers(): AuthUserRecord[] {
  const raw = process.env.OPSVISTA_AUTH_USERS_JSON;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as AuthUserRecord[];
  return parsed.filter(user => user.active !== false);
}

function effectiveManagedLocations(user: Awaited<ReturnType<typeof getManagedUser>>) {
  if (!user) return [];
  const grants = user.locationGrants?.length
    ? user.locationGrants
    : user.locations.map((location,index)=>({ location, type:index===0?'Primary' as const:'Additional' as const }));
  const now = Date.now();
  return Array.from(new Set(grants.filter(grant=>!grant.expiresAt || new Date(grant.expiresAt).getTime()>now).map(grant=>grant.location)));
}

async function sessionFromManaged(record:{userId:string;email:string}, managed:NonNullable<Awaited<ReturnType<typeof getManagedUser>>>):Promise<SessionUser> {
  const membership = managed.role==='Founder' ? null : await getOrganizationMembership(managed.id);
  return {
    id:managed.id,
    email:managed.email || record.email,
    name:managed.name,
    role:managed.role,
    title:managed.title,
    locations:effectiveManagedLocations(managed),
    ...(membership ?? {}),
  };
}

export async function sessionForSupabaseIdentity(email: string): Promise<SessionUser | null> {
  const managed = await getManagedUserByEmail(email);
  if (!managed || !managed.active || !managed.email) return null;
  return sessionFromManaged({ userId: managed.id, email: managed.email }, managed);
}

export async function authenticateUser(email: string, password: string): Promise<SessionUser | null> {
  const normalizedEmail = email.trim().toLowerCase();

  if (process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL) {
    const stored = await authenticateStoredCredential(normalizedEmail,password);
    if (stored) {
      const managed = await getManagedUser(stored.userId);
      if (!managed || !managed.active) return null;
      return sessionFromManaged(stored,managed);
    }
  }

  const record = authUsers().find(user => user.email.toLowerCase() === normalizedEmail);
  if (!record) return null;
  const candidate = scryptSync(password, record.passwordSalt, 64);
  const expected = Buffer.from(record.passwordHash, 'hex');
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null;

  let managed = null;
  if (process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL) {
    managed = await getManagedUser(record.id);
    if (managed && !managed.active) return null;
  }

  return managed ? sessionFromManaged({userId:record.id,email:record.email},managed) : {
    id:record.id, email:record.email, name:record.name, role:record.role, title:record.title, locations:[...record.locations],
    organizationId:record.organizationId, organizationName:record.organizationName, organizationSlug:record.organizationSlug, clientNumber:record.clientNumber,
  };
}

export function issueSession(user: SessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...user, iat: now, exp: now + SESSION_TTL_SECONDS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function readSession(cookieHeader?: string, authorizationHeader?: string): SessionUser | null {
  const bearer = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || parseCookies(cookieHeader)[COOKIE_NAME];
  if (!token) return null;
  const key = configuredSecret();
  if (!key) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    const { exp: _exp, iat: _iat, ...user } = payload;
    return user;
  } catch { return null; }
}

export function sessionCookie(token: string) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}
export function clearSessionCookie() { return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
export function isRole(user: SessionUser | null, roles: ServerRole[]) { return !!user && roles.includes(user.role); }
export function canAccessServerLocation(user: SessionUser, location?: string) {
  if (!location) return true;
  if (['Founder','Corporate','HR','Administration','Maintenance'].includes(user.role)) return true;
  return user.locations.includes(location);
}
