import { createHmac, timingSafeEqual } from 'node:crypto';

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: 'Founder' | 'Corporate' | 'Location Manager' | 'Kitchen' | 'HR' | 'Administration' | 'Maintenance';
  title: string;
  locations: string[];
};

type SessionPayload = SessionUser & { exp: number; iat: number };
type ApiRequest = { method?: string; headers?: { cookie?: string } };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };

const COOKIE_NAME = 'opsvista_session';

function parseCookies(raw?: string) {
  const result: Record<string,string> = {};
  for (const pair of (raw || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0,index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function readSession(cookieHeader?: string): SessionUser | null {
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!token) return null;

  const secret = process.env.OPSVISTA_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;

  const [body,signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = Buffer.from(createHmac('sha256',secret).update(body).digest('base64url'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected,actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body,'base64url').toString('utf8')) as SessionPayload;
    if (!payload.exp || payload.exp <= Math.floor(Date.now()/1000)) return null;
    const { exp: _exp, iat: _iat, ...user } = payload;
    return user;
  } catch {
    return null;
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== 'GET') {
    res.setHeader?.('Allow','GET');
    return res.status(405).json({ error:'Method not allowed' });
  }
  res.setHeader?.('Cache-Control','no-store');
  const user = readSession(req.headers?.cookie);
  if (!user) return res.status(401).json({ authenticated:false });
  return res.status(200).json({ authenticated:true,user });
}
