# Company alerts and connection health

Company policies and source checks use organization IDs throughout the scheduler, SQL leases, inbox, recipient ledger and push actor. Managers see their current authorized restaurants, including grant expiration; only current Founder/Corporate accounts can change company policies. Policy edits use same-origin JSON requests, revision conflicts and transactional audit records.

The Connections & automatic alerts panel is in Settings, Integrations and the Notifications connection-status disclosure. Client workspaces have their own Connection status tab. The panel distinguishes configured credentials, a successful source check, a failed check, an overdue check and the scheduler heartbeat. Source success is not phone delivery confirmation. Source outages never become operational violations.

## Supported sources

- Puerto Vallarta keeps its existing Toast, 7shifts, Ramp, Google and R365 connections and corporate alert recipient list.
- Other active companies can schedule Google review and Price Watch checks using their own saved Google/R365 credentials. Their restaurant names are not limited to PV's locations.
- Toast, 7shifts, Ramp and the combined weekly bonus remain setup-required for other companies. No legacy environment credentials, Google account/location map, or imported PV review report may be reused by another company.
- Google location matching must be unique. Missing/ambiguous mapping fails the check instead of declaring no problems.
- Company settings include enabled rules, review rating threshold (1–3), unanswered-review hours (1–168), price increase minimum (5–100%) and time zone. PV stays on Connecticut business dates. Daily checks remain once per successful business day; changing rules does not replay delivered warnings.
- The interval is approximately 30 minutes, subject to GitHub scheduling and source response times. This is not a real-time delivery guarantee.

## Deployment order

1. Deploy the app from opsvista-migration-v1 with the plan endpoint first.
2. Copy only .github/workflows/opsvista-operational-alerts.yml to the main branch (the GitHub schedule source). The app accepts the old PV requests during this transition.
3. The workflow's push event invokes verify-only checks, so it reads sources without sending operational notifications. Scheduled/workflow_dispatch runs use normal delivery.

Each source/location is a separate bounded request. One company/source failure does not cancel the other checks. Heartbeats continue outside sending hours and drain preference digests. A missing source connection is shown as connection-required rather than checked.

## Verification

npm run test:tenant-alerts exercises real Postgres-compatible SQL through PGlite and the real Google loader with synthetic HTTP: same-name restaurants in different companies, encrypted credential isolation, matching ambiguity, independent job leases/events/recipients, failed sources, read-only verification, role/membership/grant authorization, settings conflicts and audit rollback, DST, and manifest isolation when one credential fails.

Regression gates: test:operational-alerts, test:notification-preferences, test:web-push, test:push-mfa, typecheck, typecheck:vercel and build.

The actual React component was also exercised with a temporary synthetic API on desktop and a 390px mobile viewport, in EN/ES: location filter, company rule editing, saved state, and no horizontal overflow. That checks UI behavior; production source availability is confirmed by the deployed scheduler, and physical push receipt still requires the user's device.
