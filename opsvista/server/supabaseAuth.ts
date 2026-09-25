import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../shared/supabaseConfig.js';

type SupabaseIdentity = {
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

export async function verifySupabaseIdentity(accessToken: string) {
  if (!accessToken || assuranceLevel(accessToken) !== 'aal2') return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  const identity = await response.json() as SupabaseIdentity;
  const email = identity.email?.trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    displayName: identity.user_metadata?.full_name || identity.user_metadata?.name || email,
  };
}
