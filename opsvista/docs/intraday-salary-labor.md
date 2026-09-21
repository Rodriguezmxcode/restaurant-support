# Intraday salary allocation — review notes

Full daily salaries previously appeared immediately against partial-day sales. This change adds an operating-hours allocation for single-day live views, while retaining the full daily fixed salary as a separate reference.

## Verified Google profile hours

Read directly from the public Google Business Profiles in Google Maps on 2026-09-21 UTC. Addresses were matched to the Connecticut locations. All open at 11:00. Times below are local America/New_York; 00:00 and 02:00 are on the following calendar day.

| Location / source | Mon–Thu close | Fri–Sat close | Sun close |
| --- | --- | --- | --- |
| [Stamford](https://www.google.com/maps/place/Puerto+Vallarta+Stamford/@41.0514457,-73.537483,17z/data=!3m1!4b1!4m6!3m5!1s0x89c2a1e6b7decf69:0x1baebae088a46f4!8m2!3d41.0514457!4d-73.537483!16s%2Fg%2F11trs47nxn?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 22:30 | 00:00 | 22:30 |
| [Fairfield](https://www.google.com/maps/place/Puerto+Vallarta+Fairfield/@41.1813805,-73.2501395,17z/data=!4m7!3m6!1s0x89e80f66ddd95651:0x3a4cfd000ec7e6d2!8m2!3d41.1813805!4d-73.2501395!10e2!16s%2Fg%2F11h_3tc6kl?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 22:00 | 00:00 | 00:00 |
| [Orange](https://www.google.com/maps/place/Puerto+Vallarta+-+Orange/@41.2615078,-73.0086572,17z/data=!4m7!3m6!1s0x89e875e9cb1f6bcb:0x21c9472a6aacc093!8m2!3d41.2615078!4d-73.0086572!10e2!16s%2Fg%2F1hc3b3vfd?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 00:00 | 02:00 | 00:00 |
| [Avon](https://www.google.com/maps/place/Puerto+Vallarta/@41.815871,-72.86778,17z/data=!4m7!3m6!1s0x89e7a8c46ee86505:0xbb69843ab3363752!8m2!3d41.815871!4d-72.86778!10e2!16s%2Fg%2F1tff8n0p?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 22:00 | 23:00 | 22:00 |
| [Southington](https://www.google.com/maps/place/Puerto+Vallarta+Southington+%7C+Mexican/@41.6390018,-72.8748786,17z/data=!4m7!3m6!1s0x89e7b737f206ca6d:0xc7752658c6abf84c!8m2!3d41.6390018!4d-72.8748786!10e2!16s%2Fg%2F1v1vf6qc?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 22:30 | 23:00 | 22:30 |
| [Danbury](https://www.google.com/maps/place/Puerto+Vallarta+Danbury/@41.4109499,-73.4130343,17z/data=!4m7!3m6!1s0x89e7fed727e75fc1:0x859831c8076bac55!8m2!3d41.4109499!4d-73.4130343!10e2!16s%2Fg%2F11c20q8xgt?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 00:00 | 02:00 | 00:00 |
| [Middletown](https://www.google.com/maps/place/Puerto+Vallarta+Middletown/@41.5594576,-72.648233,17z/data=!3m1!4b1!4m6!3m5!1s0x89e64a439aca6041:0x93831e5ec3e72fb2!8m2!3d41.5594576!4d-72.648233!16s%2Fg%2F1tf08pj0?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 22:00 | 23:00 | 21:30 |
| [Newington](https://www.google.com/maps/place/Puerto+Vallarta+Newington/@41.6868387,-72.7087855,17z/data=!3m1!4b1!4m6!3m5!1s0x89e64d4b5988ef01:0x9280a6f98b03a0df!8m2!3d41.6868387!4d-72.7087855!16s%2Fg%2F1td7pbgr?entry=ttu&g_ep=EgoyMDI2MDkxNi4wIKXMDSoASAFQAw%3D%3D) | 23:00 | 23:00 | 23:00 |

These are the main business hours. Additional access, kitchen, or delivery hours were not used. Public profiles establish regular hours; the authenticated GBP API reads specialHours when available.

## Behavior

- Overview, Locations, and Labor request salary_basis=elapsed. Only a single current day, or the preceding day if still open after midnight, can receive accrued values.
- Full daily salary remains weekly payroll / 7. Allocation is full daily salary × elapsed open duration / total open duration, capped from 0 to 100%.
- Hourly labor remains the amount Toast reports, including prep and closing; no new hourly cost is invented.
- Accrued salary + hourly reported = accrued labor. All cost percentages use the same snapshot's net sales; the panel shows unavailable percentages for zero/negative sales.
- Full daily salary / sales so far is explicitly a reference, not a forecast of closing labor %. Full-day hourly labor and closing sales are not yet known.
- Closed days retain the fixed salary commitment and do not divide by zero.
- Live GBP regularHours, specialHours, openInfo and metadata are read through the existing credentials, with a 15-minute process cache. Mapping must be unique and match the CT address.
- The dated public Google reference is used only when the live call fails, with a visible warning that special hours could not be checked. It expires after seven days.
- Missing/ambiguous mapping, missing salary, invalid hours, or closed days prevent switching the selected locations' primary metrics to a mixture of full and accrued bases.
- Middletown and Newington hours are verified, but their fixed salaries are absent from the current salary history and are deliberately not inferred.
- Current-day screens refresh the whole snapshot every 60 seconds while visible and idle, plus a manual refresh. Salaries do not tick forward against old sales.
- Weekly bonus and historical/multiday requests retain their existing full salary calculations.
- Existing Toast source limitations remain: source latency and open time-entry coverage have not been independently verified.

## Validation and release status

- 13 focused calculation/source tests pass: 11–23 example, prep/closing, cent reconciliation, zero sales, overnight, DST, missing/closed hours, varying day lengths, unchanged weekly salary, mixed configuration, all eight Google schedules, holiday overrides, split service, invalid exceptions.
- Frontend and server type checks pass; production build passes.
- Nine additional offline checks pass with `node scripts/verify-intraday-release.mjs`: actual API handler and Spanish/English component rendering, authorization boundaries, accrued/full totals, historical/default/multiday preservation, overnight service, incomplete salary/hours, Google fallback, and Toast errors. Sessions and upstream responses are isolated fixtures; no credentials or live records are used.
- Vercel preview for commit `5665b9a` reached READY and GitHub reports the Vercel check successful. Its login screen opens in the browser. Production logs show the existing performance endpoint returning HTTP 200 on 2026-09-21 UTC.
- Local visual preview was blocked for loopback; the remote preview requires an OpsVista session. Authenticated visual layout, live GBP mapping, Toast open-entry coverage and source latency have not been independently verified. These checks must not be described as completed.
- The user authorized activation and explicitly requested an alternative to browser sign-in. Release validation therefore uses the offline handler/render checks, existing calculation checks, and the GitHub/Vercel administrative connection. Production deployment status must be confirmed separately after merge.
