# Soteria FIELD — End-to-End SaaS Platform Audit

**Date:** 2026-05-14
**Branch:** `claude/saas-platform-audit-9uO81`
**Scope:** Full-stack audit of the Next.js 16 + Supabase EHS SaaS at
`apps/web` (148 migrations, ~30 modules, AI-augmented, multi-tenant).

---

## TL;DR

The platform is a **domain-rich prototype masquerading as a SaaS**. The
core EHS engine — multi-tenant RLS, audit logging, cron orchestration,
AI cost control, PWA, and 138 well-formed migrations — is genuinely
strong. The *SaaS wrapper* (billing, self-serve signup, privacy
compliance, CI safety net, status page) is **absent or incomplete**.

**Production-readiness scorecard (out of 10):**

| Domain         | Score | Verdict                                                          |
|----------------|:----:|-----------------------------------------------------------------|
| Database / RLS | 8    | Solid; missing PITR runbook + rollback plan                      |
| Auth & tenancy | 7    | RLS pattern mature; superadmin-only onboarding                   |
| Billing        | 0    | **Absent.** No Stripe, plans, quotas, or trials                  |
| AI cost control| 9    | Per-user + per-tenant budgets + invocation log — excellent       |
| Cron / ops     | 9    | 16 jobs, instrumented, auth-gated, idempotent                    |
| Observability  | 7    | Sentry + audit log + cron_runs; no `/api/health`, no status page |
| Email          | 8    | Resend integrated + logged; no bounce/unsubscribe                |
| Security HTTP  | 5    | No CSP / HSTS / X-Frame-Options; proxy.ts origin check is good   |
| Compliance     | 3    | Audit log present; no GDPR delete, no /privacy, /tos, /dpa       |
| CI/CD          | 4    | Only repo-health checks; **no test / lint / type-check gates**   |
| Frontend perf  | 6    | `'use client'` overuse on heavy pages; Recharts eager-loaded     |
| **Overall**    | **5.5** | Pilot-ready, not GA-ready                                    |

**Ship blockers for GA:** Billing, self-serve signup, privacy/DPA,
CI test gate.

---

## 1. Critical findings (P0 — block GA)

### 1.1 No billing / monetization layer
**Evidence:** `grep -ri "stripe|plan_tier|subscription|invoice|trial"
app/ lib/ migrations/` returns zero relevant hits. `migrations/016_push_subscriptions.sql`
is Web Push, not revenue. `app/superadmin/tenants/new/page.tsx:110-127`
hardcodes module flags with no plan or quota.

**Impact:** Cannot charge customers. Every tenant is an indefinite free
trial. No usage-based pricing for AI, photo storage, or seats.

**Fix:** See §5 — Billing roadmap.

### 1.2 No self-serve signup
**Evidence:** Tenant creation is gated behind `/superadmin/tenants/new`
and requires a superadmin actor. No public `/signup` route exists.

**Impact:** Every new customer requires manual onboarding by staff.
Marketing site cannot convert.

**Fix:** Public signup → email verification → tenant provisioning →
14-day trial. Hook to billing in §5.

### 1.3 Missing global security headers
**Evidence:** `apps/web/next.config.ts:headers()` only rewrites
content-type for two `.well-known/` paths. No CSP, HSTS, X-Frame-Options,
X-Content-Type-Options, Permissions-Policy, or Referrer-Policy.

**Impact:** Clickjacking, protocol downgrade, DOM-XSS amplification.
Auditors flag immediately on any pen test.

**Fix:** See §6.1.

### 1.4 Legacy RLS policy `using (true)` on `loto_reviews`
**Evidence:** `apps/web/migrations/001_loto_reviews.sql:30` — predates
multi-tenancy (migration 027). If the table still receives writes, any
authenticated user reads/inserts across tenants.

**Impact:** Cross-tenant data leak.

**Fix:** Audit table use, backfill `tenant_id`, replace policy with the
029-era pattern.

### 1.5 Cron secret silent fallback
**Evidence:** `app/api/cron/*` uses `process.env.CRON_SECRET ?? ''`.
Missing env var → `Authorization: Bearer ` (empty) passes the gate.

**Impact:** Anyone can trigger crons (which run heavy queries, send
emails, mutate state) on a deploy with a forgotten env var.

**Fix:** Fail-hard guard at module top: `if (!process.env.CRON_SECRET)
throw new Error(...)`. Add startup assertion in `instrumentation.ts`.

