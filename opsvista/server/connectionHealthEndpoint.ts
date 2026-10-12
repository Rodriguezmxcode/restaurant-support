import type { SessionUser } from './authSession.js';
import { getManagedUser } from './managementStore.js';
import { getOrganizationMembership } from './organizationStore.js';
import { preferenceContext, PreferenceError } from './notificationPreferencesStore.js';
import { isSameOriginPushRequest } from './webPushDelivery.js';
import { alertOrganizationContext, connectionHealth, saveAlertPolicy } from './organizationAlerts.js';

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };
export async function connectionHealthEndpoint(req: Request, res: Response, user: SessionUser) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  try {
    const account = await getManagedUser(user.id);
    if (!account?.active || account.role !== user.role) throw new PreferenceError('Active account required', 403);
    const organizationId = user.organizationId || 'org-puerto-vallarta';
    if (account.role === 'Founder') {
      if (organizationId !== 'org-puerto-vallarta') throw new PreferenceError('Invalid organization', 403);
    } else if ((await getOrganizationMembership(user.id))?.organizationId !== organizationId) throw new PreferenceError('Active membership required', 403);
    const { allowedLocations } = await preferenceContext(user);
    const org = await alertOrganizationContext(organizationId);
    const canManage = ['Founder', 'Corporate'].includes(account.role);
    if (req.method === 'PUT') {
      if (!canManage || !isSameOriginPushRequest(req.headers)) throw new PreferenceError('Administrator and same-origin request required', 403);
      if (!req.body || Array.isArray(req.body)) throw new PreferenceError('Invalid settings');
      org.policy = await saveAlertPolicy(organizationId, user.id, req.body);
    } else if (req.method && req.method !== 'GET') {
      res.setHeader?.('Allow', 'GET, PUT'); return res.status(405).json({ error: 'Method not allowed' });
    }
    return res.status(200).json(await connectionHealth(org, allowedLocations, canManage));
  } catch (error) {
    return res.status(error instanceof PreferenceError ? error.status : 503).json({ error: error instanceof PreferenceError ? error.message : 'Connection status unavailable' });
  }
}
