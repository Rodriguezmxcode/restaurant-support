// The retired native prototype used a password-only login. It must not remain
// an alternate route around the mandatory server-enforced second factor.
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };
export default async function handler(req: { method?: string }, res: Response) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader?.('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  return res.status(410).json({ error: 'Use the secure OpsVista sign-in page to complete two-step verification.', code: 'secure_login_required' });
}
