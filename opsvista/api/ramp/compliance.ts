import { getRampCompliancePayload } from '../../server/rampComplianceEndpoint';
import { isRole, readSession } from '../../server/authSession';

type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: { cookie?: string };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let user;
  try {
    user = readSession(req.headers?.cookie);
  } catch (error) {
    console.error('[OpsVista Ramp Auth]', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Authentication is not configured' });
  }
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!isRole(user, ['Corporate', 'Administration'])) return res.status(403).json({ error: 'Not authorized for Ramp portfolio data' });

  try {
    const payload = await getRampCompliancePayload({
      fromDate: one(req.query?.fromDate),
      toDate: one(req.query?.toDate),
    });

    res.setHeader?.('Cache-Control', 'private, max-age=0, must-revalidate');
    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load Ramp compliance data';
    console.error('[OpsVista Ramp Compliance]', message);
    return res.status(502).json({
      error: 'Ramp data unavailable',
      detail: process.env.NODE_ENV === 'development' ? message : undefined,
    });
  }
}
