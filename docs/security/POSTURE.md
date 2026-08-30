# SoteriaField Security Posture

_Last reviewed: 2026-07-28. Owner: platform team._

This document is the customer-facing summary of how SoteriaField protects sensitive data. It is intended for due-diligence reviews. Each section names the control, the implementation file(s), and the verifiable test or check.

## 1. Architecture overview

SoteriaField is a multi-tenant Next.js + Supabase application. Tenants are isolated at four layers:

1. **Authentication.** Every authenticated request carries a Supabase JWT in `Authorization: Bearer …`. The JWT is verified server-side on every request — there is no client-side trust path.
2. **Tenant gate** (`apps/web/lib/auth/tenantGate.ts`). The active tenant is supplied in the `x-active-tenant` header and verified against `tenant_memberships` for the JWT's user. Forged headers fail the membership check before any data is fetched.
3. **Postgres Row-Level Security** (`apps/web/migrations/*.sql`). Every domain table has an RLS policy that restricts rows to the active tenant via `active_tenant_id() = tenant_id`. Tenants cannot read each other's rows even if the application layer mis-routes a query.
4. **Per-row tenant filter** in service-role calls. Where the application uses the service-role client (`supabaseAdmin()`) to bypass RLS for legitimate reasons (cron jobs, webhook delivery), every query carries an explicit `eq('tenant_id', gate.tenantId)` predicate.

Compromising one layer does not by itself expose data.

## 2. Authentication and session management

- Sessions are managed by Supabase Auth (`@supabase/supabase-js`). JWTs are short-lived; refresh is handled client-side.
- Bearer tokens are required on all `/api/*` routes except the public anonymous-intake (`/api/anonymous-report/*`), public review portal (`/api/review/[token]`), and webhook receivers.
- Superadmin status requires **both** the `is_superadmin` flag in `profiles` and the user's email present in the `SUPERADMIN_EMAILS` deploy env var. Compromising one is insufficient.
- `is_admin` (platform admin, distinct from tenant admin) is reserved for internal staff and never granted to tenant users. Audited quarterly.
- `profiles.is_admin`, `profiles.is_superadmin`, `profiles.email` and `profiles.id` are writable only by the service role. Enforced in the database by the `trg_profiles_guard_privileged_columns` trigger (`migrations/249_profiles_privileged_columns.sql`), because an RLS `UPDATE` policy is row-scoped and cannot restrict which columns move. Self-service edits (name, avatar, onboarding, password-change flag) are unaffected.
- Post-authentication redirects are constrained to same-origin paths by `lib/security/safeRedirect.ts`.

## 3. Cross-tenant isolation

Every domain table is protected by RLS using the `active_tenant_id()` PL/pgSQL function (set from the `x-active-tenant` header on each session). Sample policies are visible in migrations 001 (incidents), 005 (storage), 037 (risks), 069 (toolbox-talks), 081 (BBS), 089 (chemicals), and others.

Service-role queries that bypass RLS are audited in `apps/web/lib/supabaseAdmin.ts` callers. Each call site filters by `tenant_id = gate.tenantId`. Regression coverage:

- `apps/web/__tests__/proxy.test.ts` — Origin/Host CSRF defence. (Next.js 16 renamed the `middleware` convention to `proxy`; this file was previously listed here under its old name.)
- `apps/web/__tests__/lib/auth/superadmin.test.ts` — both superadmin gates: the `SUPERADMIN_EMAILS` env allowlist and the `profiles.is_superadmin` DB flag.
- `apps/web/__tests__/api/invites/acceptFlow.test.ts` — invite redemption, including the already-signed-in takeover guard and the concurrent-claim race.
- Most tenant-scoped routes have a unit test asserting that a forged `x-active-tenant` returns 403. This is not yet universal; `lib/auth/tenantGate.ts` itself has no direct unit test.

### Known historical exposure window

Migration 037 (Risk Assessment schema) created the `risks` and `risk_audit_log` tables without RLS; migration 040 added the policies. Between those two migrations applying, the application layer's `eq('tenant_id', …)` filter was the only defence. If your engagement window includes that migration sequence, request the deploy timeline — both migrations were applied within the same release.

## 4. Secrets handling

