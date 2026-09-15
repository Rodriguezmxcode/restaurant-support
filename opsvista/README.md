# OpsVista Migration v1

This directory is the first version-controlled source base for migrating OpsVista away from a ChatGPT Sites-only implementation.

## Why this exists

The current OpsVista/PV Operations product is published from ChatGPT Sites. The exact original source project was not present in the connected GitHub account, Google Drive, or ChatGPT Library as a repository/ZIP. This migration therefore rebuilds the application shell from the documented production UI and operational requirements while preserving the existing Site until a controlled replacement is ready.

## Implemented in this branch

### Assisted onboarding for additional restaurant businesses

- Founder → Configuración → **Activar un nuevo cliente** provisions an organization, its locations, and a Corporate administrator together in a transaction. The Founder must first review the actual Stripe subscription, successful payment and purchased quantity; the form records that manual review. It does not validate payment through the Stripe API or use Checkout redirects as payment proof.
- Each new organization opens its own native Tasks and team workspace. Corporate administrators can add scoped team members and generate 48-hour invitation links. Invitations are shared manually; no email is automatically sent by this onboarding flow. Existing Supabase login and MFA apply.
- New customers get native tasks, checklists, assignments, due dates and task follow-up. Legacy integrations and workflows remain restricted to Puerto Vallarta or the Founder until those modules have per-customer setup. New users are not added to Puerto Vallarta's directory or membership.
- Public Stripe subscriptions use US$79 per location/month plus applicable taxes. Stripe controls recurring billing; access activation and billing changes are assisted. Automatic tax collection, subscription webhooks and automatic suspension are not enabled by this change.
- `node scripts/test-native-tasks.mjs` includes cross-organization permission and activation-input checks. The first complete invitation/MFA/production persistence flow still needs validation with an authorized new customer; no real customer payment is made by the test suite.

### Native Tasks and assignment oversight

- Tasks opens with **Tasks de OpsVista**. Managers and corporate users can create, edit, duplicate, archive and reopen tasks within their authorized locations. Kitchen leadership has the same location-scoped controls; Maintenance can complete its assigned tasks.
- Each task supports custom category and position/team, instructions, an authorized responsible user, due date, priority and up to 50 checklist steps. Steps record who completed them and when. A task can close only after all of its steps are checked.
- Records and audit snapshots persist in `opsvista_native_tasks` and `opsvista_native_task_audit` using the existing OpsVista Postgres connection. Schema initialization is additive and follows the existing store pattern. No 7shifts credentials are required for this workflow.
- Updates use a version check to reject concurrent overwrites. Repeated create requests use a stable request identifier; archiving preserves the record and history. Editing a checklist label resets completion of that step.
- The existing 7shifts Tasks/evidence view remains available in its source tab, and existing Tasks search links open that view. Native tasks do not change the 7shifts compliance or Weekly Bonus calculations.
- Founder and Corporate Action Center users have a **Seguimiento por responsable** table. Click a person or status count to filter the action queue. Overdue, in-progress, undated, completed and verified totals stay distinct; dismissed actions are excluded from the summary.
- Native Tasks and Action Center retain separate records and histories. Native Tasks currently supports individual tasks and duplication, without automatic recurrence or external notification dispatch.
- Run `node scripts/test-native-tasks.mjs` for the native-task authorization, validation, progress and assignment-summary checks.