### 1.6 No GDPR / right-to-be-forgotten endpoint
**Evidence:** Tenant *export* exists
(`/api/superadmin/tenants/[number]/export`). No matching delete /
purge endpoint. No user self-service deletion.

**Impact:** GDPR Art. 17 violation on EU customers. Hard blocker on B2B
deals with DPA requirements.

**Fix:** See §7 — Compliance.

### 1.7 No CI test / lint / type-check gate
**Evidence:** `.github/workflows/repo-health.yml` runs only
`check:migrations`, `check:manuals`, `check:deeplinks`. No `npm test`,
no `eslint`, no `tsc --noEmit`, no migration dry-run.

**Impact:** Broken code merges to main. The 1078-test Vitest suite is
dead weight if CI doesn't run it.

**Fix:** See §8 — CI/CD.

---

## 2. High-priority findings (P1)

### 2.1 Public token endpoints lack per-token throttling
- `/api/review/[token]`, `/api/anonymous-report`, `/api/scan/*` rely
  on IP-hash throttle (collusion-bypassable) + token signature.
- Add `accesses_remaining` + `last_accessed_at` columns to
  `loto_review_links` and equivalent token tables.
- Stateless inspector tokens (`lib/inspectorToken.ts`) cannot be
  revoked mid-window. Either shorten TTL or add a DB-backed
  revocation list.

### 2.2 `supabaseAdmin()` tenant-filter gap
- ~108 of 462 calls do not explicitly `.eq('tenant_id', …)`.
- Many are safe by virtue of a preceding fetch that already scoped,
  but the pattern is fragile. **Action:** custom ESLint rule that flags
  `supabaseAdmin().from(...).update|delete|select` without a tenant
  filter (with an allow-comment for cross-tenant superadmin tools).

### 2.3 `'use client'` on whole-page roots
Pages that should be RSC + small client islands but are entirely
client-rendered:
- `app/incidents/page.tsx:1` — list page, no realtime
- `app/loto/page.tsx:1` — realtime is real, but the initial fetch can SSR
- `app/page.tsx:1` — pure redirect router
- `app/admin/scorecard/page.tsx` — eager Recharts (~55KB)

**Action:** Convert top-level page to server component; lift filter UI
into a client island. Expect ~30–80 KB bundle savings per route.

### 2.4 ReviewModal lacks focus trap / `aria-modal`
- `components/ReviewModal.tsx` — Tab escapes the dialog; screen
  readers don't announce as modal.
- **Action:** Wrap with `react-aria` `useDialog`/`FocusScope` (already
  in deps) or a small focus-trap hook.

### 2.5 No `/api/health` and no status page
- Customer-facing comms during incidents are non-existent.
- **Action:** Add `app/api/health/route.ts` that probes DB, Storage, and
  AI vendor with a 2-second budget; emit JSON `{ ok, version, checks }`.
  Subscribe via Better Uptime / Statuspage.io.

### 2.6 No backup / DR runbook
- Supabase managed PITR exists by default, but cadence, retention,
  RTO/RPO targets, and tested-restore evidence are nowhere in
  `docs/runbooks/`.
- **Action:** Write `docs/runbooks/backup-recovery.md` covering Supabase
  PITR, tenant-level export workflow, RTO=4h / RPO=15m targets, and
  a quarterly tabletop restore drill.

### 2.7 Email — no bounce tracking / unsubscribe
- 17 sender modules log via `email_log`, but Resend bounce / complaint
  webhooks aren't wired.
- **Action:** Add `/api/webhooks/resend/route.ts` to verify HMAC, update
  `email_log` with `bounced`/`complained` status, suppress future sends
  to that address. Add one-click unsubscribe header (RFC 8058) on
  digest emails.

### 2.8 No tenant-level audit of module toggles
- `tenants.modules` is JSONB without trigger. Toggling a compliance
  module (e.g., disabling JHA mid-quarter) leaves no trail.
- **Action:** Trigger on `tenants` UPDATE that writes a diff to
  `audit_log`.

### 2.9 Sparse `loading.tsx` and `error.tsx` coverage
- Only top-level `app/error.tsx` and a couple of Suspense boundaries.
- **Action:** Add segment-level `loading.tsx` for slow routes
  (`departments`, `equipment`, `risk`, `incidents`, `chemicals`).

---

## 3. Medium-priority findings (P2)

