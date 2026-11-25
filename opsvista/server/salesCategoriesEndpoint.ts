import type { SessionUser } from './authSession.js';
import { hasLegacyWorkspace } from '../shared/tenantAccess.js';
import { getToastCategorySales } from './toastCategorySales.js';

type Req = { query?: Record<string, string | string[]> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };
const text = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value || '';
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const locations = ['Stamford', 'Fairfield', 'Orange', 'Avon', 'Southington', 'Danbury', 'Middletown', 'Newington'];

export async function salesCategoriesEndpoint(req: Req, res: Res, user: SessionUser, load = getToastCategorySales) {
  if (!hasLegacyWorkspace(user) || !['Founder', 'Corporate', 'Location Manager'].includes(user.role)) return res.status(403).json({ error: 'Sales access required' });
  const start = text(req.query?.start), end = text(req.query?.end), location = text(req.query?.location);
  if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 >= 7) return res.status(400).json({ error: 'Select a valid range of up to seven days per request' });
  if (!locations.includes(location)) return res.status(400).json({ error: 'Select a valid location' });
  if (user.role === 'Location Manager' && !user.locations.includes(location)) return res.status(403).json({ error: 'Location not authorized' });
  try { return res.status(200).json(await load(location, start, end)); }
  catch { return res.status(502).json({ error: 'Toast category sales could not be loaded', code: 'toast_unavailable' }); }
}
