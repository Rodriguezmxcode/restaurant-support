# OpsVista sign-in verification

Founder accounts keep Supabase Authenticator (AAL2). Other active accounts use a
previously enrolled personal push device and a password, with one-use recovery
codes. All authorization is enforced in `/api/auth/session`; no business session
is issued before the second factor succeeds. The retired password-only native
prototype endpoint returns 410; the currently used web/PWA login is supported.

## Enrollment and migration

- A new account with no verified provider factor and no push device can bootstrap
  its first device after a password sign-in and successful push-code verification.
- An account with an existing Authenticator must verify it once before linking a
  push device. If that factor is lost, an administrator must verify identity and
  recover it through the identity provider. This release does not remove factors
  or reset Roberto's account automatically.
- Once push is linked, newly enrolled provider TOTP factors cannot bypass it.
  Access and replacement require the existing push factor or a recovery code.
- Eight random 80-bit recovery codes are displayed once after enrollment. Their
  HMAC hashes are stored; each is redeemed atomically and only after password
  sign-in. Replacing the device invalidates prior proofs and recovery codes.
- Founder accounts cannot enroll or authenticate using push/recovery codes.
- Initial Authenticator setup removes only abandoned unverified TOTP records,
  renders an SVG QR safely and offers a manual setup key. Verified accounts get
  clear instructions and recovery guidance instead of an unsafe replacement QR.

## Security and operation

Six-digit cryptographically random codes expire after five minutes and permit
five attempts. Challenge creation is serialized and rate limited per account to
one per minute and ten per hour across sessions and instances. Recovery attempts
are capped at five per hour. Database transactions prevent replay/concurrent use.
Challenges bind the user, tenant, Supabase session and previously enrolled device.
Codes are HMAC hashed, omitted from API responses and never logged. Security push
subscriptions are stored separately from operational alert preferences and cannot
be overwritten through ordinary subscription registration. Provider acceptance
is reported honestly and is not a guarantee the phone displayed the notification.

Push proof is signed inside the existing HttpOnly Secure SameSite session cookie,
bound to the provider session and device version, and usable for up to 12 hours.
The ordinary server session still expires after two hours without renewal. All
new auth POSTs require same-origin JSON. Security tables enable RLS without public
policies. The server database role creates/accesses them, as with existing stores.

Signing out removes operational alert delivery while preserving the separately
registered security subscription. Turning off operational alerts does the same.
Tapping a login push focuses an existing app window without discarding its pending
challenge. iOS setup explains Add to Home Screen and notification permission.

## Verification

- `npm run typecheck` and `npm run typecheck:vercel`
- `npm run test:push-mfa`: isolated PostgreSQL (PGlite), real store/handlers,
  synthetic identities and mocked push transport; enrollment, existing-factor
  protection, provider-AAL2 bypass rejection, Founder policy, CSRF, ownership,
  session binding, expiry, replay/concurrent redemption, limits, recovery,
  replacement, logout preservation, delivery failure, password-only-route closure.
- `npm run test:web-push`: existing operational notifications remain compatible.
- `npm run build`

These tests do not prove receipt on a physical phone or recover an existing lost
Authenticator. Perform a real device enrollment/sign-out/sign-in check with the
account owner before reporting that person's push login as activated.
