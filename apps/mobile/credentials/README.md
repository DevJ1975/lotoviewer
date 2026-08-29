# Local credentials (gitignored)

This directory holds machine-local signing/submission secrets. **Nothing secret
here is committed** — `apps/mobile/.gitignore` already ignores `*.p8`, `*.p12`,
`*.jks`, `*.key`, `*.mobileprovision`, and `*.pem`. This README is the only
tracked file, so the directory exists for `eas.json` to resolve
`ascApiKeyPath` against.

## `asc_api_key.p8` — App Store Connect API key (iOS submit)

`eas.json` → `submit.production.ios.ascApiKeyPath` points at
`./credentials/asc_api_key.p8`. Put your App Store Connect API key here with
exactly that filename:

1. App Store Connect → **Users and Access → Integrations → App Store Connect API**.
2. Generate a key with the **App Manager** role (or Admin).
3. Download the `AuthKey_XXXXXXXXXX.p8` **once** (Apple never shows it again) and
   save it as `apps/mobile/credentials/asc_api_key.p8`.
4. Copy the **Key ID** and **Issuer ID** into `eas.json` (`ascApiKeyId`,
   `ascApiKeyIssuerId`).

See `../docs/testflight.md` for the full build + TestFlight runbook.

> Treat the `.p8` like a password. If it leaks, revoke it in App Store Connect
> and generate a new one.