| Secret | Storage | Rotation |
|---|---|---|
| Supabase service-role key | Vercel env (`SUPABASE_SERVICE_ROLE_KEY`); never exposed to client | Manual; rotate via Supabase dashboard. |
| Anthropic platform API key | Vercel env (`ANTHROPIC_API_KEY`); used when no per-tenant override is configured | Manual via Anthropic console. |
| Per-tenant Anthropic API key | Currently `tenants.settings.anthropic_api_key` (jsonb). **Scheduled for envelope encryption** — see Open Items §10. | Tenant admin updates via `/superadmin/tenants/[id]`. |
| Voyage embeddings API key | Vercel env (`VOYAGE_API_KEY`); platform-wide | Manual via Voyage console. |
| Cron secrets | Vercel env (`CRON_SECRET`, `INTERNAL_PUSH_SECRET`); compared with constant-time `safeEqual` | Rotate quarterly. |
| Anonymous-intake IP-throttle salt | Vercel env (`ANON_IP_SALT`); rotated daily by mixing with UTC date | Daily (automatic) + base secret rotated quarterly. |
| Webhook signing secrets | `loto_webhook_subscriptions.secret` (per-tenant). Used to HMAC outbound payloads. **Scheduled for envelope encryption** — see Open Items §10. | Tenant rotates manually. |
| Stripe webhook secret | Vercel env (`STRIPE_WEBHOOK_SECRET`). Verified per request via `stripe.webhooks.constructEvent`. | Manual via Stripe dashboard. |

No secret is ever read in client-side code. The Sentry DSN is the only `NEXT_PUBLIC_*` value related to error tracking, and it is a write-only ingest endpoint per the `@sentry/nextjs` docs.

## 5. File upload pipeline

Uploads go through three checks:

1. **Size cap** — enforced at the route. SDS PDFs ≤ 25 MB; signatures ≤ 200 KB; avatars ≤ 1 MB.
2. **MIME allowlist** — `Content-Type` restricted to the format's expected types.
3. **Magic-byte verification** — the decoded payload's leading bytes are checked against the format's signature (`apps/web/lib/security/magicBytes.ts`). PNG, JPEG, WebP, and PDF supported. **`Content-Type` alone is never sufficient** — the magic-byte check is the line that prevents `<html>…</html>` arriving with `Content-Type: image/png`.

Storage paths are tenant- or user-scoped (`{tenant_id}/…` or `{user_id}.{ext}`) and enforced by Storage RLS. Test coverage: `apps/web/__tests__/lib/security/magicBytes.test.ts`.

## 6. Anonymous incident intake

- **Captcha** — Cloudflare Turnstile, server-side verified. In production, requests are **rejected** when the secret is unset (`apps/web/lib/anonReport/turnstile.ts`).
- **IP throttle** — 5 attempts per 10 minutes per hashed IP. The hash is `sha256(ip || daily_salt)` where `daily_salt` rotates at midnight UTC. In production, the throttle module **throws** if `ANON_IP_SALT` is unset (`apps/web/lib/anonReport/ipThrottle.ts`) — silent fail-open is not possible.
- **Token entropy** — anonymous-intake tokens are 64 hex chars (256 bits). Review tokens are 32 hex chars (128 bits) — sufficient for the token-as-credential model but slated for widening (Open Items §10).
- **Geofence** — optional per-token geo restriction; raw IPs are never stored.

## 7. Webhooks (outbound)

- Each delivery is HMAC-signed with the tenant's `secret` and a per-payload nonce; receivers verify before trusting.
- Migration 100 is the source of truth for the schema; the firing function (`fire_webhooks()`) reads each subscription and calls `net.http_post`.
- **SSRF mitigation pending** — see Open Items §10. Until that ships, tenant-supplied webhook URLs are not validated against private IP ranges or scheme allowlist.

## 8. Logging and error reporting

- **Sentry** captures server and client exceptions. The browser config (`apps/web/instrumentation-client.ts`) installs `beforeSend` and `beforeBreadcrumb` scrubbers that replace any field whose key contains `authorization`, `cookie`, `signature_data`, `signature`, `api_key`, `password`, `token`, or `secret` with the literal `[redacted]`. The DSN endpoint is public, so on-the-wire scrubbing is necessary.
- **Error responses to clients** are sanitised through `apps/web/lib/security/sanitizeError.ts`. Raw PostgreSQL error messages (which can include relation names, constraint definitions, and parameter values) never reach the client. The full exception is captured to Sentry with a `route` tag for operator triage; the client receives a generic `{error:'internal'}` plus the appropriate status code, or one of the public-safe codes (`conflict`, `forbidden`, `not_found`, `invalid_input`, `unauthorized`).
- `console.log` use is being phased out across the codebase. As of this review, ~14 routes still emit `console.log` for transient debug output; tracked in the long-tail cleanup queue. None log secrets or signature data.

