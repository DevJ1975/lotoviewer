# Vercel notes — soteriafield.app

Project-specific notes for the Vercel production environment.
Reference for anyone working on a Vercel build issue without
the operational context.

## Project identity

| Field | Value |
|---|---|
| Project name | `lotoviewer` |
| Project ID | `prj_LOvd8a4L4zKthzThPuTxMLl44azn` |
| Team ID | `team_MmNrzaVuE4VtH0iirYLgA6p0` |
| Production domain | https://soteriafield.app |
| Aliases | `lotoviewer.vercel.app` + team-scoped production aliases |
| Framework | Next.js 16.x (Turbopack) |
| Node | 24.x |
| Root Directory | `apps/web` |

When writing docs / examples / smoke-test commands, prefer
`soteriafield.app` over the `*.vercel.app` aliases.

## Root Directory clarification (the confusing log line)

When reading build logs, you may see paths like
`/vercel/path0/apps/web` in npm error output. That is **not**
the build CWD — it's the npm-workspace path inside an npm
error message. The actual CWD where `npm run build` runs is
`/vercel/path0`. Vercel resolves Root Directory = `apps/web`
correctly, confirmed by:

- Build log shows `Detected Next.js version: 16.2.4`.
- Root `package.json` has no `next` dependency (just
  `expo-router` for the mobile app's hoist trick).
- Only `apps/web/package.json` declares `next@16.2.4`.

If a future agent thinks they need to change Root Directory
based on log paths, **don't.** Confirm by checking the framework
detection line first.

## Required env vars (Production)

| Name | Sensitive | Purpose | Set as of |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | Supabase REST URL | pre-2026-05 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon JWT (legacy format) | pre-2026-05 |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service-role JWT (legacy format — pair with anon for consistency) | 2026-05-05 |
| `CRON_SECRET` | yes | 64-char hex from `openssl rand -hex 32`. Gates the three cron handlers. | 2026-05-05 |
| `RESEND_API_KEY` | yes | `re_*` token for transactional email | 2026-05-05 |
| `ALLOW_DEEPLINK_PLACEHOLDERS` | no | Set to `1`. **Temporary build-guard bypass.** Remove once App Store / Android keystore values are filled in (see "Pending operations" below). | 2026-05-05 |
| `INTERNAL_PUSH_SECRET` | yes | Optional. Required only when push auto-dispatch is wired up. | not set |

### Notes on key choices

- **Supabase legacy vs. new key tabs.** The Supabase dashboard
  exposes two key tabs: "Legacy anon, service_role API keys"
  and "Publishable / Secret." We use the **legacy format on
  both halves** (anon + service_role) deliberately. Both
  formats work with `@supabase/supabase-js`, but mixing them
  is an avoidable footgun.
- **CRON_SECRET is Production-only.** No reason to leak it into
  Preview deploys spun up from branches. The cron handlers only
  run in Production.
- **ALLOW_DEEPLINK_PLACEHOLDERS spans Production + Preview.**
  Vercel locked Development for that env var on this account;
  it doesn't matter — `npm run prebuild` only fires before
  `next build`, never before `next dev`.

## Cron schedules

Defined in `apps/web/vercel.json` (re-listed below for
visibility — the file itself is the source of truth).

| Schedule (UTC) | Path |
|---|---|
| `0 */4 * * *` | `/api/cron/meter-bump-reminders` |
| `0 10 * * *` | `/api/cron/daily-health-report` |
| `0 13 * * *` | `/api/cron/risk-review-reminders` |

Verify after every deploy that touches `vercel.json`: open
**Settings → Cron Jobs** in the Vercel dashboard, confirm three
rows appear. If only two show up, the JSON didn't parse and
the new schedule didn't register.

The Vercel MCP doesn't expose a cron-list endpoint, so the
dashboard check is the only verification path short of waiting
for the next scheduled run.

## Smoke testing the cron auth gate

```sh
# Should return 200 with a 4-key JSON body
curl -i -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://soteriafield.app/api/cron/risk-review-reminders

# Should return 401 with { "error": "Unauthorized" }
curl -i -X POST https://soteriafield.app/api/cron/risk-review-reminders
```

Expected 200 body shape (always 4 keys, even when nothing's overdue):

```json
{
  "overdue":        0,
  "ownersNotified": 0,
  "emailsSent":     0,
  "emailsSkipped":  0
}
```

Retrieve the `CRON_SECRET` from Vercel **Settings → Environment
Variables** (click the eye icon next to the row in Production
scope). Don't try to regenerate from scratch — that breaks the
production cron until the next deploy.

## Rotation procedure for `CRON_SECRET`

If the value ever leaks:

1. `openssl rand -hex 32` → new value
2. Vercel **Settings → Environment Variables** → edit
   `CRON_SECRET` → paste new value → save
3. Trigger a redeploy (or wait for the next scheduled deploy)
4. Update any external callers (manual curl tests, monitoring
   pingers) with the new value

The handlers verify via `safeEqual` against either
`Authorization: Bearer` or `x-internal-secret`, so the change
takes effect on the next request after the deploy.

## Pending operations (will need to come back)

### High priority — remove the deeplink-placeholder bypass

`ALLOW_DEEPLINK_PLACEHOLDERS=1` was set on 2026-05-05 to
unblock production deploys. It bypasses
`scripts/check-deeplink-placeholders.mjs` which scans three
files for `REPLACE_WITH_*` markers:

- `apps/web/public/.well-known/apple-app-site-association`
  → `REPLACE_WITH_APPLE_TEAM_ID`
- `apps/web/public/.well-known/assetlinks.json`
  → `REPLACE_WITH_ANDROID_RELEASE_SHA_256_FINGERPRINT`
- `apps/mobile/eas.json` → three placeholders for ASC App ID,
  Apple Team ID, Play service-account JSON path

**The bypass means the prebuild guard is currently asleep.** A
future commit that accidentally introduces another placeholder
in these files won't be caught — iOS/Android deep links would
break in the wild instead.

When the real values are in place:

1. Edit each file to replace placeholders with real values
2. Commit + push
3. Vercel **Settings → Environment Variables** → delete
   `ALLOW_DEEPLINK_PLACEHOLDERS` from Production + Preview
4. Trigger a redeploy
5. Build log should show `[deeplink-check] OK` instead of
   `[deeplink-check] skipped (...)`
6. Future placeholder regressions now fail the build at
   `prebuild` correctly

### Don't do — CAA at the apex

Resend suggests adding `0 issue "amazon.com"` as a CAA record
to enable click/open analytics. **Do not add this at the apex
of `soteriafield.app`.** CAA records at the apex restrict
which CAs can issue certificates for the domain — adding only
an Amazon entry would lock out the Let's Encrypt cert that
Vercel auto-provisions for `soteriafield.app`. The cert
rotation would silently fail and produce an outage at the
90-day mark.

If Resend tracking is needed, scope CAA to a tracking
subdomain (e.g. `mail.soteriafield.app`), never the apex. Or
skip CAA entirely — the deliverability records (SPF, DKIM, MX)
are sufficient for transactional cron volume.

### Last-known-good rollback target

If production breaks again and a rollback is the fastest path
while debugging:

| Field | Value |
|---|---|
| Deployment ID | `dpl_GMvubokKJNsTcQAap8EGoAuE1BRL` |
| Commit | `6e83ed5` |
| Title | `feat(jha): Slice 4 — KPI panel + cross-module escalation to risks` |

Dashboard: **Deployments** → find that row → ⋯ menu → Promote
to Production.

## Vercel MCP capabilities (what tooling exposes)

The Vercel MCP available to Claude Code exposes:

- Read: `list_projects`, `get_project`, `list_deployments`,
  `get_deployment`, `get_deployment_build_logs`,
  `get_runtime_logs`, `list_teams`
- Write: `deploy_to_vercel` (generic deploy trigger)

**Not exposed via MCP:**

- Env var management (use the dashboard or the Vercel CLI
  with a personal access token)
- Project Settings mutation
- Cron schedule listing (inferred from a successful deploy
  with `vercel.json` present)

Future agents needing those operations need to drive the
dashboard via a browser MCP, use the Vercel CLI with a PAT, or
hand off to a human.

## Past incidents (chronological)

### 2026-05-05 — 12-deploy red streak ended

**Symptom:** Every commit on `main` between `6e83ed5` (last
green) and `65c85ba` failed at the `prebuild` step.

**Root cause:** The prebuild guard added in commit `772b204`
(`scripts/check-deeplink-placeholders.mjs`) was failing because
Apple Team ID, Android keystore SHA, and App Store Connect ID
placeholders are still in the repo. Production wasn't setting
the `ALLOW_DEEPLINK_PLACEHOLDERS=1` bypass, so every commit on
top of `772b204` failed at the prebuild step.

**Fix:** Added `ALLOW_DEEPLINK_PLACEHOLDERS=1` env var on
Vercel (Production + Preview). Same session: added
`CRON_SECRET`, `RESEND_API_KEY`, and the previously-missing
`SUPABASE_SERVICE_ROLE_KEY`. Redeploy of `65c85ba` succeeded.

**Lesson learned:** The devjr audit workflow (Phase A
"baseline + static checks") didn't simulate a Vercel-environment
build, so it missed the prebuild failure. The skill at
`.claude/skills/devjr/SKILL.md` was updated to include a
deploy-environment build check in Phase A so future audits
catch this class of regression.

**Full handoff:** see `docs/handoffs/2026-05-05-vercel-production.md`.
