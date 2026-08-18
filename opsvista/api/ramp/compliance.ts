import { getRampCompliancePayload } from '../../server/rampComplianceEndpoint';

type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
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
