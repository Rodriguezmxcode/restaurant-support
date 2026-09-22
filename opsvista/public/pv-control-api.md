# OpsVista → PV Control: API v1

Base URL: `https://restaurant-support.vercel.app`

## PV Control web (interactive connection)

Open OpsVista as Founder, then **Integraciones → PV Control → Abrir PV Control**.
The web address is `https://restaurant-support.vercel.app/pv-control.html`.
Choose up to 31 days and click **Sincronizar OpsVista**. The web view reads the
six restaurants and Corporate Office using the existing signed OpsVista session;
it does not require a separate proxy, server, API key, or Cloudflare account.
This view is limited to locations and invoices. It does not migrate local PV
Control records, import the old file's sample data, or enable accounting writes.

The updated local `pv-ap-control-3.html` connects from **APIs → Conectar OpsVista**.
It opens this web view; sign in in the separate OpsVista tab if necessary,
return, select **Probar conexión**, synchronize, then explicitly select
**Enviar facturas a PV Control**. Keep the local file tab open. A MessageChannel
ties the response to the initiating local document: the handshake checks the
opener and random channel, the web side only accepts the opaque local origin,
and invoice data is sent through the transferred port, never a wildcard target.
The import is staged, validated and saved as a complete batch. It upserts by
OpsVista ID while preserving unrelated local records. Imported invoices remain
read-only and are excluded from local payable/cash totals and payment actions.

The interactive `/api/pv-control/{health,locations,invoices}` routes require a
same-origin browser request and the authorized Founder session on every call.
They do not accept API keys as a substitute for a session. The page stores no
credentials or invoice data in localStorage. Expired sessions require signing
in again. Failed or partial downloads preserve the prior complete query;
snapshot conflicts restart once. Unknown amounts remain unavailable.

## External server integration

This is a server-to-server, read-only API. It exports existing OpsVista data.
It does **not** yet make PV Control the accounting source or replace R365.

## Authentication

In OpsVista, sign in as Founder and open **Integraciones → PV Control · API de OpsVista**.
Create a key and save it in PV Control's server secret store as `OPSVISTA_API_KEY`.
The key is displayed once, expires after 90 days, and can be revoked in the same panel.
It grants `locations:read` and `invoices:read` for Puerto Vallarta's six restaurants
and Corporate Office. A maximum of five active keys is allowed.

Send `Authorization: Bearer <OPSVISTA_API_KEY>` on every request.
Browser login cookies and R365 credentials are not API credentials.
Do not put the key in frontend code, URLs, logs, or AI chat messages.
PV Control must call this API through its backend/proxy. Browser CORS is not enabled.

## Endpoints

`GET /api/v1/locations`

Returns `{api_version, organization_id, scopes, data: [{id, name, kind}]}`.
The location IDs are stable OpsVista slugs; use these IDs for invoice filtering.
They are not R365 GUIDs.

`GET /api/v1/invoices?start=2026-08-01&end=2026-08-31`

Required: `start`, `end`, inclusive dates in YYYY-MM-DD format, maximum 31 days.
Optional:

| Parameter | Values |
| --- | --- |
| `location_id` | ID from `/api/v1/locations`; omit for all seven entities |
| `approval_status` | `all` (default), `approved`, `unapproved` |
| `limit` | 1–200, default 100 |
| `offset` | 0–10000, default 0 |
| `snapshot_at` | Copy from the first response; required whenever offset > 0 |

Response:

```json
{
  "api_version": "1",
  "organization_id": "org-puerto-vallarta",
  "data": [],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "total": 0,
    "next_offset": null,
    "snapshot_at": "2026-09-21T12:00:00.000Z"
  },
  "totals": {
    "invoice_count": 0,
    "known_invoice_amount": null,
    "missing_amounts": 0
  },
  "source": {
    "provider": "restaurant365-odata",
    "snapshot_at": "2026-09-21T12:00:00.000Z",
    "refresh_pending": false,
    "date_basis": "transaction_date"
  },
  "limitations": ["Approval does not confirm payment."]
}
```

The example above is a schema example, not real company data.
Each invoice contains `id`, `source_id`, `number`, `transaction_date`, `location_id`,
`vendor_name`, `amount`, `currency`, `approval_status`, `payment_status`,
`paid_amount`, and `outstanding_amount`.

- Upsert by `id` (currently `r365:<source GUID>`), never by invoice number alone.
- `amount` is null when unknown, never fabricated as zero. `known_invoice_amount`
  is the sum of known amounts over the entire filtered result, not the page.
- Approval is `approved`, `unapproved`, or `unknown`.
- Payment is **unavailable**. Both payment amounts are null. Do not infer payment,
  unpaid debt, or a zero balance from approval, missing data, or invoice totals.
- Dates filter R365 transaction dates, not payment dates or approval dates.
- Receipt images, payment applications, due dates and GL posting lines are not exported by v1.
- This is a saved snapshot. Always display `source.snapshot_at` and `refresh_pending`.
- For subsequent pages preserve the same dates, location, approval filter, and
  `snapshot_at`; use `next_offset` until it is null. Do not sum repeated totals.
- A 409 `snapshot_changed` means restart from offset 0 and replace the partial batch.
- Do not delete local records based on an incomplete batch or a failed request.

## Errors and retries

Errors use `{ "error": { "code": "...", "message": "..." } }`.
401: invalid, expired or revoked key. 400: invalid query.
405: writes are unsupported. 409: snapshot changed.
429: limit reached (30 requests per minute per key), respect `Retry-After`.
503: source/database unavailable or first synchronization incomplete; respect
`Retry-After` when present, otherwise retry with bounded exponential backoff.
Never convert an error to an empty successful invoice list.

## Server-side connection test (JavaScript)

```js
const base = 'https://restaurant-support.vercel.app';
const response = await fetch(`${base}/api/v1/locations`, {
  headers: { Authorization: `Bearer ${process.env.OPSVISTA_API_KEY}` },
});
if (!response.ok) throw new Error(`OpsVista returned ${response.status}`);
const result = await response.json();
// Check result.api_version === '1' and use result.data for the location mapping.
```

OpenAPI specification: `/api/v1/openapi.json`.
No AI model is called by these endpoints.

## Next phase: PV Control → OpsVista

That direction requires a separately agreed PV Control API and stable mappings for
entities, GL accounts, invoices, payment applications, credits, voids and documents.
This API does not accept accounting writes and does not automatically cut over R365.
