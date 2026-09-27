import { ECDH } from 'node:crypto';
import webpush from 'web-push';

export type WebSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushKeys = { publicKey: string; privateKey: string };

// Only browser push services may receive server requests. Never fetch arbitrary
// subscriber URLs (including redirects, private addresses or custom ports).
export function validateWebSubscription(value: unknown): WebSubscription {
  const input = value as Partial<WebSubscription> | null;
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 4096) throw new Error('Invalid push subscription');
  const url = new URL(input.endpoint);
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host === 'web.push.apple.com' || host.endsWith('.push.apple.com')
    || host.endsWith('.notify.windows.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new Error('Unsupported push service');
  const { p256dh, auth } = input.keys || {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !/^[\w-]{87}=?$/.test(p256dh) || !/^[\w-]{22}(==)?$/.test(auth)) throw new Error('Invalid push keys');
  const publicKey = Buffer.from(p256dh, 'base64url');
  if (publicKey.length !== 65 || publicKey[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) throw new Error('Invalid push keys');
  ECDH.convertKey(publicKey, 'prime256v1');
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export function pushPayload(input: { actionId?: string; category?: string; tag?: string; test?: boolean; title?: string; body?: string; priority?: 'high' | 'normal' | 'low' }, locale = 'en') {
  const es = locale === 'es';
  // Operational previews are explicitly requested by the workspace owner.
  const clean = (value: string | undefined, max: number) => (value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const label = input.priority === 'high' ? (es ? 'Alta prioridad' : 'High priority') : input.priority === 'low' ? (es ? 'Actualización' : 'Update') : (es ? 'Atención' : 'Attention');
  return {
    title: input.test ? 'OpsVista · Test' : clean(input.title, 110) ? `OpsVista · ${label} · ${clean(input.title, 110)}` : 'OpsVista',
    body: input.test
      ? es ? 'Notificaciones activadas. Esta es tu prueba de OpsVista.' : 'Notifications enabled. This is your OpsVista test.'
      : clean(input.body, 280) || (es ? 'Tienes una actualización operativa. Abre OpsVista para revisarla.' : 'You have an operational update. Open OpsVista to review it.'),
    urgency: input.priority === 'high' ? 'high' as const : 'normal' as const,
    tag: input.tag || 'opsvista-update',
    url: input.actionId ? `/?action=${encodeURIComponent(input.actionId)}` : '/?notifications=1',
  };
}

export async function deliverWebPush(subscription: WebSubscription, keys: PushKeys, payload: ReturnType<typeof pushPayload> & { ttlSeconds?: number; kind?: 'login' }, send = webpush.sendNotification) {
  try {
    const result = await send(validateWebSubscription(subscription), JSON.stringify(payload), {
      vapidDetails: { subject: 'https://getopsvista.com', ...keys }, TTL: payload.ttlSeconds ?? 3600, urgency: payload.urgency, timeout: 10000,
    });
    return { accepted: result.statusCode >= 200 && result.statusCode < 300, expired: false };
  } catch (error) {
    const status = Number((error as { statusCode?: number })?.statusCode);
    return { accepted: false, expired: status === 404 || status === 410 };
  }
}

export function isSameOriginPushRequest(headers: Record<string, string | string[] | undefined> = {}) {
  const origin = headers.origin, host = headers.host, contentType = headers['content-type'];
  if (typeof origin !== 'string' || typeof host !== 'string' || typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) return false;
  try {
    const url = new URL(origin);
    return url.host === host && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  } catch { return false; }
}
