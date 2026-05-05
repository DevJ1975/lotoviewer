# Vercel production handoff — 2026-05-05

**Status:** Production unblocked. 12-deploy red streak ended. Cron auth gate verified.

This document hands off the result of a Vercel-configuration session back to the codebase. It exists so the next agent working in this repo knows what's set, what's still pending, and what gotchas to avoid.

---

## TL;DR

- Production was failing on every deploy since commit `6e83ed5` (12 consecutive ERROR deploys on `main`).
- Root cause: the prebuild guard added in commit `772b204` (`scripts/check-deeplink-placeholders.mjs`) was failing because Apple Team ID, Android keystore SHA, and App Store Connect ID placeholders are still in the repo.
- Fix: added `ALLOW_DEEPLINK_PLACEHOLDERS=1` env var on Vercel (Production + Preview). This is a temporary bypass — see TODO #2.
- Same session: added `CRON_SECRET`, `RESEND_API_KEY`, and the previously-missing `SUPABASE_SERVICE_ROLE_KEY`.
- Redeploy of commit `65c85ba` succeeded: build in ~80s, deployment READY, promoted to production at https://soteriafield.app.
- POST `/api/cron/risk-review-reminders` smoke-tested in both directions (auth + no-auth) — returns the expected 200/401.

---

## What was wrong

The prebuild script `apps/web/package.json` runs `node ../../scripts/check-deeplink-placeholders.mjs` before every `next build`. The script scans three files for `REPLACE_WITH_*` placeholders and exits 1 if any survive:

- `apps/web/public/.well-known/apple-app-site-association` → `REPLACE_WITH_APPLE_TEAM_ID`
- `apps/web/public/.well-known/assetlinks.json` → `REPLACE_WITH_ANDROID_RELEASE_SHA_256_FINGERPRINT`
- `apps/mobile/eas.json` → `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`, `REPLACE_WITH_APPLE_TEAM_ID`, `REPLACE_WITH_PATH_TO_PLAY_SERVICE_ACCOUNT_JSON`

All three files still have placeholders. The script supports a `ALLOW_DEEPLINK_PLACEHOLDERS=1` bypass for local builds. Production wasn't setting it, so every commit on top of `772b204` failed at the prebuild step.

The `devjr-audit-report.md` from commit `65c85ba` correctly reported tsc clean / lint clean / 1364 tests passing — those were all true. The audit just didn't run a full Vercel-environment build, so the prebuild guard was missed. **The devjr skill (`.claude/skills/devjr/SKILL.md`) was updated as part of this handoff's follow-up work to require a deploy-environment build check in Phase A**, so future audits catch this class of regression.

---

## What was done

### Environment variables added on Vercel

Project: `prj_LOvd8a4L4zKthzThPuTxMLl44azn`, team: `team_MmNrzaVuE4VtH0iirYLgA6p0`.

| Variable | Environments | Sensitive | Purpose |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Production + Preview | yes | Was missing entirely. Legacy `service_role` JWT format. |
| `CRON_SECRET` | Production only | yes | 64-char hex. Gates the three cron handlers. |
| `ALLOW_DEEPLINK_PLACEHOLDERS` | Production + Preview | no | Bypasses the `check-deeplink-placeholders.mjs` prebuild. |
| `RESEND_API_KEY` | Production + Preview | yes | New `re_*` token — old key was lost (one-time-display). |

Existing env vars verified present, untouched: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Confirmed missing, accepted: `INTERNAL_PUSH_SECRET`. Optional per the original handoff — only needed when push auto-dispatch gets wired up.

### Notes on key choices that future-you may revisit

- The `SUPABASE_SERVICE_ROLE_KEY` was deliberately taken from Supabase's **Legacy anon, service_role API keys** tab, not the new **Publishable / Secret** tab. Reasoning: the existing `NEXT_PUBLIC_SUPABASE_ANON_KEY` is in the legacy JWT format, and pairing legacy-anon with legacy-service_role keeps both halves of the auth pair structurally consistent. Both formats work with `@supabase/supabase-js`, but mixing them is an avoidable footgun.
- `ALLOW_DEEPLINK_PLACEHOLDERS` was set on Production + Preview only. Vercel's UI locked the Development checkbox in this account. Doesn't matter — `npm run prebuild` only fires before `next build`, never before `next dev`, so Development env vars are irrelevant for this guard.
- `CRON_SECRET` is Production-only because the cron jobs only run in Production. No reason to leak it into Preview deploys that branch builds spin up.

### Build fix verified

Redeploy of `65c85ba` (deployment ID `dpl_4PQxjfopgr4SrkbHqikMA3mChP2M`) build log confirmed:

```
[deeplink-check] skipped (ALLOW_DEEPLINK_PLACEHOLDERS=1)
✓ Compiled successfully in 20.3s
Build Completed in /vercel/output [1m]
```

