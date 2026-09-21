# Ask OpsVista data assistant

The previous chat provided rule-based guidance and module navigation. This change adds a server-side OpenAI Responses API tool loop that reads existing OpsVista integrations. The chat remains in memory and source citations show the requested period, authorized locations, retrieval time and coverage notes.

## Available reads

- Toast sales, reported hourly labor and OpsVista salary allocation, reusing the performance handler and its accrued/full-day basis.
- Ramp transactions assigned to the six operational restaurants, receipt/memo counts and a bounded detail list. Unassigned/company-office expenses are excluded; this is not a company-wide total.
- 7shifts task compliance summaries, including the existing fallback.
- Current Action Center state, with limited details and no historical-state claim.
- Saved Provi reports and their R365 comparisons. Overlapping report periods remain separate; raw evidence files not yet represented in reports are excluded.
- Google reviews, with the existing Vista Social import fallback clearly identified.

The assistant cannot read arbitrary SQL, browse arbitrary URLs, write records, place orders, send messages or approve payments. It does not yet expose complete accounting, inventory, price-watch history, individual payroll or forecast tools. Other tenant organizations remain blocked from legacy integrations. Server role policy limits datasets; all location queries are validated again at execution. User-preview mode disables chat requests.

## Configuration and limits

Reuse server-only `OPENAI_API_KEY` and the existing OpsVista PostgreSQL connection. Optional `OPSVISTA_COPILOT_MODEL` defaults to `gpt-5-mini`. `OPSVISTA_COPILOT_ENABLED=false` disables model calls without a code rollback. No key or model credential is sent to the browser.

When the key/database is absent, the UI clearly identifies the existing module guide and does not claim AI availability. Configured status only checks configuration presence; it does not prove provider credit, model availability or end-to-end source access.

Shared PostgreSQL counters admit at most 20 turns per user/hour and 250 per organization/UTC day, including failed attempts after reservation. Each turn has at most four data reads, five model responses (at most one short retry per response for temporary rate/availability errors), 2,400 output tokens per response and a 95-second engine deadline. Source responses are capped and detail truncation is explicit. Upstream calls already in progress may continue until their existing adapter timeout. API calls incur the configured OpenAI account's usage charges; no subscription or credits are purchased by this change.

OpenAI requests set `store:false`; selected source data and recent conversation context are transmitted to the configured OpenAI account. This setting is not a claim of zero provider retention. Raw upstream diagnostics, card details, attachment URLs, employee payroll detail and credentials are excluded. No chat text is written to the quota table. Old browser chat history for the active account is removed when the component mounts.

## Validation

- `npm run test:copilot`: 26 isolated tests covering tenant/role/location boundaries, date/history validation, Responses function-call protocol, source citations, unavailable data, bounded calls, provider error sanitization, source projection, overlapping Provi reports, cross-site requests, missing key status and concurrent PostgreSQL quota enforcement using PGlite.
- `node scripts/verify-copilot-ui.mjs`: five offline React rendering checks for source display/text escaping, user-preview guard, setup guidance and pending requests.
- Client/server TypeScript checks and production build pass.

Tests use synthetic data and a mocked model transport. Live model output quality, OpenAI key/credit status, authenticated browser behavior and real connector coverage require an authenticated acceptance check and must not be described as verified by these tests.

## Connection error handling

OpenAI errors are classified from allowlisted provider codes. Credit balance, project/organization spend limits, assigned usage limits, legacy quota errors, temporary throttling and authentication/model errors receive distinct messages. Billing/quota/unknown errors are never retried. Temporary errors receive at most one retry when the server delay is at most three seconds; longer delays are returned intact. Cancellation and the overall turn deadline still apply.

Only sanitized error categories, HTTP status and a validated OpenAI request ID are written to runtime logs. Raw messages, API keys, questions and business records are never included. Founder accounts see links to the relevant OpenAI settings; the app does not buy credits or increase limits. OpsVista quotas remain separate, with an accurate reset time. A pre-fix generic 429 log does not establish which OpenAI limit was reached.
