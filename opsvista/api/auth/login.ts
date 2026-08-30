import { authenticateUser, issueSession, sessionCookie } from '../../server/authSession.js';
import { bootstrapFounderCredential, claimFounderOnFirstLogin } from '../../server/accountStore.js';

type ApiRequest = { method?: string; body?: { email?: string; password?: string; mode?: string; bootstrapSecret?: string } };
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
    if (req.body?.mode === 'founder-recovery') {
      const bootstrapSecret = req.body?.bootstrapSecret || '';
      if (!bootstrapSecret) return res.status(400).json({ error: 'Founder recovery code is required' });
      await bootstrapFounderCredential(email, password, bootstrapSecret);
    }

    let user = await authenticateUser(email, password);
    if (!user && email.toLowerCase() === 'rodriguez.evolife@gmail.com' && req.body?.mode !== 'founder-recovery') {
      const claimed = await claimFounderOnFirstLogin(email, password);
      if (claimed) user = await authenticateUser(email, password);
    }
    if (!user) return res.status(401).json({ error: 'Invalid credentials or inactive account' });
    const token = issueSession(user);
    res.setHeader?.('Set-Cookie', sessionCookie(token));
    res.setHeader?.('Cache-Control', 'no-store');
    return res.status(200).json({ user, token });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication service unavailable';
    console.error('[OpsVista Auth Login]', message);
    return res.status(/invalid|match|required/i.test(message) ? 403 : 503).json({ error: message });
  }
}
