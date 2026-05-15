# End-to-End Platform Performance Audit

Date: 2026-05-13
Commit audited: 8390488 (`main`)
Production target sampled: https://soteriafield.app

## Executive Summary

The platform builds successfully and public unauthenticated pages respond quickly from Vercel, but the authenticated app is carrying avoidable client-side and request-path work. The dominant performance risks are:

1. Most app pages are client components, so authenticated screens pay hydration and client data-fetch cost even for read-heavy views.
2. The global chrome mounts several interactive subsystems on nearly every authenticated route.
3. Several high-value dashboards fetch broad row sets into the browser and aggregate client-side.
4. API requests repeat auth, profile, and tenant-membership checks per endpoint; pages that fan out to multiple endpoints multiply that cost.
5. Superadmin, cron, inspector, and export routes still contain all-tenant or all-record scans that should become aggregate queries, RPCs, queued jobs, or bounded paginated exports as production data grows.

This is not a "rewrite" situation. The right path is a sequence of small, measurable changes: serverize the top read routes, aggregate the analytics queries at the database/API boundary, and reduce repeated bootstrap/auth work.

## Baseline Evidence

### Build

Command:

```bash
ALLOW_DEEPLINK_PLACEHOLDERS=1 npm run build
```

Result:

- Next.js 16.2.6 with Turbopack.
- Compile completed in 8.0s.
- TypeScript completed in 11.0s.
- Static generation completed 240 pages in 875ms.
- Output size: `.next` 153 MB, `.next/static` 6.2 MB, `.next/server` 144 MB.
- Route inventory: 216 API route files, 167 page files.
- Client component inventory: 138 of 167 app pages start with `'use client'`; 333 client files across `app` and `components`.

Build note: plain `npm ci` fails on macOS arm64 because `@tailwindcss/oxide-linux-x64-gnu` is pinned as a dev dependency. `npm ci --force` was required in the clean audit clone. That is an operational friction point for local performance work.

### Public Production Sampling

Unauthenticated `curl` samples from this machine:

| Route | Status | TTFB | Total | HTML bytes |
| --- | ---: | ---: | ---: | ---: |
| `/` | 200 | 0.146s | 0.146s | 31,861 |
| `/login` | 200 | 0.465s | 0.466s | 32,002 |
| `/manuals` | 200 | 0.356s | 0.357s | 32,006 |

These numbers only cover public HTML delivery. Authenticated app behavior needs browser/Web Vitals and tenant-authenticated API timing to complete the runtime baseline.

## Findings

### P0. Risk Intelligence Loads Full Historical Tables In The Browser

Evidence:

- `apps/web/app/admin/insights/page.tsx` imports `fetchInsightsMetrics` directly into a client page and runs it from `useEffect`.
- `packages/core/src/insightsMetrics.ts:366-375` fetches:
  - all `loto_confined_space_permits`
  - all `loto_atmospheric_tests`
  - all `loto_confined_spaces`
- The comment says full test history is needed for baselines, but the browser should not be responsible for that baseline computation.

Impact:

- Data volume grows with every tenant's operational history.
- Client memory, network payload, and Supabase/PostgREST latency scale with historical table size.
- The route risks becoming unusable for mature tenants.

Recommendation:

- Move insight computation behind `/api/admin/insights` or a Postgres RPC.
- Return only the computed rows needed by the UI: worst spaces, anomalies, supervisor rows.
- For anomaly baselines, create a daily/weekly aggregate table or materialized view keyed by tenant, space, gas, and date bucket.
- Add a date floor for raw reads and preserve long-term baselines in aggregate form.

### P0. Scorecard Aggregates Raw Rows Client-Side

Evidence:

- `apps/web/app/admin/scorecard/page.tsx:77-95` calls `fetchScorecardMetrics(windowDays)` from a client page.
- `packages/core/src/scorecardMetrics.ts:221-236` fetches raw permit rows, raw atmospheric test rows, and all active equipment photo statuses.

Impact:

- The scorecard is a high-traffic leadership surface, and it should get small metric payloads.
- Fetching raw rows makes payload size and render time depend on operational volume.
- Recharts adds client bundle weight to the same route.

Recommendation:

- Create `/api/admin/scorecard?windowDays=...`.
- Aggregate permit/test/equipment metrics server-side or in SQL.
- Return compact metric buckets and counts only.
- Keep Recharts isolated to the chart component with dynamic import if it is not needed above the fold.

### P0. Superadmin Health And Daily Reports Scan Large Cross-Tenant Datasets

Evidence:

- `apps/web/app/api/cron/superadmin-daily-report/route.ts:153-170` pulls up to 50,000 AI invocation rows, 20,000 webhook delivery rows, 20,000 audit rows, and all tenants.
- `apps/web/app/api/superadmin/tenant-health/route.ts:56-80` fetches tenant rows plus full membership/equipment/permit/worker/ticket/AI tenant-id rowsets and 50,000 audit log rows.

