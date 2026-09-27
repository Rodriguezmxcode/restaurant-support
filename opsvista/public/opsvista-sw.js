/* Push only: do not cache authenticated pages, API responses or financial data. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(typeof payload.title === 'string' && payload.title.trim() ? payload.title.slice(0, 160) : 'OpsVista', {
    body: typeof payload.body === 'string' ? payload.body : 'Open OpsVista to review your operational updates.',
    icon: '/icons/opsvista-192.png', badge: '/icons/opsvista-192.png',
    tag: typeof payload.tag === 'string' ? payload.tag : 'opsvista-update',
    data: { url: payload.url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let url = new URL('/', self.location.origin);
  try {
    const candidate = new URL(event.notification.data?.url || '/', self.location.origin);
    if (candidate.origin === self.location.origin && candidate.pathname === '/') url = candidate;
  } catch { /* Fall back to the app. */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url.href); await existing.focus(); }
    else await self.clients.openWindow(url.href);
  })());
});
