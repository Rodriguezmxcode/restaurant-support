import type { SessionUser } from './authSession.js';
import { getManagedUser } from './managementStore.js';
import { getOrganizationMembership } from './organizationStore.js';
import { preferenceContext, PreferenceError, updateNotificationPreferences } from './notificationPreferencesStore.js';
import { isSameOriginPushRequest } from './webPushDelivery.js';
import type { NotificationPreferences } from '../shared/notificationPreferences.js';

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };
export async function notificationPreferencesEndpoint(req: Request, res: Response, user: SessionUser) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  try {
    const account = await getManagedUser(user.id);
    if (!account?.active || account.role !== user.role) throw new PreferenceError('Active account required', 403);
    // Load current membership rather than trusting a stale session location list.
    const membership = account.role === 'Founder' ? null : await getOrganizationMembership(user.id);
    if (account.role === 'Founder' ? Boolean(user.organizationId && user.organizationId !== 'org-puerto-vallarta') : membership?.organizationId !== user.organizationId) throw new PreferenceError('Active membership required', 403);
    const context = await preferenceContext(user);
    if (!req.method || req.method === 'GET') return res.status(200).json({ ...context.preferences, allowedLocations: context.allowedLocations });
    if (req.method !== 'PUT') { res.setHeader?.('Allow', 'GET, PUT'); return res.status(405).json({ error: 'Method not allowed' }); }
    if (!isSameOriginPushRequest(req.headers)) throw new PreferenceError('Same-origin JSON request required', 403);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PreferenceError('Invalid preferences');
    const fields = ['emailEnabled', 'pushEnabled', 'smsEnabled', 'phone', 'categories', 'locations', 'timeZone', 'locale', 'revision'];
    if (Object.keys(body).some(key => !fields.includes(key))) throw new PreferenceError('Unknown preference');
    // The new center always sends a revision; legacy channel-only clients use
    // field patches and cannot overwrite categories or restaurant selections.
    if (['categories', 'locations', 'timeZone', 'locale'].some(key => Object.hasOwn(body, key)) && !Number.isInteger(body.revision)) throw new PreferenceError('Revision required');
    const saved = await updateNotificationPreferences(body as Partial<NotificationPreferences>, user, context.allowedLocations);
    return res.status(200).json({ ...saved, allowedLocations: context.allowedLocations });
  } catch (error) {
    return res.status(error instanceof PreferenceError ? error.status : 503).json({ error: error instanceof PreferenceError ? error.message : 'Notification preferences unavailable' });
  }
}
