# Acuerdos y seguimiento

The dedicated **Acuerdos y seguimiento** sidebar module builds on the meeting agreements already stored in Action Center. It reuses the same records, API, owners, authorized locations and audit history. No source Site data is imported, duplicated or deleted.

## User flow

1. Choose an operating week (Wednesday–Tuesday). Earlier open agreements are included by default.
2. Create an agreement with location/topic, corrective action, responsible account, commitment date and next review. Cause and extra context can be added.
3. Save without sending anything. Review existing agreements, filter by owner/location/status, and record progress, blockage or outcome.
4. Optional: **Mensaje al responsable** shows the recipient and notice content. **Enviar aviso** requests the configured email/push channels for that owner only. Delivery obeys existing recipient preferences, including queues. Provider acceptance is not proof of delivery or reading.

No automatic reminders, observers or new external channels are enabled for these manual notices. Regular Action Center notification behavior remains unchanged. A completed agreement requires an authorized verifier and result/evidence; marking completion does not automatically assert that the intervention worked.

## Persistence and compatibility

- Uses the existing `opsvista_actions.meeting_context` and action audit tables.
- Optional `meeting.blocked` keeps the Blocked view compatible with the operational status model.
- Adds the non-destructive `auto_escalate` column to action notification state, defaulting to true for legacy behavior. New manual meeting notices set it false.
- New editing sends `expectedUpdatedAt`; stale writes return HTTP 409 instead of overwriting another edit.
- Existing Action Center meeting-save labels now accurately say that saving does not send a notice.
- Existing roles with Action Center access receive the Acuerdos navigation item. Tenant and location authorization remain server-enforced. User-preview mode is read-only.

## Verification

Run from `opsvista/`:

- `npm run typecheck`
- `npm run typecheck:vercel`
- `npm run test:meeting-agreements`
- `npm run test:notification-email`
- `npm run test:notification-preferences`
- `npm run test:tenant-alerts`
- `npm run test:operational-alerts`
- `npm run build`

Meeting API tests use PostgreSQL in memory and mocked notifications. UI tests exercise the real component handlers without external writes. Desktop and 390-pixel mobile layouts were inspected with a temporary local fixture harness, excluded from source and production builds.

## Release boundary

Changes are prepared for review, not merged into the production branch. No real agreements were created or changed, no production database migration was run, and no real messages were sent during development. Authenticated production behavior and actual delivery still need a controlled verification after release approval.
