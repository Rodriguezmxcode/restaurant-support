import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../shared/supabaseConfig.js';

type SupabaseIdentity = {
  id?: string;
  factors?: { status?: string }[];
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
};

function assuranceLevel(token: string) {
  try {
    const body = token.split('.')[1];
    if (!body) return '';
    return String((JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { aal?: string }).aal ?? '');
  } catch {
    return '';
  }
}

export async function verifySupabaseIdentity(accessToken: string, requiredLevel: 'aal1' | 'aal2' = 'aal2') {
  if (!accessToken || (requiredLevel === 'aal2' && assuranceLevel(accessToken) !== 'aal2')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  const identity = await response.json() as SupabaseIdentity;
  // Claims are used only after the identity service has validated the token.
  let claims: { sub?: string; session_id?: string; aal?: string; amr?: { method: string; timestamp: number }[] };
  try { claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!identity.id || claims.sub !== identity.id || !claims.session_id) return null;
  const email = identity.email?.trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    subject: identity.id,
    sessionId: claims.session_id,
    aal: claims.aal,
    passwordVerified: claims.amr?.some(method => method.method === 'password') === true,
    hasVerifiedMfa: identity.factors?.some(factor => factor.status === 'verified') === true,
    displayName: identity.user_metadata?.full_name || identity.user_metadata?.name || email,
  };
}
