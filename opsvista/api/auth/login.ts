import { authenticateUser, issueSession, sessionCookie } from '../../server/authSession';

type ApiRequest = { method?: string; body?: { email?: string; password?: string } };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const email = req.body?.email?.trim() || '';
  const password = req.body?.password || '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const user = authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    res.setHeader?.('Set-Cookie', sessionCookie(issueSession(user)));
    res.setHeader?.('Cache-Control', 'no-store');
    return res.status(200).json({ user });
  } catch (error) {
    console.error('[OpsVista Auth Login]', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Authentication is not configured' });
  }
}
