import { clearSessionCookie } from '../../server/authSession.js';

type ApiRequest = { method?: string };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader?.('Set-Cookie', clearSessionCookie());
  res.setHeader?.('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
