# iOS build + TestFlight runbook

How to produce an iOS build of **Soteria FIELD** (`apps/mobile`) and push it to
**TestFlight** using EAS. iOS builds run on Expo's **cloud macOS builders**, so
you do **not** need a Mac — Node + the EAS CLI on any OS is enough.

> This must run on **your** machine (or CI), not in a Claude Code web sandbox —
> the sandbox has no network path to Expo/Apple and none of your credentials.
> It works verbatim through a local terminal, or an MCP that drives one (e.g.
> Desktop Commander in Claude Desktop). For unattended MCP/CI runs, use the
> **non-interactive** setup in the last section.

---

## 0. Prerequisites (one time)

| Need | Where | Notes |
|------|-------|-------|
| Apple Developer Program | developer.apple.com | Paid ($99/yr). Required for TestFlight. |
| Expo account | expo.dev | Free. Owns the cloud builds. |
| Node 20 | — | Repo pins `20` in `.nvmrc`. |
| EAS CLI | `npm i -g eas-cli` | Or run via `npx eas-cli@latest`. |
| Repo installed | `npm ci` at the **repo root** | Workspaces hoist deps; always install from root, never inside `apps/mobile`. |

The app's identity is already set in `apps/mobile/app.json`:
bundle id **`com.soteriafield.app`** (iOS + Android), name **Soteria FIELD**.
The bundle id must exist as an App ID in your Apple account — `eas build`
registers it for you on first run.

---

## 1. Fill the submit config

`apps/mobile/eas.json` → `submit.production.ios` uses an **App Store Connect API
key** (no Apple ID password / 2FA at submit time). Replace the four
`REPLACE_WITH_*` values:

| Field | What it is | Where to get it |
|-------|-----------|-----------------|
| `appleTeamId` | 10-char Team ID | developer.apple.com → **Membership** |
| `ascAppId` | The app's numeric Apple ID | App Store Connect → your app → **App Information**. If the app record doesn't exist yet, `eas submit` offers to create it — you can fill this in afterward. |
| `ascApiKeyId` | API key ID (10 chars) | App Store Connect → **Users and Access → Integrations → App Store Connect API** |
| `ascApiKeyIssuerId` | Issuer ID (UUID) | Same page, shown above the key list |

Then place the key file itself at `apps/mobile/credentials/asc_api_key.p8`
(gitignored — see `credentials/README.md`).

> The `REPLACE_WITH_*` tokens are intentionally guarded:
> `scripts/check-deeplink-placeholders.mjs` fails the **web** build while any
> remain (bypassed by `ALLOW_DEEPLINK_PLACEHOLDERS=1`). Filling them for the
> mobile release also clears that guard.

---

## 2. Set the app's runtime env

The app reads Supabase + the web API origin from `EXPO_PUBLIC_*` vars at build
time (`apps/mobile/lib/supabase.ts`, `apps/mobile/lib/api.ts`). Without them the
app throws on launch. Register them as **EAS environment variables** so they're
pulled into cloud builds (the build profiles set `"environment": "production"`
etc. to select them):

```bash
cd apps/mobile

eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL      --value "https://YOUR-PROJECT.supabase.co" --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "YOUR-ANON-KEY"                     --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_WEB_ORIGIN        --value "https://soteriafield.app"          --visibility plaintext
```

The Supabase URL + anon key are the same public values the web app ships (they
are RLS-protected, not secrets). `EXPO_PUBLIC_WEB_ORIGIN` is where the mobile AI
assistant reaches the Next.js `/api/*` routes.

For the local dev loop (`eas start`/Expo Go) you can instead drop these in a
gitignored `apps/mobile/.env.local`.

---

## 3. Log in to EAS

```bash
eas login          # interactive
# or, headless (MCP/CI): export EXPO_TOKEN=... (expo.dev → Account → Access tokens)
```

---

## 4. Build

```bash
cd apps/mobile
eas build --platform ios --profile production
```

- **First run** prompts to set up iOS signing (Distribution certificate +
  provisioning profile). Let EAS manage them — it stores them on your Expo
  account and reuses them every build. This step needs a one-time Apple login
  (or the ASC API key).
- The build runs in the cloud; the CLI prints a build URL you can watch.
- `appVersionSource: "remote"` + `autoIncrement: true` means EAS owns the build
  number — no manual bumping.

Want a faster smoke test before TestFlight? Use the **preview** profile
(`--profile preview`) — an installable internal build, no App Store round-trip.

---

## 5. Submit to TestFlight

```bash
eas submit --platform ios --profile production
```

This uploads the build to App Store Connect using the ASC API key. After Apple
finishes processing (~5–15 min) it appears under **TestFlight** in App Store
Connect. Add internal testers there and they get it immediately; external
testers need a short Beta App Review.

**One-shot** (build, then auto-submit when it succeeds):

```bash
eas build --platform ios --profile production --auto-submit
```

---

## 6. Non-interactive (MCP / Desktop Commander / CI)

To run start-to-finish without prompts:

```bash
export EXPO_TOKEN=...        # authenticates the CLI, replaces `eas login`
cd apps/mobile
eas build --platform ios --profile production --non-interactive --auto-submit
```

Requirements for a clean unattended run:
- `EXPO_TOKEN` set (no interactive login).
- iOS signing **already** generated once (run an interactive build the first
  time, or pre-provision via `eas credentials`). `--non-interactive` cannot
  create new credentials.
- ASC API key in place (`credentials/asc_api_key.p8` + the three ASC fields in
  `eas.json`) so submit needs no Apple 2FA.

---

## Troubleshooting

- **`@soteria/core` fails to resolve on the builder** — ensure you ran
  `eas build` from `apps/mobile` and installed deps from the **repo root**. The
  root `package.json` `workspaces` + `apps/mobile/metro.config.js` handle the
  monorepo; EAS auto-detects the workspace root.
- **App launches then errors about Supabase env** — the `EXPO_PUBLIC_*` vars
  from step 2 aren't reaching the build. Confirm with
  `eas env:list --environment production`.
- **Submit can't find the app** — set `ascAppId` in `eas.json`, or let the
  interactive `eas submit` create the App Store Connect record first.
- **iOS `resourceClass` rejected** — EAS occasionally renames tiers; if the
  build errors on `m-medium`, switch the iOS `resourceClass` to `medium`.
- **Prefer EAS-hosted credentials over a local `.p8`** — remove `ascApiKeyPath`
  from `eas.json` and run `eas credentials` to upload the key to your Expo
  account instead.