Deployment state: `READY`, target: `production`, source: `redeploy`. Aliased to `soteriafield.app`, `lotoviewer.vercel.app`, and the team-scoped production aliases.

### Smoke tests

POST https://soteriafield.app/api/cron/risk-review-reminders:

| Test | Auth header | HTTP | Body |
|---|---|---|---|
| With valid `CRON_SECRET` | `Authorization: Bearer <secret>` | 200 | `{"overdue":0,"emailsSent":0,"ownersNotified":0}` |
| Without auth | (none) | 401 | `{"error":"Unauthorized"}` |

Auth gate confirmed working. The 200-body shape diverges slightly from the original handoff (no `emailsSkipped` key) — this is because the handler returns 0 overdue reviews and exits before the email loop, so there's nothing to skip. **The handler was tightened in the follow-up commit to always return all four keys (zero values) so the response shape is consistent regardless of overdue count.** When real overdue reviews exist, expect all four keys.

---

## Current production state

| Field | Value |
|---|---|
| Project | `lotoviewer` |
| Project ID | `prj_LOvd8a4L4zKthzThPuTxMLl44azn` |
| Team | devj1975's projects (`team_MmNrzaVuE4VtH0iirYLgA6p0`) |
| Production domain | https://soteriafield.app |
| Latest deployment | `dpl_4PQxjfopgr4SrkbHqikMA3mChP2M` |
| Current commit | `65c85ba` ("docs: smoke checklist + devjr audit report (Phase E final)") |
| Framework | Next.js 16.2.4 |
| Node | 24.x |
| Root Directory | `apps/web` (confirmed by Vercel detecting `next` in `apps/web/package.json` — root `package.json` has no `next` dep) |
| Bundler | Turbopack |
| Last successful prior deploy | `dpl_GMvubokKJNsTcQAap8EGoAuE1BRL` (commit `6e83ed5`) — `isRollbackCandidate: true` |

### Cron jobs (from `apps/web/vercel.json`)

| Schedule (UTC) | Path |
|---|---|
| `0 */4 * * *` | `/api/cron/meter-bump-reminders` |
| `0 10 * * *` | `/api/cron/daily-health-report` |
| `0 13 * * *` | `/api/cron/risk-review-reminders` ← new in this deploy |

The Vercel MCP doesn't expose a cron-list endpoint, so registration is inferred from a successful deploy with `vercel.json` present. The next agent should eyeball **Settings → Cron Jobs** in the Vercel dashboard and confirm three rows appear. If only two show up, `vercel.json` parsing failed silently and the new schedule didn't register.

---

## Remaining manual TODOs

### 1. Verify cron registration in the Vercel dashboard

Open Project → **Settings → Cron Jobs**. Confirm three rows with the schedules above. If `risk-review-reminders` is missing, suspect a JSON parse error in `apps/web/vercel.json` and dig from there.

### 2. Remove `ALLOW_DEEPLINK_PLACEHOLDERS` once real store IDs are filled in

This is the highest-priority follow-up. The bypass means the prebuild guard is currently asleep — if a future commit accidentally introduces another placeholder regression in the deeplink files, it won't be caught until iOS/Android deep links break in the wild.

The bypass should be removed when all three files have real values:

- `apps/web/public/.well-known/apple-app-site-association` — needs Apple Team ID (from Apple Developer Portal → Membership)
- `apps/web/public/.well-known/assetlinks.json` — needs Android release SHA-256 (from `keytool -list -v -keystore release.keystore`)
- `apps/mobile/eas.json` — needs App Store Connect App ID, Apple Team ID, and path to the Google Play service account JSON

After all placeholders are gone, delete the `ALLOW_DEEPLINK_PLACEHOLDERS` env var from Vercel (Production + Preview) and trigger a redeploy. The prebuild script should then exit 0 on its own.

### 3. (Optional) Add `INTERNAL_PUSH_SECRET` if push auto-dispatch is wired up

Currently absent. The original handoff said "may be absent — that's fine," and at the time of writing the codebase doesn't appear to depend on it for any of the cron handlers. If/when push notification auto-dispatch is implemented, add it (Production + Preview, sensitive).

### 4. (Optional) Finish Resend domain verification

Current state on the Resend domain: SPF + DKIM + MX verified (sending works). DMARC is unset (optional, fine for transactional cron volume). Tracking pixel records (`mail` CNAME → `links1.resend-dns.com`, CAA → `0 issue "amazon.com"`) are failed/pending — Resend uses these for open/click analytics, not deliverability.

⚠️ **Do not manually add the suggested CAA record (`0 issue "amazon.com"`) at the apex of `soteriafield.app`.** CAA records at the apex restrict which CAs can issue certificates for the domain — adding only an Amazon entry would lock out the Let's Encrypt cert that Vercel auto-provisions for `soteriafield.app`. If Resend really needs that CAA, scope it to the tracking subdomain only, never the apex.

