# OpsVista Mobile

Native iOS and Android client for the OpsVista restaurant operations platform.

## Current milestone

Version `0.1.0` establishes the production architecture without changing the current web experience:

- Supabase password authentication and existing TOTP two-step verification.
- A short-lived OpsVista API token stored in the device keychain.
- Server-enforced roles and location scope shared with the web application.
- Live Summary data from Toast and 7shifts.
- Location comparison and Tasks compliance.
- Explicit unavailable-source states; no demo numbers or silent fallbacks.
- iOS and Android identifiers reserved as `com.getopsvista.mobile`.

The initial App Store distribution target is **Unlisted App**. The app will be downloadable with a private App Store link but will not appear in public search.

## Run locally

Requirements: Node.js 22.13 or newer and Expo SDK 57-compatible tooling.

```bash
cp .env.example .env
npm install
npm start
```

Validate before every release:

```bash
npm run typecheck
npm run doctor
npx expo export --platform ios
```

## Release path

1. Enroll the owning legal entity in the Apple Developer Program.
2. Create the Expo/EAS project and configure App Store Connect credentials.
3. Produce an internal build and test authentication on real iPhones.
4. Upload the first build to TestFlight for Jacob and Michael.
5. Add the privacy policy, support URL, App Store metadata, screenshots, and App Review demo account.
6. Submit for App Review and request Unlisted App distribution.

Official references:

- [Apple unlisted app distribution](https://developer.apple.com/support/unlisted-app-distribution/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Expo App Store submission](https://docs.expo.dev/submit/ios/)

## Next mobile modules

1. Detailed 7shifts Tasks and Logbook.
2. Action Center assignments and evidence.
3. Push notifications for urgent maintenance, failed Tasks, approvals, and critical reviews.
4. Projects, payments, transfers, and Ramp evidence capture.
5. Offline-safe read cache with source timestamps and completeness indicators.
