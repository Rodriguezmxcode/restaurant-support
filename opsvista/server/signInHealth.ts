import postgres from 'postgres';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../shared/supabaseConfig.js';

type Health = { ok: boolean; checkedAt: string };
let client: ReturnType<typeof postgres> | undefined;
let cached: { until: number; result: Promise<Health> } | undefined;

function recordFailure(stage: string, error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const allowed = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', '53300', '57P01', '23505', '42501', '42P01', '42703', '53100', '28P01', '28000', 'XX000', '08001', '08006'];
  const message = error instanceof Error ? error.message : '';
  // Interpret provider failures locally; never log their raw text or parameters.
  const category = /quota|compute.?time|limit.*exceed/i.test(message) ? 'quota_exceeded'
    : /endpoint.*disabled|suspend/i.test(message) ? 'database_suspended'
    : /storage.*full|disk.*full|size limit/i.test(message) ? 'storage_full'
    : /password authentication|authentication failed/i.test(message) ? 'database_credentials'
    : /too many|connection slots/i.test(message) ? 'connection_capacity'
    : /permission denied/i.test(message) ? 'database_permissions'
    : /certificate|TLS|SSL/i.test(message) ? 'database_tls'
    : /Database unavailable/i.test(message) ? 'database_not_configured' : 'dependency_failure';
  console.error('OpsVista sign-in health failed', { stage, reason: typeof code === 'string' && allowed.includes(code) ? code : 'dependency_failure', category });
}

// Public readiness reports no accounts, credentials, schema, or business data.
// Checks only read existing resources; concurrent probes share a bounded check.
export async function signInHealth(): Promise<Health> {
  if (cached && cached.until > Date.now()) return cached.result;
  const result = (async () => {
    const checks = await Promise.all([
      (async () => {
        try {
          const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw new Error('Identity unavailable');
          return true;
        } catch (error) { recordFailure('identity', error); return false; }
      })(),
      (async () => {
        try {
          const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
          if (!url) throw new Error('Database unavailable');
          client ||= postgres(url, { max: 1, idle_timeout: 10, connect_timeout: 5, connection: { statement_timeout: 5000 } });
          // LIMIT 0 validates the exact access dependencies without loading users.
          await client`select u.id,u.name,u.email,u.role,u.title,u.active,u.locations,u.location_grants,u.organization_id,
            m.user_id,m.organization_id,o.id,o.name,o.slug,o.status,o.client_number,o.locations
            from opsvista_management_users u
            left join opsvista_organization_memberships m on m.user_id=u.id
            left join opsvista_organizations o on o.id=m.organization_id limit 0`;
          await client`select organization_id,user_id,id,endpoint from opsvista_push_mfa_devices limit 0`;
          return true;
        } catch (error) { recordFailure('directory', error); return false; }
      })(),
    ]);
    const signing = (process.env.OPSVISTA_SESSION_SECRET?.length || 0) >= 32;
    if (!signing) recordFailure('session_configuration', null);
    return { ok: signing && checks.every(Boolean), checkedAt: new Date().toISOString() };
  })();
  cached = { until: Date.now() + 30000, result };
  return result;
}