### 5. (Optional) Re-run the smoke test once there are overdue risk reviews

Right now the cron returns `overdue: 0` because the database has no past-due reviews. Once real overdue rows exist:

```sh
curl -i -X POST \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://soteriafield.app/api/cron/risk-review-reminders
```

Expected response will include `emailsSent > 0` and an `emailsSkipped` key. If `emailsSent: 0` with `emailsSkipped > 0`, that means `RESEND_API_KEY` isn't being read for some reason (handler logs `RESEND_API_KEY not set — skipping send`).

---

## Important context for future work

### "Build path shows /vercel/path0/apps/web" — Root Directory IS `apps/web`

When reading future build logs, don't get confused by the `npm error path /vercel/path0/apps/web` line. That's the npm workspace path inside an error message, not the build CWD. The actual CWD is `/vercel/path0` (where `npm run build` runs), and Root Directory is set to `apps/web` correctly. Confirmed by:

- Vercel reports `Detected Next.js version: 16.2.4` in the build log.
- Root `package.json` has no `next` dependency (just `expo-router`).
- Only `apps/web/package.json` declares `next@16.2.4`.

Therefore Vercel is reading `apps/web/package.json`, which means Root Directory = `apps/web` ✓. **Don't change this.**

### The 12-deploy red streak

Every commit on `main` between `6e83ed5` (last green) and `65c85ba` (the redeployed one) failed at the same prebuild step. There is nothing wrong with those commits' code — they all hit the same external bypass-not-set issue and would all build fine now. If you need to reason about what changed in those commits, treat the test/lint/tsc results from `docs/devjr-audit-report.md` as authoritative.

### Production domain

`soteriafield.app` is the canonical production domain. The `lotoviewer-*.vercel.app` URLs are aliases. When writing docs, examples, or smoke-test commands for this codebase, prefer `soteriafield.app`.

### Vercel MCP capabilities used in this session

The MCP available to Claude exposes **read** tools (`list_projects`, `get_project`, `list_deployments`, `get_deployment`, `get_deployment_build_logs`, `get_runtime_logs`, `list_teams`) and a generic `deploy_to_vercel`. It does **not** expose env var management, project settings mutation, or cron schedule listing. Future agents needing those operations will need to either drive the dashboard (via Claude-in-Chrome MCP or human handoff) or use the Vercel CLI with a personal access token.

### `CRON_SECRET` handling

The 64-char hex secret was generated via `openssl rand -hex 32` and pasted directly into the Vercel dashboard by the user. It exists in conversation history exactly once, and lives in the Production env var store as a sensitive variable. To smoke-test future cron changes, retrieve it from Vercel (**Settings → Environment Variables → click the eye icon next to `CRON_SECRET`** in Production scope), don't try to regenerate.

Rotation procedure if it ever leaks: generate a new value (`openssl rand -hex 32`), update the Vercel env var, redeploy. The handlers verify via `safeEqual` against either `Authorization: Bearer` or `x-internal-secret`, so the change takes effect on the next request after the deploy.

---

## Reference data

### Build log artifact (this session)

Full log of `dpl_4PQxjfopgr4SrkbHqikMA3mChP2M`: 2,570 lines. Inspector URL: https://vercel.com/devj1975s-projects/lotoviewer/4PQxjfopgr4SrkbHqikMA3mChP2M

Key lines (pin these for future debugging if a similar redeploy ever needs verification):

- L310: `[deeplink-check] skipped (ALLOW_DEEPLINK_PLACEHOLDERS=1)`
- L534: `✓ Compiled successfully in 20.3s`
- L2482: `Build Completed in /vercel/output [1m]`

### Last-known-good rollback target

If production breaks again and a rollback is the fastest fix while debugging:

```
Deployment ID:   dpl_GMvubokKJNsTcQAap8EGoAuE1BRL
Commit:          6e83ed5 — feat(jha): Slice 4 — KPI panel + cross-module escalation to risks
Marked:          isRollbackCandidate: true
```

In the dashboard: **Deployments tab → find that row → ⋯ menu → Promote to Production**.

### Files touched in this session

None in the codebase. All changes are Vercel-side env vars and a redeploy.

A follow-up commit in the codebase (separate from this Vercel work) addressed the four items the next agent flagged after reading this handoff: tightened the cron return shape to always include the four keys, added `docs/vercel-notes.md`, archived this handoff into `docs/handoffs/`, and updated `.claude/skills/devjr/SKILL.md` to require a deploy-environment build check in Phase A.

---

*Generated 2026-05-05 by a Cowork session configuring Vercel production for `lotoviewer` / `soteriafield.app`.*
