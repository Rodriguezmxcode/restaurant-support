# Overtime reconciliation

The monitor totals every classified hourly Toast record independently of 7shifts
schedules, employee links, or schedule outages. Employees missing from 7shifts
remain visible as Toast-only records. It separates Toast-reported hourly OT from
additional scheduled exposure. Neither time-entry estimates nor forecasts are labeled final payroll.

- Worked hours use Toast business dates (including each restaurant's closeout
  boundary), and reported OT is never replaced with `max(totalHours - 40, OT)`.
- Differences against the 40-hour calculation remain visible for review.
- Worked costs prefer Toast Analytics `regularCost` / `overtimeCost`, requested
  through `/era/v1/labor/{day|week|month}` with `groupBy: [EMPLOYEE]`. Requests
  explicitly scope restaurant IDs and business dates. A completed report must
  match all hourly employees and regular/OT hours for a location (0.011-hour
  tolerance) before replacing estimates. Missing employees, unexpected locations,
  dates, duplicate rows, malformed amounts, or stale hours retain the estimate.
- Analytics requires the existing private `TOAST_ANALYTICS_API_HOST`,
  `TOAST_ANALYTICS_CLIENT_ID`, and `TOAST_ANALYTICS_CLIENT_SECRET` configuration.
  Its credentials are separate from Standard API credentials. No access or new
  subscription is provisioned by this change. No credentials enter the client.
- HTTP 202 is pending, never zero. Report IDs are reused while processing;
  completed reports are cached for up to 10 minutes in a bounded process cache.
  A 12-second deadline and explicit unavailable/not-configured statuses protect
  the time-entry feed. The UI shows source and report retrieval time.
- Without a usable cost report, historical time-entry wages produce an explicitly
  estimated 1.5x OT cost. Mixed reported/estimated totals are labeled. Neither
  Analytics costs nor time entries are a final Payroll earnings import.
- Future OT is the increase attributable to remaining shifts. Past periods have
  no future exposure. Worked OT belongs to its Toast source restaurant; future
  exposure is assigned to the next scheduled restaurant, an attribution estimate
  when an employee has remaining shifts across multiple locations.
- Missing historical rates produce an incomplete cost, not a partial zero.
  Salary and unresolved pay classifications stay outside the hourly comparison.
  A missing 7shifts link alone never makes known hourly Toast data unclassified.
  Mixed hourly/salary jobs remain unclassified for review.
- Schedule outages preserve worked totals. Missing schedules or unresolved future
  employee links mark forecasts unavailable, rather than implying zero exposure.
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

Toast API references:
- https://doc.toasttab.com/doc/devguide/apiAnalyticsLaborReportingDataOverview.html
- https://doc.toasttab.com/doc/devguide/apiAnalyticsOverview.html
- https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistPayroll.html

Live payroll agreement still requires an authenticated check of the selected
period and imported final payroll. Synthetic tests prove calculation behavior,
not that production payroll totals match.
