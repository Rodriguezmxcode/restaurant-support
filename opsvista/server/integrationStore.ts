import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

export type GoogleBusinessCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  connectedEmail?: string;
  connectedAt?: string;
};

export type Restaurant365Credentials = {
  domain: string;
  username: string;
  password: string;
  savedAt?: string;
};

let client: ReturnType<typeof postgres> | undefined;
let initialized = false;

function databaseUrl() {
  return process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL || '';
}

function sql() {
  const url = databaseUrl();
  if (!url) throw new Error('OpsVista database URL is not configured');
  if (!client) client = postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10 });
  return client;
}

function encryptionKey() {
  const secret = process.env.OPSVISTA_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('OPSVISTA_SESSION_SECRET must be configured before integrations can be saved');
  return createHash('sha256').update(secret).digest();
}

function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function open(value?: string | null) {
  if (!value) return undefined;
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Stored integration credential is invalid');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}

async function ensureSchema() {
  if (initialized) return;
  await sql()`
    create table if not exists opsvista_integration_credentials (
      organization_id text not null,
      provider text not null,
      client_id text not null,
      client_secret_encrypted text not null,
      refresh_token_encrypted text,
      connected_email text,
      connected_at timestamptz,
      updated_at timestamptz not null default now(),
      primary key (organization_id, provider)
    )
  `;
  initialized = true;
}

export async function getGoogleBusinessCredentials(organizationId: string): Promise<GoogleBusinessCredentials | null> {
  await ensureSchema();
  const rows = await sql()`
    select client_id,client_secret_encrypted,refresh_token_encrypted,connected_email,connected_at
    from opsvista_integration_credentials
    where organization_id=${organizationId} and provider='google-business-profile'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    clientId: String(row.client_id),
    clientSecret: open(String(row.client_secret_encrypted)) || '',
    refreshToken: open(row.refresh_token_encrypted ? String(row.refresh_token_encrypted) : undefined),
    connectedEmail: row.connected_email ? String(row.connected_email) : undefined,
    connectedAt: row.connected_at ? new Date(row.connected_at as string | number | Date).toISOString() : undefined,
  };
}

export async function saveGoogleBusinessClient(organizationId: string, clientId: string, clientSecret: string) {
  await ensureSchema();
  await sql()`
    insert into opsvista_integration_credentials (organization_id,provider,client_id,client_secret_encrypted,updated_at)
    values (${organizationId},'google-business-profile',${clientId},${seal(clientSecret)},now())
    on conflict (organization_id,provider) do update set
      client_id=excluded.client_id,
      client_secret_encrypted=excluded.client_secret_encrypted,
      refresh_token_encrypted=null,
      connected_email=null,
      connected_at=null,
      updated_at=now()
  `;
}

export async function saveGoogleBusinessAuthorization(organizationId: string, refreshToken: string, connectedEmail?: string) {
  await ensureSchema();
  const rows = await sql()`
    update opsvista_integration_credentials
    set refresh_token_encrypted=${seal(refreshToken)},connected_email=${connectedEmail || null},connected_at=now(),updated_at=now()
    where organization_id=${organizationId} and provider='google-business-profile'
    returning organization_id
  `;
  if (!rows.length) throw new Error('Google Business OAuth client must be saved before authorization');
}

export async function disconnectGoogleBusiness(organizationId: string) {
  await ensureSchema();
  await sql()`
    update opsvista_integration_credentials
    set refresh_token_encrypted=null,connected_email=null,connected_at=null,updated_at=now()
    where organization_id=${organizationId} and provider='google-business-profile'
  `;
}

export async function getRestaurant365Credentials(organizationId: string): Promise<Restaurant365Credentials | null> {
  if (!databaseUrl()) return null;
  await ensureSchema();
  const rows = await sql()`
    select client_id,client_secret_encrypted,connected_email,updated_at
    from opsvista_integration_credentials
    where organization_id=${organizationId} and provider='restaurant365-odata'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    domain: String(row.client_id),
    username: String(row.connected_email || ''),
    password: open(String(row.client_secret_encrypted)) || '',
    savedAt: row.updated_at ? new Date(row.updated_at as string | number | Date).toISOString() : undefined,
  };
}

export async function saveRestaurant365Credentials(organizationId: string, domain: string, username: string, password: string) {
  await ensureSchema();
  await sql()`
    insert into opsvista_integration_credentials
      (organization_id,provider,client_id,client_secret_encrypted,connected_email,connected_at,updated_at)
    values
      (${organizationId},'restaurant365-odata',${domain},${seal(password)},${username},now(),now())
    on conflict (organization_id,provider) do update set
      client_id=excluded.client_id,
      client_secret_encrypted=excluded.client_secret_encrypted,
      connected_email=excluded.connected_email,
      connected_at=now(),
      updated_at=now()
  `;
}

export async function disconnectRestaurant365(organizationId: string) {
  if (!databaseUrl()) return;
  await ensureSchema();
  await sql()`
    delete from opsvista_integration_credentials
    where organization_id=${organizationId} and provider='restaurant365-odata'
  `;
}
