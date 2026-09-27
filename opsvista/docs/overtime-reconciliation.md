# Overtime reconciliation

The schedule monitor separates Toast-reported hourly OT from additional scheduled
exposure. Neither time-entry estimates nor forecasts are labeled final payroll.

- Worked hours use Toast business dates (including each restaurant's closeout
  boundary), and reported OT is never replaced with `max(totalHours - 40, OT)`.
- Differences against the 40-hour calculation remain visible for review.
- Worked cost uses the historical rate on each time entry at an estimated 1.5x.
  This is not a Payroll earnings import and may differ from payroll adjustments,
  tip-credit rules, or other configured pay rules.
- Future OT is the increase attributable to remaining shifts. Past periods have
  no future exposure. Worked OT belongs to its Toast source restaurant; future
  exposure is assigned to the next scheduled restaurant, an attribution estimate
  when an employee has remaining shifts across multiple locations.
- Missing historical rates produce an incomplete cost, not a partial zero.
  Salary and unclassified hours stay outside the linked-hourly comparison.
- Imported Payroll references are held in the private OpsVista database. No real
  payroll figures are committed to source or bundled into the public frontend.
  Corporate, Founder, and HR may import a complete-period JSON reference in the
  monitor. Each import is append-only, records its actor and time, and the latest
  complete reference for that Wednesday–Tuesday period is used. Location filters
  scope both the reference and live comparison. Imports do not change Toast.
- A reference file contains `start`, `end`, `providedAt` (YYYY-MM-DD), and
  `locations` with `location`, `hours`, and `cost` (numeric USD). Use the full
  period reference each time: a newer import supersedes the previous reference
  for that period. Payroll reference availability does not block live estimates.

Validation: `node scripts/test-overtime.mjs`, `npm run typecheck`,
`npm run typecheck:vercel`, and `npm run build`.
An optional private acceptance fixture can be passed with
`OPSVISTA_PAYROLL_ACCEPTANCE_FILE=/absolute/path/to/reference.json`.

The existing GET-only Team handler and its permissions are unchanged. Two
pre-existing TypeScript issues were corrected without changing that behavior.
