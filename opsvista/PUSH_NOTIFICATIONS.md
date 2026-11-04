# OpsVista web push

The authenticated app header opens **Notifications / Notificaciones**. Each browser/device opts in through a direct permission gesture and can send a test or unsubscribe. iPhone/iPad require iOS 16.4+ and launching the app from the Home Screen. Use `https://restaurant-support.vercel.app` for the current operational app.

The push service is connected to existing `dispatchActionPush` and `dispatchOperationalPush` events. This change does not add scheduled scans or daily reports: existing event generation determines when alerts are created. A notification opens the assigned action after the normal login flow. Lock-screen messages contain no employee, sales or payroll details.

## Runtime setup

The existing `OPSVISTA_DATABASE_URL` (or `OPSVISTA_DATABASE_DATABASE_URL`) and `OPSVISTA_SESSION_SECRET` are sufficient. The server creates `opsvista_web_push_keys` and `opsvista_web_push_subscriptions` on first authenticated use. The VAPID key pair is generated once with conflict-safe initialization, shared across function instances, and its private key is encrypted with AES-256-GCM using a domain-separated key derived from the existing session secret. No signing key is included in browser code. Back up the key record with the database. If rotating the session secret, re-encrypt this record with the new secret before deployment (the same migration consideration applies to existing encrypted integration credentials). Do not delete or regenerate the VAPID key casually: subscriptions are bound to it.

Subscriptions are scoped to the authenticated account and organization. Sends recheck active accounts and push preferences. Only known HTTPS browser push services are accepted, and browser writes require same-origin JSON. Failed/expired delivery is not reported as delivered; HTTP 404/410 subscriptions are removed. Tests target only the current user's current device and are limited to one per 30 seconds. Signing out revokes that device's browser subscription. No authenticated pages or API responses are cached by the service worker.

## Verification

- `npm run typecheck`
- `npm run typecheck:vercel`
- `npm run test:web-push` (isolated PGlite database and mocked transport, never production messages)
- `npm run build`
- In production: sign in, open Notifications, enable, allow permission, then **Send me a test**. Provider acceptance is distinct from confirmation on the actual phone.
