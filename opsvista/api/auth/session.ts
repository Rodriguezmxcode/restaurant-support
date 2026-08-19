import { readSession } from '../../server/authSession';

type ApiRequest = { method?: string; headers?: { cookie?: string } };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader?.('Cache-Control', 'no-store');
  try {
    const user = readSession(req.headers?.cookie);
    if (!user) return res.status(401).json({ authenticated: false });
    return res.status(200).json({ authenticated: true, user });
  } catch (error) {
    console.error('[OpsVista Auth Session]', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Authentication is not configured' });
  }
}