- Responsive OpsVista operations shell based on the current production navigation
- Mobile-first navigation behavior
- Action Center as a first-class module
- Operational priority queue
- Signal → likely cause → recommendation → owner → verification workflow
- Estimated financial/operational impact
- Location filters and search
- Assign / Create Task / Investigate / Dismiss demo interactions
- Verification loop concept
- Persistent OpsVista Assistant chat available from every authorized module
- Bilingual Q&A routing for managers with role- and location-aware module links
- Grounded operational answers using the user's current Action Center scope
- Dedicated Restaurant365 module with connection health, encrypted credential storage, six-restaurant plus Corporate Office validation and source-gated P&L/AP areas
- Restaurant365 monthly ledger explorer with approved-transaction detail, AP invoice index, vendor catalog, GL account catalog and reconciliation quality checks
- Smart Action assignment based on alert category: on-duty location manager for labor/operations, Roberto or Jacob for sales coaching, and Miguel Bello for maintenance
- Live 7shifts on-duty manager resolution with authorized-directory fallback
- Mobile device registration and Expo push dispatch through the existing authenticated workflow API
- Push accountability timeline: sent, push accepted, delivered, seen, accepted, in progress, evidence submitted, verified and escalated
- Acceptance deadlines and corporate escalation records for unaccepted assignments

## Existing product areas represented in navigation

- Resumen
- Locaciones
- Ventas
- Local Intelligence
- Finanzas
- Gastos
- Horarios
- Tasks
- Action Center
- Prioridades
- Pagos
- Transferencias
- Restaurant365
- Configuración

## Important data status

The Action Center metrics and alerts in this branch are representative demo values. They must not be interpreted as live operational data until the existing integrations are wired to this source base.

## Integration targets

1. Toast — sales, orders, discounts, voids, employees, labor
2. 7shifts — scheduling, tasks, logbook
3. Ramp — transactions, cardholders, departments/locations, memos, receipts
4. Restaurant365 — read-only accounting transactions, AP invoices, GL detail, vendors and locations. Receipt attachments and exact paid status require a separately verified R365 source.
5. Local intelligence — weather, traffic and event demand signals

## Next implementation sequence

1. Connect live data adapters to Action Center
2. Add Evidence Audit (photo requirement, approve/reject, resubmit, before/after)
3. Add Ramp memo/receipt compliance signals
4. Add projected labor and overtime rules
5. Connect the OpsVista Assistant to additional verified live module adapters
6. Connect the native iOS/Android client to the implemented mobile device, action assignment and notification-receipt API contracts

## Safety

This work lives on `opsvista-migration-v1` and does not replace the current production Site. Production should only be switched after live integrations, authentication, permissions, and regression checks are completed.
# Persistent source synchronization

R365 AP, ledger, catalogs and beverage comparisons now read durable PostgreSQL
snapshots. Opening a previously loaded period does not call the external source.
Existing AP/beverage snapshots are migrated on first access without downloading
them again. A new period is registered for background refresh; failed refreshes
retain the last successful payload and disclose pending status.

Invoice detail is shared across periods by organization and R365 transaction ID.
New/modified headers, modified detail records, missing amounts and the nightly
reconciliation cause detail refresh. Complete live header membership prevents
removed/moved invoices from reappearing in current totals. The old record remains
in storage. Pending source data never receives a beverage ranking position.

`.github/workflows/opsvista-source-sync.yml` must be present on the default `main`
branch. It runs approximately every 30 minutes (GitHub schedules may be delayed),
with nightly refresh due at 07:30 UTC: 03:30 EDT / 02:30 EST. The persistent queue
resumes after timeouts and retries source failures in 30 minutes. It also tracks
the current AP month before anyone opens it. The OData change cursor advances only
after complete header and detail feeds and durable invalidation succeed.

The worker authenticates using a short-lived GitHub OIDC token, validating its
signature, issuer, audience, immutable repository/owner IDs, branch, workflow,
subject, event and expiry. No deployment or R365 secrets belong in GitHub. Its
response contains queue counters only. Production remains on the migration
branch; adding the scheduler to `main` does not merge the application there.

Verification: `npm run test:source-sync` uses PostgreSQL via PGlite and synthetic
data to check persistence, cache reuse, tenant isolation, migration, failed
refreshes, retries and leases; it also verifies scheduler signatures/claims.
`npm run test:beverage-bonus` covers invoice updates, credits and ranking gates.
`GET /api/restaurant365?view=sync-status` requires existing R365 access and exposes
last successful detection, scheduler heartbeat, backlog and error counts.
