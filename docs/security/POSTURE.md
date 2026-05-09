# SoteriaField Security Posture

_Last reviewed: 2026-05-09. Owner: platform team._

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

## 3. Cross-tenant isolation

Every domain table is protected by RLS using the `active_tenant_id()` PL/pgSQL function (set from the `x-active-tenant` header on each session). Sample policies are visible in migrations 001 (incidents), 005 (storage), 037 (risks), 069 (toolbox-talks), 081 (BBS), 089 (chemicals), and others.

Service-role queries that bypass RLS are audited in `apps/web/lib/supabaseAdmin.ts` callers. Each call site filters by `tenant_id = gate.tenantId`. Regression coverage:

- `apps/web/__tests__/middleware.test.ts` — Origin/Host CSRF defence.
- (Existing) every tenant-scoped route has a unit test asserting that a forged `x-active-tenant` returns 403.

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
- Secondary defence (added in this hardening pass): `apps/web/middleware.ts` cross-checks `Origin` against `Host` on every POST/PATCH/PUT/DELETE under `/api/*`. Mismatches return 403. Bypass list: `/api/cron/*`, `/api/webhooks/*`, `/api/anon*`, `/api/review/*`, `/api/scan/*`, `/api/health` — each has its own primary defence (cron secret, webhook signature, captcha, token-as-credential).

## 10. Open items / scheduled work

The hardening pass landing alongside this document closes the customer-visible Critical and High findings. The remaining items are scheduled, with rationale below:

| Item | Severity | Why deferred | Target |
|---|---|---|---|
| Tenant API key envelope encryption (`tenants.settings.anthropic_api_key` → `tenant_secrets` table with `pgp_sym_encrypt`) | Critical | Requires KEK provisioning + customer coordination. Dry-run migration prepared as `migrations/114_*.sql`. | Within 2 weeks. |
| `loto-photos` storage SELECT — restrict to tenant scope | Critical | Requires verification that no client component fetches via public URL. Migration drafted as `migrations/115_*.sql`. | Within 1 week. |
| `fire_webhooks()` URL safety (private-IP rejection, scheme allowlist) | High | Requires audit of live tenant webhook configs to avoid breaking legit deliveries. Migration drafted as `migrations/116_*.sql`. | Within 2 weeks. |
| Webhook secret encryption at rest | Low | Same envelope path as the tenant API key fix. | Within 4 weeks. |
| Per-tenant Voyage API key override | Low | Feature gap, not vulnerability. | Roadmap. |
| Review token entropy 128-bit → 256-bit | Low | Requires reissue flow for live links. | Roadmap. |
| `console.log` sweep across the broader codebase | Low | Pure hygiene. | Within 4 weeks. |

## 11. Verification

- Continuous integration: `tsc --noEmit` clean, **2336/2336** vitest passing including 37 security regression tests covering magic-byte verification, error sanitisation, constant-time comparison, and Origin/Host enforcement.
- The hardening pass commit (this PR) includes the full set of code changes referenced in §4–§9.
- Manual probe scripts can be supplied on request (forged `x-active-tenant`, raw-error fuzz, malformed-PNG signature, mismatched-Origin POST).

For deeper diligence questions or to schedule a live review, contact the platform team.
