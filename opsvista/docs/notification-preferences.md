# Notification preferences

The Notifications button opens account-wide push preferences and the existing per-device setup/test controls. Settings includes a shortcut, and new-client workspaces have their own Notifications tab. UI strings are English/Spanish.

## Delivery rules

- Ten categories: critical, sales, labor, tasks/compliance, purchasing, reviews, finance, reports, system and product updates. Existing operational categories default to instant; product announcements default off.
- The master switch pauses operational push across all registered devices. Separately enrolled sign-in verification devices and Founder Authenticator remain independent. Browser/OS permissions still apply.
- Critical operational events use instant delivery while master push is on. High-priority labor, reviews and prices retain their actual category, so severity cannot silently bypass opt-outs.
- An explicit location selection is intersected with current account access and organization membership at delivery time. Expired grants cannot receive location data. Unlocated aggregate operational reports are suppressed for scoped accounts or explicit location subsets.
- Category and location controls apply to web push, native Expo operational notifications, and Action Center assignments/observers. Email preferences remain independent.
- Registering another device never silently re-enables the master switch.

## Persistence and summaries

Existing `opsvista_notification_preferences` records are extended with category modes, selected locations, time zone, locale and a revision. Changes and before/after audit records commit in one database transaction. A stale revision returns 409. The endpoint validates current membership, account status, role, same-origin JSON and locations.

Daily summaries become due at 09:00 the following local day. Reports can use a Monday summary. Durable queue keys include organization/user/event. The existing authenticated `reviews` scheduler heartbeat drains due queues about every 30 minutes, including quiet hours and when its review source is unavailable. Actual scheduling depends on GitHub Actions availability; no exact-minute delivery guarantee is made. No new workflow or credentials are required.

Queued items keep their original due time. Before delivery, the worker rechecks current preferences and access. Claims use database leases; provider errors retry up to five claims. Disabled/revoked items are suppressed. Provider acceptance is recorded, not device receipt. Web and native devices are attempted; if at least one accepts, the digest is complete for that account to avoid replaying it to successful devices. As with external push generally, a process crash after provider acceptance and before database completion can produce a retry; stable web tags collapse repeated digests.

Preferences govern existing event producers; they do not provision sources or fabricate critical, finance, system or announcement events. Review alerts retain the existing low-rating/unanswered-review detection rules.

## Verification

`npm run test:notification-preferences` exercises a PostgreSQL-compatible PGlite database with mocked push providers: endpoint authorization and validation, tenant and location isolation, expired grants, audit persistence/rollback, revision conflicts, legacy channel patches, web/native/Action Center suppression, independent security push, digest de-duplication, revalidation, leases, retries and DST-aware schedules.

Also run frontend/API typechecks, the existing web-push/security and operational-alert regression suites, and the production build. Browser checks use synthetic API responses for English/Spanish, mobile widths, persistence, master pause and conflict handling. A physical-device receipt check remains a user-invoked test from Notifications.