| # | Area | Finding | Fix |
|---|------|---------|-----|
| 3.1 | Frontend | Supabase photo `<Image>` missing `sizes` | Add responsive `sizes` to `PlacardPhotoSlot`, `SpacePhotoSlot` |
| 3.2 | Frontend | Recharts eager on `/admin/scorecard` | `next/dynamic` with `ssr:false` |
| 3.3 | Tests | No page-level tests for `/loto`, `/incidents`, `/admin/scorecard` | Add RTL tests w/ mocked Supabase realtime |
| 3.4 | AI | No model fallback (Claude outage = feature outage) | Wrap `generate-*` routes with retry → cheaper-model fallback → graceful "AI unavailable, save draft" UX |
| 3.5 | AI | `ai_invocations_cache_columns` (migration 128) exists but no hit-rate dashboard | `/superadmin/ai/cache` view; revisit prompt structure to maximize hits |
| 3.6 | Email | Hardcoded `onboarding@resend.dev` fallback | Verify `SUPPORT_FROM_EMAIL` set on every deploy; fail-hard if absent in prod |
| 3.7 | Storage | Legacy unscoped Snak King data at bucket root | Tracked acceptable; document explicit retirement date |
| 3.8 | Migrations | `029_rollback.sql` orphan file | Document or remove |
| 3.9 | Frontend | Realtime subscription cleanup unverified on `/status/page.tsx` | Add unsubscribe in `useEffect` return |
| 3.10 | Onboarding | No welcome flow or empty-state product tour | Add `react-joyride`-style first-run tour gated on `profiles.onboarded_at` |
| 3.11 | Docs | No SLA, no public changelog page, no `/help` redirect target | Hook `/whats-new` to a public marketing changelog feed |

---

## 4. Features missing for industry-standard SaaS

These aren't bugs — they're table stakes for a B2B SaaS that the
codebase doesn't yet have.

### 4.1 Account & access
- **Self-serve signup** with email verification + magic link option
- **SSO / SAML** (Okta, Azure AD) — enterprise gate
- **SCIM 2.0** user provisioning for enterprise tier
- **MFA / TOTP** (Supabase Auth supports natively — wire the UI)
- **Session management UI** (list/revoke active sessions)
- **API tokens** for tenant integrations (RLS-scoped PATs)

### 4.2 Billing
- Stripe Customer + Subscription per tenant
- Plan tiers (Free, Team, Business, Enterprise) gated by
  `tenants.plan_id` joined to a `plans` table
- Per-seat and per-module pricing options
- Usage-based metering for AI tokens (already logged in
  `ai_invocations`) and storage GB
- Trial flow: 14-day trial → card capture → auto-convert
- In-app billing portal (Stripe Customer Portal embed)
- Webhook handler for `invoice.paid`, `subscription.deleted`,
  `payment_failed` (dunning state machine)

### 4.3 Customer success & retention
- Onboarding checklist (per-module)
- In-app announcements (already exists as `ReleaseNotesBanner` —
  extend to per-segment targeting)
- NPS / CSAT prompts (already have feedback table)
- Help-center search hooked to wiki
- Public roadmap / changelog (`/changelog` page)

### 4.4 Observability for customers
- `/status` public page (separate from internal `/status` route — name
  collision risk)
- Per-tenant usage dashboard (seats, AI tokens, storage, alerts)
- Email digest of activity

### 4.5 Compliance & trust
- Privacy policy at `/privacy` (file exists, populate with real terms)
- Terms of service at `/terms` (exists)
- DPA template downloadable from `/legal/dpa`
- SOC 2 Type II — kick off audit (Vanta / Drata recommended)
- Trust page listing certifications, sub-processors, security controls
- Vulnerability disclosure (`/security.txt`)

### 4.6 Mobile parity
- `packages/core` exports business logic but no Expo app shipped.
  Decide: ship Expo or rely on PWA install? If Expo, build minimal:
  scan QR → equipment detail → photo upload → sign placard. Reuse
  `@soteria/core` types.

### 4.7 Integrations
- Slack notifications (incidents, near-misses)
- MS Teams webhook (same)
- Zapier / Make.com (use `webhook_deliveries` infra)
- Public REST API with OpenAPI spec
- ERP connectors (SAP EHS, Intelex) — long-term

### 4.8 Data & analytics
- Tenant-level reporting export (already partial via PDFs)
- Power BI / Tableau connector via Supabase Postgres replica
- Embedded analytics dashboards (Cube.dev or Metabase iframe)

