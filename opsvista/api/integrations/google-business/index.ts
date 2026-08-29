import { readSession } from '../../../server/authSession.js';
import { authorize } from '../../../server/authorization.js';
import { authorizationUrl, createOAuthState, googleBusinessRedirectUri } from '../../../server/googleBusinessOAuth.js';
import { disconnectGoogleBusiness, getGoogleBusinessCredentials, saveGoogleBusinessClient } from '../../../server/integrationStore.js';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined> & { cookie?: string };
  query?: Record<string, string | string[]>;
  body?: { action?: string; clientId?: string; clientSecret?: string };
};
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void; end: () => void };

const organizationId = (user: NonNullable<ReturnType<typeof readSession>>) => user.organizationId || 'org-puerto-vallarta';
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const user = readSession(req.headers.cookie);
  const permission = authorize(user, 'integrations:manage');
  if (!permission.ok) return res.status(permission.status).json({ error: permission.error });
  const org = organizationId(permission.user);

  try {
    if (!req.method || req.method === 'GET') {
      const saved = await getGoogleBusinessCredentials(org);
      const redirectUri = googleBusinessRedirectUri(req.headers);
      const action = text(req.query?.action);
      if (action === 'authorize') {
        if (!saved?.clientId || !saved.clientSecret) return res.status(400).json({ error: 'Save the Google OAuth client before connecting' });
        res.setHeader('Location', authorizationUrl(saved, redirectUri, createOAuthState(org, permission.user.id)));
        res.status(302).end();
        return;
      }
      return res.status(200).json({
        provider: 'google-business-profile',
        configured: Boolean(saved?.clientId && saved.clientSecret),
        connected: Boolean(saved?.refreshToken),
        clientId: saved?.clientId || '',
        connectedEmail: saved?.connectedEmail,
        connectedAt: saved?.connectedAt,
        redirectUri,
      });
    }

    if (req.method === 'POST') {
      const action = text(req.body?.action);
      if (action === 'save') {
        const clientId = text(req.body?.clientId);
        const clientSecret = text(req.body?.clientSecret);
        if (!clientId.endsWith('.apps.googleusercontent.com') || !clientSecret.startsWith('GOCSPX-')) return res.status(400).json({ error: 'A valid Google OAuth Client ID and Client Secret are required' });
        await saveGoogleBusinessClient(org, clientId, clientSecret);
        return res.status(200).json({ saved: true });
      }
      if (action === 'disconnect') {
        await disconnectGoogleBusiness(org);
        return res.status(200).json({ disconnected: true });
      }
      return res.status(400).json({ error: 'Unknown integration action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Google Business integration unavailable' });
  }
}