## 9. CSRF / Origin defences

- Primary defence: SameSite=Lax cookies + `Authorization: Bearer` JWT. No state-changing route reads cookies for auth.
- Secondary defence: `apps/web/proxy.ts` cross-checks `Origin` against `Host` on every POST/PATCH/PUT/DELETE under `/api/*`. Mismatches return 403. Bypass list: `/api/cron/*`, `/api/webhooks/*`, `/api/anon*`, `/api/review/*`, `/api/scan/*`, `/api/health` — each has its own primary defence (cron secret, webhook signature, captcha, token-as-credential).

## 9a. Response security headers

Set globally in `apps/web/next.config.ts`:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload` — deliberately reversible).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- `Referrer-Policy: no-referrer`. Chosen over `strict-origin-when-cross-origin` because that still sends the full URL, query string included, on same-origin requests — and the invite token travels in `/accept-invite?token=…`.
- `Permissions-Policy` denying microphone, payment and USB; camera and geolocation remain `self` for QR scanning, photo capture and incident/weather location.
- `Content-Security-Policy` enforcing `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, `form-action 'self'` — directives that constrain no scripts and so carry no breakage risk.
- `Content-Security-Policy-Report-Only` carries the fuller policy we intend to enforce. It is report-only pending a violation-collection pass; `script-src` retains `'unsafe-inline'` because Next.js injects inline bootstrap scripts.

## 10. Open items / scheduled work

The hardening pass landing alongside this document closes the customer-visible Critical and High findings. The remaining items are scheduled, with rationale below:

| Item | Severity | Why deferred | Target |
|---|---|---|---|
| Tenant API key envelope encryption (`tenants.settings.anthropic_api_key` → `tenant_secrets` table with `pgp_sym_encrypt`) | Critical | Requires KEK provisioning + customer coordination. Not yet drafted. (An earlier revision cited `migrations/114_*.sql`; that slot holds `114_strike_core.sql`, unrelated.) | Within 2 weeks. |
| `loto-photos` storage SELECT — restrict to tenant scope | Critical | Requires verification that no client component fetches via public URL. Not yet drafted. (An earlier revision cited `migrations/115_*.sql`; that slot holds `115_command_center_safety_alerts.sql`, unrelated.) | Within 1 week. |
| `fire_webhooks()` URL safety (private-IP rejection, scheme allowlist) | High | Requires audit of live tenant webhook configs to avoid breaking legit deliveries. Not yet drafted. (An earlier revision cited `migrations/116_*.sql`; that slot holds `116_strike_studio_superadmin_only.sql`, unrelated. `is_safe_webhook_url(text)` does exist, added in `165_advisor_sweep.sql`.) | Within 2 weeks. |
| Server-side page protection for `/admin` and `/superadmin` | Medium | Page gating is client-side (`components/AuthGate.tsx`); the API layer is gated server-side, so this is defence-in-depth. A server-side fix needs `@supabase/ssr` and a session-handling change across the app. | Roadmap. |
| Supabase leaked-password protection is off | Medium | Dashboard setting, not in this repo. Password length (8) is enforced server-side only on `/api/invites/accept`; `/welcome` and `/reset-password` call `supabase.auth.updateUser` from the browser, so the real policy is the project setting. | Next config review. |
| Invite lifecycle absent from `audit_log` | Medium | `invite_tokens` rows record state (`used_at`, `superseded_at`) but no actor-attributed event. | Roadmap. |
| `/api/invites/refresh` accepts arbitrarily old tokens | Low | Possession of any unused token, however stale, re-issues a link, so the 14-day TTL does not bound a leaked unused link. Bounded by the already-signed-in guard. | Roadmap. |
| `consumeInviteToken` claims on `used_at` only | Low | Does not re-check `superseded_at`/`expires_at`, leaving a narrow window after `verifyInviteToken`. Impact is accepting a link that was valid moments earlier. | Roadmap. |
| `issueInviteToken` supersede+insert is not transactional | Low | Concurrent issues can leave two active tokens. Both are single-use and claimed atomically. A partial unique index cannot be built `CONCURRENTLY` inside this repo's transactional migration convention. | Roadmap. |
| Webhook secret encryption at rest | Low | Same envelope path as the tenant API key fix. | Within 4 weeks. |
| Per-tenant Voyage API key override | Low | Feature gap, not vulnerability. | Roadmap. |
| Review token entropy 128-bit → 256-bit | Low | Requires reissue flow for live links. | Roadmap. |
| `console.log` sweep across the broader codebase | Low | Pure hygiene. | Within 4 weeks. |