### 4.9 Internationalization
- `lib/markdown.ts` and `SpanishTranslationSheet.tsx` hint at i18n;
  no full i18n framework. Add `next-intl` with English default and
  Spanish for placards/JHA at minimum.

---

## 5. Billing roadmap (sequenced)

Implementation plan for §1.1 / §4.2:

**Phase B1 (week 1) — schema + Stripe customer link**
1. Migration: `plans` table (id, name, monthly_cents, included_seats,
   included_ai_tokens, included_storage_gb, module_caps JSONB)
2. Migration: add `tenants.plan_id`, `tenants.stripe_customer_id`,
   `tenants.trial_ends_at`, `tenants.subscription_status`
3. Seed plans: free / team / business / enterprise (sales)
4. Stripe Customer creation on tenant create
5. `/api/billing/portal` returning a Stripe portal URL

**Phase B2 (week 2) — entitlement enforcement**
1. `lib/entitlements.ts` — single source of truth: `canUse(tenantId,
   feature)`, `seatsRemaining(tenantId)`, `tokensRemaining(tenantId)`
2. Wire into `ModuleGuard` for module access
3. Wire into AI rate-limit (extends `lib/ai/rateLimit.ts` budget cap)
4. Wire into seat add (`/api/admin/users` invite)

**Phase B3 (week 3) — checkout + trial**
1. Public `/signup` → create tenant, create Stripe Customer, start
   14-day trial (no card required)
2. In-app upgrade flow with Stripe Checkout for paid plans
3. Card-capture nudge banner at trial day 11
4. Webhook handler for subscription events + dunning state

**Phase B4 (week 4) — usage metering & invoicing**
1. Aggregate AI tokens daily from `ai_invocations`; report to Stripe
   metered subscription items
2. Storage GB metering from Supabase storage usage API
3. Seat-count metering on `tenant_memberships`
4. Customer-visible usage dashboard at `/settings/usage`

---

## 6. Security hardening plan

### 6.1 HTTP headers (P0)
Add to `next.config.ts` `headers()`:

```
Content-Security-Policy: default-src 'self';
  script-src 'self' 'unsafe-inline' https://*.sentry.io;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://*.supabase.co;
  connect-src 'self' https://*.supabase.co https://*.sentry.io
              https://api.anthropic.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(self),
                     payment=(self)
```
Roll out CSP in `report-only` mode first → 2 weeks → enforce.

### 6.2 Token endpoints (P1)
- Add `accesses_remaining`, `last_accessed_at`, `max_accesses_per_hour`
  to `loto_review_links`. Enforce at route handler.
- Shorten default inspector token TTL from 30 days → 24 hours; provide
  re-issue flow.

### 6.3 Secrets posture
- Fail-hard if `CRON_SECRET`, `INTERNAL_PUSH_SECRET`,
  `INSPECTOR_TOKEN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` are missing in
  production. Validate at `instrumentation.ts` boot.
- Rotate secrets quarterly via documented runbook.

### 6.4 RLS audit
- Backfill `loto_reviews` with tenant_id and replace `using (true)`.
- Custom `ai_invocations_cross_tenant_check` regression test that
  runs in CI and tries to read another tenant's rows with each policy.

### 6.5 Vulnerability scanning
- Add Dependabot grouped weekly PRs for `npm`, `github-actions`,
  `supabase` deps.
- Add Snyk or GitHub Advanced Security secret scanning.
- Add `npm audit --audit-level=high` to CI.

---

## 7. Compliance plan

### 7.1 GDPR
- `/api/account/delete` — user self-service; soft-delete + 30-day grace
- `/api/superadmin/tenants/[number]/delete` — tenant-level purge with
  audit-log retention exception (immutable for 7 years)
- `/api/account/export` — DSAR; returns ZIP of profile + activity
- Cookie banner only if non-essential cookies added (currently none —
  document in privacy policy)

### 7.2 SOC 2 Type II readiness
- Engage Vanta / Drata to map existing controls
- Document: access management, change management, vendor risk
  register, incident response runbook
- 6-month observation window starts ~Q3 2026 if engaged Q2

### 7.3 Public trust artefacts
- Populate `/privacy`, `/terms` with reviewed text (lawyer)
- Add `/legal/dpa`, `/legal/sub-processors`
- Publish `/.well-known/security.txt`
- Add `Trust` page linked from footer

