# OpsVista Migration v1

This directory is the first version-controlled source base for migrating OpsVista away from a ChatGPT Sites-only implementation.

## Why this exists

The current OpsVista/PV Operations product is published from ChatGPT Sites. The exact original source project was not present in the connected GitHub account, Google Drive, or ChatGPT Library as a repository/ZIP. This migration therefore rebuilds the application shell from the documented production UI and operational requirements while preserving the existing Site until a controlled replacement is ready.

## Implemented in this branch

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
6. Add mobile API contracts for native iOS/Android clients

## Safety

This work lives on `opsvista-migration-v1` and does not replace the current production Site. Production should only be switched after live integrations, authentication, permissions, and regression checks are completed.
