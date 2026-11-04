# OpsVista Mobile

Native Expo client for the existing OpsVista backend. The mobile app never stores Toast, 7shifts, Ramp or Restaurant365 credentials.

## Live modules in v0.2

- Existing OpsVista user login and role/location scope
- Live daily Toast sales and labor
- Persistent Action Center
- Smart responsibility suggestions
- 7shifts manager-on-duty resolution
- Push device registration
- Sent, delivered, seen and accepted accountability receipts
- Evidence and Verification Loop actions

## Local validation

```bash
npm install
npm run typecheck
npm start
```

## TestFlight build

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

After `eas init`, keep the generated EAS project ID in `app.json`. Apple submission requires the OpsVista Apple Developer account and App Store Connect access.
