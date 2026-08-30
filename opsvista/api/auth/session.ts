import { issueSession, readSession, sessionCookie, sessionForSupabaseIdentity } from '../../server/authSession.js';
import { verifySupabaseIdentity } from '../../server/supabaseAuth.js';

type ApiRequest = {
  method?: string;
  headers?: { cookie?: string; authorization?: string };
  body?: { accessToken?: string };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader?.('Cache-Control', 'no-store');

  if (!req.method || req.method === 'GET') {
    const user = readSession(req.headers?.cookie, req.headers?.authorization);
    if (!user) return res.status(401).json({ authenticated: false });
    return res.status(200).json({ authenticated: true, user });
  }

  if (req.method === 'POST') {
    try {
      const identity = await verifySupabaseIdentity(req.body?.accessToken || '');
      if (!identity) return res.status(401).json({ error: 'Supabase session is invalid or requires two-step verification' });
      const user = await sessionForSupabaseIdentity(identity.email);
      if (!user) return res.status(403).json({ error: 'This account is not authorized in OpsVista' });
      const token = issueSession(user);
      res.setHeader?.('Set-Cookie', sessionCookie(token));
      return res.status(200).json({ authenticated: true, user, token });
    } catch (error) {
      console.error('[OpsVista Supabase Session]', error instanceof Error ? error.message : error);
      return res.status(503).json({ error: 'Unable to validate the secure session' });
    }
  }

  res.setHeader?.('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