---

## 8. CI/CD plan

Replace `.github/workflows/repo-health.yml` (or add second workflow)
to run on every PR:

```yaml
jobs:
  validate:
    steps:
      - npm ci
      - npm run check:repo
      - npm --workspace web run lint
      - npm --workspace web exec tsc --noEmit
      - npm --workspace web run test
  migrations:
    steps:
      - supabase db start
      - supabase migration up
      - supabase test db
  preview:
    needs: [validate, migrations]
    if: github.event_name == 'pull_request'
    steps:
      - vercel pull --environment=preview
      - vercel build
      - vercel deploy --prebuilt --token=$VERCEL_TOKEN
```

Add branch protection:
- Require `validate` + `migrations` green
- Require 1 approval
- Disallow force-push to `main`

---

## 9. Performance plan

### 9.1 Bundle reduction
- Convert page-root client components to server components (§2.3)
- Dynamic-import Recharts, pdf-lib on routes that don't render PDFs
  on first paint (most are already lazy — audit `/admin/scorecard`)
- Audit `lucide-react` tree-shaking — confirm only used icons ship

### 9.2 Image discipline
- Lint rule: `next/image` requires `sizes` for non-`fill` Supabase URLs
- Use `priority` only on LCP image

### 9.3 Database
- `EXPLAIN ANALYZE` audit on hottest queries (dashboard stats,
  equipment list, incidents list). Add covering indexes where Seq
  Scan + Filter dominates
- Materialized view for tenant dashboard counts; refresh every 5 min

### 9.4 Caching
- Use `unstable_cache` + `revalidateTag('tenant:'+id+':modules')` for
  module flag lookups (currently fetched on every page render)
- Edge cache public marketing pages

---

## 10. Roadmap (6-week plan to GA)

| Week | Focus                                          | Outcome                                              |
|------|------------------------------------------------|------------------------------------------------------|
| 1    | Security headers + CSP report-only; CI gates   | Pen-test cleanup; merge safety                       |
| 1–2  | Billing schema + Stripe Customer linking       | Tenants have `stripe_customer_id`, plan tier         |
| 2    | Entitlements module + module gate wiring        | `canUse()` everywhere; AI budget uses plan limit     |
| 2–3  | Public `/signup` + trial state machine          | New tenant in <60 s with email verification          |
| 3    | Stripe Checkout + Customer Portal               | Self-serve upgrade & cancel                          |
| 3–4  | Dunning + usage metering reporters              | Failed-payment lifecycle; metered seats / AI / GB    |
| 4    | GDPR delete + export endpoints                  | Right-to-be-forgotten compliant                      |
| 4    | Privacy/Terms/DPA published                     | Legal sign-off                                       |
| 4–5  | `/api/health` + public status page              | Customer-facing incident comms                       |
| 5    | Frontend perf pass (RSC conversion, image fix)  | LCP < 1.8 s on equipment list                        |
| 5    | Tests for critical pages + AI fallback          | CI confidence + Claude outage degrades gracefully    |
| 6    | Backup runbook + restore drill                  | RTO/RPO documented and tested                        |
| 6    | SOC 2 kickoff with Vanta                        | Control gap analysis complete                        |

---

## Appendix A — Detailed findings from sub-audits

The three deep-dive reports that fed this plan are summarized inline.
If you want the full reports preserved in the repo for future
reference, they are in this branch's git history (search commit
message "Audit transcripts" — none added yet; reach out if you want
them committed).

## Appendix B — What works (so we don't break it)

Don't regress these strengths:

- 138 numbered, idempotent migrations with documented security posture
- Multi-tenant RLS pattern (027 → 032) including header-scoped
  superadmin reads
- Function hardening (124) — `search_path` pinned, EXECUTE revoked
- AI rate limit + per-tenant daily budget cap (`lib/ai/rateLimit.ts`)
- Cron instrumentation (`lib/cronInstrumentation.ts`) — auth, idempotency,
  Sentry tagging, `cron_runs` audit
- `proxy.ts` CSRF defence with explicit, justified bypass list
- 17 Resend email senders all routed through `email_log`
- Audit log triggers (`migrations/003`) on every domain table
- Tenant export (`/api/superadmin/tenants/[number]/export`)
- 1078-test Vitest suite (just needs to run in CI)

These are competitive-moat assets. The plan above adds the SaaS
wrapper without touching the engine that already works.
