# Scheduled operational push alerts

The `OpsVista operational alerts` GitHub workflow on **main** calls the production app at :17 and :47 each hour. Scheduling is approximate: GitHub may delay runs. The app evaluates Connecticut local time, including DST. Push notifications from these checks run 09:00–23:00; existing Action Center assignment and receipt notifications keep their immediate behavior.

No app needs to be open. The endpoint accepts only POST and a verified, short-lived GitHub OIDC identity pinned to this repository ID, owner ID, main branch, workflow filename and separate alerts audience. Source synchronization identities cannot invoke alerts and alert identities cannot invoke source sync. The scope is fixed to Puerto Vallarta. Browser sessions cannot invoke this endpoint.

| Rule | Condition | Cadence / limits |
| --- | --- | --- |
| Labor | Accrued total labor >32%, net sales ≥$1,000; verified current operating hours, configured salary and complete hourly rates required | From 17:00; one alert per location/day |
| Discounts / voids | Discounts >2% excluding employee meals and Uber Eats; voids >0.5%; net sales ≥$1,000 | From 17:00; each threshold once/location/day |
| Sales pace | Below 65% of daily target after 18:00 or 90% after 21:00 | Requires `OPSVISTA_DAILY_SALES_TARGETS_JSON`; never invents targets |
| Overtime | Hourly staff at 36–<40 worked hours, or weekly actual OT >8% of hourly worked hours | Daily after 15:00, Wednesday–Tuesday week; salary and unclassified staff excluded |
| Tasks | Returned task summary contains pending tasks | After 21:00; once/location/day; does not assume all checklists are closing checklists |
| Logbook | No substantive previous-day entry at a mapped 7shifts location | Daily from 09:00 |
| Reviews | Recent 1–2-star reviews or reviews unanswered ≥24 hours within last 30 days | Every 30 minutes; one digest/location/day; ignores unmapped locations |
| Ramp | Cleared positive transactions, missing receipt or blank memo ≥48 hours | Daily, trailing 30 days; missing exact timestamp gets a conservative three-calendar-day grace |
| Price Watch | Comparable normalized price increases ≥5%, with 10%/20% severity levels | Daily; latest invoices within two days, 28-day baseline; VERIFY rows excluded |
| Weekly bonus | Last closed Wednesday–Tuesday week, existing bonus engine | Daily until complete; one preliminary and complete update per eligibility state/week; does not authorize payment or disciplinary clearance |

Recipients: existing corporate observers (Founder, Roberto Operations, Jacob) plus active location managers with current grants. Reviews also go to Reputation, Ramp/Price Watch to Administration, and overtime to HR. Every device still needs the user's opt-in. Scheduled alerts use web push and the in-app inbox; they do not start an email campaign.

Database job leases prevent overlapping scans. Daily jobs skip after a successful daily check; failed or incomplete checks retry. Event keys deduplicate per location, rule and period, and delivery rows deduplicate per user. Transient push failures retry up to three attempts while a condition remains detected. No-device/opted-out accounts retain inbox entries without receiving a historic push backlog. A process crash after a provider accepted a push but before the database acknowledgement can cause a retry; stable notification tags help collapse it. Provider acceptance does not prove display or reading.

The authenticated Notifications panel shows the last check, individual source state and 30 days of recipient-scoped alerts. Manager location grants are checked again at read time. Lock-screen messages remain generic; business details stay inside the authenticated app.

Publishing the workflow to main runs **source verification only**, without sending notifications or creating inbox warnings. Subsequent scheduled/manual runs apply the normal windows. No missing data is treated as zero compliance or a violation.

Validation: `npm run test:operational-alerts`, `npm run test:web-push`, `npm run test:source-sync`, `npm run typecheck`, `npm run typecheck:vercel`, `npm run build`.
