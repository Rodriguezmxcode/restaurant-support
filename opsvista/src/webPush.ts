export const pushApi = '/api/workflows?resource=web_push';
export function supportsWebPush() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function needsHomeScreen() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & { standalone?: boolean }).standalone;
}
export async function pushRequest(body?: Record<string, unknown>) {
  const response = await fetch(pushApi, { credentials: 'include', cache: 'no-store', ...(body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {}), signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? 'session_expired' : result.code === 'account_access' ? 'account_access' : 'push_request_failed');
  return result;
}
export async function pushRegistration() {
  await navigator.serviceWorker.register('/opsvista-sw.js', { scope: '/', updateViaCache: 'none' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('push_worker_timeout')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
export function applicationServerKey(value: string) {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
export async function detachPushOnLogout() {
  if (!supportsWebPush()) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  // Keep the separately enrolled security factor available after sign-out.
  // If the server is unavailable, do not destroy a potentially required factor.
  const result = await pushRequest({ action: 'unsubscribe', endpoint: subscription.endpoint });
  if (!result.retainSubscription) await subscription.unsubscribe();
}