## 11. Verification

- Continuous integration: `.github/workflows/repo-health.yml` runs the repository guards (migration numbering, nav/version sync, wiki sync) and a scoped **auth and security regression suite** (`npm run test:security`, 216 assertions) covering the superadmin gate, the invite lifecycle, Origin/Host enforcement, the redirect guard, the Sentry scrubber, magic-byte verification, error sanitisation and constant-time comparison. A merge is blocked if any of those fail.
- Not yet gated in CI: the full vitest suite, `eslint`, `tsc --noEmit` and `next build`. The full suite has 127 pre-existing failures and eslint 82 pre-existing errors (stale UI fixtures after the Spectrum restyle), so a blanket gate would land red; widening the gate is tracked in `docs/deferred-work.md`. An earlier revision of this document claimed CI ran `tsc --noEmit` clean with 2336/2336 vitest passing — it never did.
- The hardening pass commit (this PR) includes the full set of code changes referenced in §4–§9.
- Manual probe scripts can be supplied on request (forged `x-active-tenant`, raw-error fuzz, malformed-PNG signature, mismatched-Origin POST).

For deeper diligence questions or to schedule a live review, contact the platform team.

## 12. Medical-data confidentiality (injured-person case management)

Case management for injured persons (`incident_care_cases`, `incident_care_visits`,
and the related authorization/document tables) stores employee medical detail —
diagnosis, restrictions, treating physician, work-status. This section states the
controls and the legal frame.

### Legal frame

Employer-held workers'-compensation injury records are largely **outside** the
HIPAA Privacy Rule (the employment-records exclusion, plus the §164.512(l)
workers'-comp disclosure permission). What unambiguously binds the employer is
**ADA 29 CFR 1630.14(c)** — employee medical information must be collected
separately, stored in **separate, confidential files**, and accessed only on a
need-to-know basis — and **GINA** for genetic/family-history information. Some
states add medical-privacy statutes (e.g. California CMIA). Our standard is to
**build to the HIPAA Security Rule safeguard bar** so the ADA/GINA/state
obligations are satisfied by construction, and so we can sign a **Business
Associate Agreement** if a tenant's occupational-health clinic ever makes us a
Business Associate.

### Controls (mapped to HIPAA Security Rule safeguards)

| Safeguard | Control | Implementation |
|---|---|---|
| Access control (§164.312(a)) | Least privilege enforced **at the data layer**, not just the app. Medical rows are visible only to superadmin, tenant owner/admin, the assigned investigator, or the designated case manager. | `can_view_care_phi()` predicate; RLS on `incident_care_cases`, `incident_care_visits`, `incident_medical_authorizations`, `incident_medical_documents` (`migrations/201_care_phi_confidentiality.sql`). |
| Audit controls (§164.312(b)) | Every change is captured immutably; every authorized **read/export** is logged (Postgres has no SELECT trigger, so the API records the disclosure). | `log_audit('id')` triggers on care tables → `audit_log`; `phi_access_log` (append-only: REVOKE update/delete + immutable trigger), written by `app/api/incidents/[id]/care/route.ts`. |
| Integrity (§164.312(c)) | The access trail cannot be altered or deleted through DML. | `phi_access_log_immutable()` trigger. |
| Storage segregation | Medical files (work-status notes, FMLA, signed releases) live in a **restricted `medical-records` bucket**, separate from the investigator-visible `incident-evidence` bucket. | `incident_medical_documents` + Storage RLS (bucket provisioned via dashboard; paths `{tenant_id}/{incident_id}/{uuid}.{ext}`). |
| Authorization for disclosure | A signed release is tracked before any medical detail is shared with a carrier/employer; disclosure paths gate on an **active** authorization. | `incident_medical_authorizations`; `isAuthorizationActive()` in `packages/core/src/incidentCare.ts`. |
| Minimum necessary | The AI assistant never surfaces diagnosis to unauthorized roles, and aggregates (scorecard, cost trend) are de-identified counts/rates. | Assistant PHI rule (case-management phase); existing scorecard aggregates. |

### Scheduled (case-management roadmap)

See `docs/injury-case-management-plan.md`. Open items that touch this section:
column-level encryption for the free-text `diagnosis` field (beyond at-rest disk
encryption) and a tenant-facing BAA workflow are tracked there, not yet shipped.
