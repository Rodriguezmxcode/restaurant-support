import type { SessionUser } from './authSession.js';
import { getManagedUser } from './managementStore.js';
import { getOrganizationMembership } from './organizationStore.js';
import { getNotificationPreferences, updateNotificationPreferences } from './actionNotificationStore.js';
import { isSameOriginPushRequest, validateWebSubscription } from './webPushDelivery.js';
import { registerWebPush, removeWebPush, testWebPush, webPushPublicKey, webPushRegistered } from './webPushStore.js';

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };
export async function webPushEndpoint(req: Request, res: Response, user: SessionUser) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  const [account, membership] = await Promise.all([getManagedUser(user.id), getOrganizationMembership(user.id)]);
  if (!account?.active || membership?.organizationId !== (user.organizationId || 'org-puerto-vallarta')) return res.status(403).json({ error: 'Active account required' });
  try {
    if (!req.method || req.method === 'GET') {
      const preferences = await getNotificationPreferences(user);
      return res.status(200).json({ publicKey: await webPushPublicKey(), pushEnabled: preferences.pushEnabled });
    }
    if (req.method !== 'POST') { res.setHeader?.('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    if (!isSameOriginPushRequest(req.headers)) return res.status(403).json({ error: 'Same-origin JSON request required' });
    const action = req.body?.action;
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (action === 'subscribe') {
      let subscription;
      try { subscription = validateWebSubscription(req.body?.subscription); } catch { return res.status(400).json({ error: 'Invalid push subscription' }); }
      const preferences = await getNotificationPreferences(user);
      await registerWebPush(subscription, req.body?.locale === 'es' ? 'es' : 'en', user);
      if (!preferences.pushEnabled) await updateNotificationPreferences({ ...preferences, pushEnabled: true }, user);
      return res.status(200).json({ registered: true, pushEnabled: true });
    }
    if (!endpoint || endpoint.length > 4096) return res.status(400).json({ error: 'Device endpoint required' });
    if (action === 'status') return res.status(200).json({ registered: await webPushRegistered(endpoint, user) });
    if (action === 'unsubscribe') { await removeWebPush(endpoint, user); return res.status(200).json({ registered: false }); }
    if (action === 'test') {
      if (!(await getNotificationPreferences(user)).pushEnabled) return res.status(200).json({ accepted: false, reason: 'push_disabled' });
      return res.status(200).json(await testWebPush(endpoint, user));
    }
    return res.status(400).json({ error: 'Unknown push action' });
  } catch { return res.status(503).json({ error: 'Push notifications are temporarily unavailable' }); }
}