Impact:

- These endpoints scale with platform-wide table size, not with the small report output.
- They can become slow, memory-heavy, and noisy during growth or incident spikes.
- They increase service-role blast radius because every run reads broad data.

Recommendation:

- Replace row pulls with SQL aggregates grouped by tenant.
- Add or reuse daily rollup tables for AI usage, audit activity, webhook delivery, open tickets, and active permit counts.
- Keep the API response shape the same, but source it from aggregate queries.
- Add duration and row-count logging around each report section.

### P1. Global Authenticated Chrome Does Too Much On Every Route

Evidence:

- `apps/web/components/AppChrome.tsx:7-31` imports global search, drawer, command palette, support bot, assistant dock, chat header, banners, storage and update helpers, and visual utilities.
- `apps/web/components/AppChrome.tsx:122-141` mounts `AppDrawer`, `CommandPalette`, `ReleaseNotesBanner`, `SupportBot`, and `AssistantDock` for every authenticated route.
- `apps/web/components/ReleaseNotesBanner.tsx:23-47` performs a session lookup and `/api/release-notes/latest` fetch on mount.

Impact:

- All authenticated routes pay baseline JS/hydration cost for features many sessions may not use.
- Every route may trigger an informational release-note request.
- Global mounted components can create hidden fetch, event listener, and bundle-cost tax.

Recommendation:

- Lazy-load support bot, assistant dock, command palette, and release banner after idle or user intent.
- Gate release-note fetch behind an in-memory/session cache and skip it after a known recent check.
- Keep the shell lean: header, drawer trigger, tenant pill, and user menu first; optional tools later.

### P1. Auth And Tenant Bootstrap Are Repeated Across Client And API Requests

Evidence:

- `apps/web/components/AuthProvider.tsx:78-91` fetches `profiles.select('*')` for the signed-in user.
- `apps/web/components/TenantProvider.tsx:126-165` fetches `tenant_memberships.select('role, tenants(*)')`.
- `apps/web/lib/auth/tenantGate.ts:29-84` creates an anon client, calls `auth.getUser(token)`, checks profile superadmin status, then checks tenant membership.
- `requireTenantMember` / `requireTenantAdmin` are used by 133 API files.
- `requireSuperadmin` is used by 42 API files and repeats a similar token-to-user and profile check.

Impact:

- Pages that call several APIs multiply token verification, profile lookup, and membership lookup work.
- Example: `apps/web/app/chemicals/page.tsx:55-61` fans out to five API endpoints on load.
- This creates avoidable latency even when each individual endpoint is healthy.

Recommendation:

- Add a single `/api/bootstrap` endpoint returning profile, active tenant, role, tenant list, and latest release-note marker.
- Replace broad `profiles.select('*')` and `tenants(*)` with explicit column lists.
- Centralize server auth into a reusable helper that can locally verify JWTs or cache token resolution for the request lifetime.
- For multi-endpoint dashboard loads, create summary endpoints that share one gate check.

### P1. Dashboard Pages Fan Out To Multiple APIs Instead Of One Screen-Sized Payload

Evidence:

- `apps/web/app/chemicals/page.tsx:55-61` loads products, review queue, expiring inventory, approvals, and MAQ in parallel.
- `apps/web/app/risk/page.tsx:67-70` loads heatmap and top risks separately.
- `apps/web/app/incidents/[id]/page.tsx:67-88` loads the incident, people, and notifications through multiple paths.

Impact:

- Parallel fetches are better than serial fetches, but each request repeats auth, tenant checks, network overhead, and JSON parsing.
- Dashboard TTFB may look fine while user-perceived readiness waits on the slowest fan-out request.

Recommendation:

- Introduce route-specific summary endpoints:
  - `/api/chemicals/dashboard`
  - `/api/risk/dashboard`
  - `/api/incidents/[id]/overview`
- Return all above-the-fold data in one bounded payload.
- Keep detailed tabs lazy, so less-used data loads on demand.

### P1. Exports And Inspector Bundles Run Heavy Work In Request Paths

Evidence:

- `apps/web/app/api/superadmin/tenants/[number]/export/route.ts:90-104` fans out across every tenant-scoped table and selects `*`.
- `apps/web/app/api/inspector/bundle/route.ts:50-79` selects all permits and related tests for a date range, then builds the bundle in the request path.
- PDF generators are broadly present in `apps/web/lib/pdf*.ts`, with request routes importing `pdf-lib` for exports.

Impact:

- Large tenants can hit request duration or memory limits.
- Retries can duplicate heavy work.
- Inspector and export workflows are exactly the workflows most likely to be used under pressure.

Recommendation:

- Convert large exports to async jobs:
  1. enqueue export request
  2. write PDF/JSON to storage
  3. return job status and download URL
- Enforce date-range and row-count caps for synchronous exports.
- Stream JSON where possible; never build unbounded export payloads in memory.

### P2. The App Leaves Too Much Static Shell As Client-Only

Evidence:

- 138 of 167 page files are client pages.
- `/manuals` and `/manuals/[moduleId]` are client pages even though the content is read-heavy.
- `apps/web/app/manuals/page.tsx:45-56` loads the manual index after hydration.
- `apps/web/app/manuals/[moduleId]/page.tsx:36-53` loads and renders Markdown after hydration.

Impact:

- Read-heavy pages show loading spinners where server-rendered content could arrive as HTML.
- The manual expansion increased useful content, but current rendering makes users wait for auth, client JS, API fetch, and client Markdown conversion before reading.

Recommendation:

- Convert read-only manual views to server components with a small client island for superadmin edit affordances/search.
- Cache published manuals with revalidation or tag-based invalidation on publish.
- Keep draft visibility dynamic for superadmins, but serve published manuals cheaply to normal users.

### P2. Broad `select('*')` Usage In Hot Paths

Evidence:

- `loto/page.tsx:80-81`, `hot-work/page.tsx:68-70`, `equipment/[id]/page.tsx:61-79`, `permit-signon/route.ts`, inspector bundle routes, export routes, and many mutation-return paths use `select('*')`.
- Source scan found hundreds of Supabase query call sites and many `select('*')` instances.

Impact:

- Payload size grows silently as schemas expand.
- Client and API response contracts become coupled to the database row shape.
- Indexed queries still waste bandwidth when wide rows include JSON, text, or attachment metadata.

Recommendation:

- Replace hot-path `select('*')` with explicit field lists.
- Make this a lintable convention for new API/page work.
- Start with dashboard, list, and mobile/scan routes.

### P2. Local Install Is Not Reproducible On macOS Without Force

Evidence:

- `npm ci` failed on macOS arm64 because `@tailwindcss/oxide-linux-x64-gnu@4.2.4` is a platform-specific dev dependency for linux x64 glibc.
- `npm ci --force` succeeded.

Impact:

- Performance work often needs clean local installs, builds, and bundle checks.
- A non-reproducible install slows debugging and increases "works in Vercel, not local" drift.

Recommendation:

- Move the platform-specific Tailwind oxide package to optional dependencies if truly needed.
- Prefer the cross-platform package path expected by Tailwind.
- Add a CI/local install note only as a temporary workaround.

## Recommended Execution Plan

### Phase 1: Quick Wins

1. Lazy-load global optional chrome tools:
   - `SupportBot`
   - `AssistantDock`
   - `CommandPalette`
   - release-note fetch
2. Replace `profiles.select('*')` and `tenants(*)` bootstrap queries with explicit columns.
3. Add a per-session latest-release-note cache.
4. Convert `/manuals` and `/manuals/[moduleId]` to server-rendered read views.

Expected impact: lower baseline JS, fewer first-load requests, faster perceived load on read-heavy routes.

### Phase 2: Dashboard Aggregation

1. Build `/api/admin/scorecard` with compact aggregate payloads.
2. Build `/api/admin/insights` with SQL/server-side aggregation.
3. Add `/api/chemicals/dashboard` to collapse five requests into one.
4. Add `/api/risk/dashboard` to collapse heatmap and top-risk load.

Expected impact: fewer API round trips, smaller payloads, better behavior for mature tenants.

### Phase 3: Platform-Scale Operations

1. Replace superadmin health row pulls with grouped SQL aggregates.
2. Convert superadmin daily report to rollup tables.
3. Move tenant export and inspector bundles to async job + storage.
4. Add performance telemetry around route duration, row counts, and payload sizes.

Expected impact: stable admin/cron performance as tenants and audit logs grow.

## Suggested Performance Guardrails

- Add a code-search check for new `select('*')` in `apps/web/app/api`, except mutation-return paths with an explicit justification.
- Add route timing logs for API routes that return over 500ms.
- Add payload-size logging for dashboard endpoints.
- Add Supabase `EXPLAIN` review for any new list endpoint over 100 rows.
- Add Lighthouse/Web Vitals smoke checks for:
  - `/login`
  - `/`
  - `/manuals`
  - `/admin/scorecard`
  - `/chemicals`
  - `/equipment-readiness/scan`

## Verification Performed

- `npm ci` attempted and failed due platform-specific Tailwind oxide package.
- `npm ci --force` succeeded.
- `ALLOW_DEEPLINK_PLACEHOLDERS=1 npm run build` passed.
- Production public HTML sampled with `curl`.
- Source scans completed for:
  - API route count
  - client page count
  - Supabase query patterns
  - heavy dependencies
  - auth gate reuse
  - large line-count modules

