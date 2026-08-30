# Scalability Audit & Hardening Plan — Path to 6,500 Users

**System:** lotoviewer (SoteriaField) — multi-tenant Next.js (App Router) + Supabase/Postgres safety SaaS
**Target:** 6,500 users distributed across tenants
**Method:** 4 parallel specialist agents (DB/RLS, front-end fetch, request lifecycle, background/crons) + direct DB stress testing (`EXPLAIN ANALYZE` at synthetic scale, `pg_stat_statements` production profile, Supabase advisors)
**DB audited:** Soteria Main Project (`zwtnpyjifbdytlektxlc`) — the live app database

---

## 1. Verdict

**Not in its current state — but the gaps are concentrated and fixable without an architectural redesign.** The bones are sound: a correct tenant-scope RLS pattern (`tenant_id IN (select current_user_tenant_ids())`), HTTP/PostgREST connection amortization, build-time reference data (FEATURES/nav catalogs), and `audit_log` already carries the ideal composite index as a template. What breaks at 6,500 users is a short list of **per-row RLS evaluation, missing indexes, an uncached dashboard fan-out, unbounded background jobs, and unbounded table growth** — all addressable with policy rewrites, indexes, a caching layer, job batching, and retention.

**Caveat that sets priority — tenant size distribution.** Current data is trivial (6 tenants, 30 members, max 17/tenant). "6,500 across tenants" has two very different shapes:
- **Many small tenants** (e.g. ~50/tenant → ~130 tenants): the dominant risks are **aggregate dashboard QPS**, **Realtime**, and **per-row RLS cost on shared tables** (`audit_log`).
- **A few large tenants** (hundreds–1,000+ members): the **matrix/list seq-scans and missing composite indexes** bite hard *per tenant* (see §3). 
Confirm the expected distribution; it reorders Phase priorities. The plan below covers both.

---

## 2. Methodology & load model

- **Projection driver:** 6,500 users ≈ **217×** today's 30 members. Current latency is meaningless; we audited **structure** — query plans, index coverage, RLS evaluation cost, fan-out counts — and projected.
- **Concurrency assumption:** ~10% concurrent peak = **650 concurrent users** (shift-change spikes in safety apps can exceed this); full-online worst case = 6,500.
- **What this environment could NOT test:** true HTTP concurrency (1,000s of simultaneous sessions). That requires a **k6/artillery load test against staging** — see §6. Everything here is plan-shape and capacity analysis, which catches the issues that *explode* at scale even when they look instant at 30 members.

---

## 3. Stress-test results (measured)

### 3.1 Training-matrix view — 29 s at a 1,000-member tenant (P0, proven + fixed)
Synthetic large tenant (1,000 members × 20 required courses = 15,000 records), running the shipped `v_training_matrix` query shape:

| Scenario | Execution time | Buffer hits |
|---|---:|---:|
| As shipped, no composite index | **29,229 ms** | 4,620,018 |
| + index `(tenant_id, course_id, member_id)` | **157 ms** | 135,000 |

**186× faster from one index.** The plan revealed the cause: the lateral-join predicate `member_id = m.id OR (member_id IS NULL AND lower(btrim(worker_name)) = lower(btrim(display_name)))` — the `lower()` name-fallback — forced a **Seq Scan of the entire records table for each of the 20,000 member×course pairs** (300M row touches). With the composite index, Postgres uses a `BitmapOr` of two index scans and the `lower()` recheck only touches the few `member_id IS NULL` rows.
**Confirmed gap:** the real `loto_training_records` has only `(tenant_id, member_id)` and `(tenant_id, course_id)` *partial* indexes — **not** the composite the lateral join needs. Compounding factors: the view is `security_invoker` (re-runs under RLS every request) and the page does `select('*')` with no pagination, shipping members×courses rows to the browser.

### 3.2 Production query profile — Realtime dominates (P1)
`pg_stat_statements` at just 30 members: **Supabase Realtime WAL decoding = ~74% of all DB execution time** (`SELECT wal->>...`: 308k calls / 1,301,892 ms = 67.9%, + a second variant at 6.2%). This scales with **write volume × subscriptions**, and the app holds **per-viewer `postgres_changes` subscriptions** on `loto_equipment` (see §4). Secondary noise: repeated PostgREST schema-cache reloads (654× `pg_timezone_names` @133ms; 435× function-introspection @218ms returning 77k rows) on the 265-table/360-policy schema.

### 3.3 Dashboard QPS projection (P0)
Home dashboard = **~30 Supabase round-trips per render** and **~14.6 round-trips/user/minute** steady-state (6 self-fetching panels, each its own `setInterval`, none visibility-gated, no caching, all browser-direct-to-DB).
- At **650 concurrent**: ≈ **190 QPS** against Postgres from dashboards alone — every query RLS-evaluated.
- At **6,500 online**: ≈ **1,900 QPS**.
A single cached server-side aggregation per tenant collapses this to per-tenant-per-minute compute (≈ 99% reduction).

---

## 4. Bottlenecks — consolidated, severity-ranked

### P0 — Will break or severely degrade at 6,500 users

| # | Area | Finding | Evidence |
|---|---|---|---|
| **P0-1** | DB / RLS | **Per-row re-evaluation of RLS helpers.** 307 policies call bare `is_superadmin()`, 195 bare `active_tenant_id()`, 51 bare `auth.uid()` — not wrapped in `(select …)`, so they run **once per candidate row** instead of as a one-time InitPlan. On `audit_log` (75 MB) this is up to one `profiles` lookup *per row scanned*. Advisor flags 51 `auth_rls_initplan` on 30 tables. | `pg_policies`; advisor `auth_rls_initplan` |
| **P0-2** | DB / index | **43 tenant-scoped tables lack a `tenant_id` index** → every RLS read is a Seq Scan filtered by `tenant_id = active_tenant_id()`. Multiplies with P0-1. | advisor `unindexed_foreign_keys` (43 `*_tenant_id_fkey`) |
| **P0-3** | DB / index | **Matrix view missing composite `(tenant_id, course_id, member_id)`** → 29 s at 1,000 members (§3.1). | measured |
| **P0-4** | Front-end | **Dashboard fan-out, uncached** — ~30 round-trips/render, ~190 QPS @650 (§3.3). Metrics helpers download whole tables and count client-side. | `MultiModuleDashboard.tsx`, `homeMetrics.ts:526`, 6 `*KpiPanel` |
| **P0-5** | Request | **3 serial round-trips per navigation** (Auth→Tenant→Facility), **hard page-reload on every tenant/facility switch**, and `tenantGate.ts` does `getUser()` (network) + profile + membership probes on **215 API routes** with a new client per request. | `AuthProvider.tsx:78`, `TenantProvider.tsx:126,218`, `lib/auth/tenantGate.ts:45` |
| **P0-6** | Background | **Email fan-out with no rate-limit / queue / backoff.** 19 Resend senders fire all sends in parallel; Resend caps ~2 req/s → mass 429s treated as normal failure → **silent reminder loss until next daily tick**. `risk-review-reminders` uses `Promise.all` (one throw aborts the batch). | `lib/email/*`, `*-reminders/route.ts` |
| **P0-7** | Background | **Unbounded cron handlers** — loop all tenants/rows with no `maxDuration` and no `.limit()`; timeout leaves partial state. Scariest: `osha-ita-auto-submit` (regulatory filings). | `incident-trends-weekly`, `osha-ita-auto-submit`, `check-regulation-updates`, `check-sds-revisions` |
| **P0-8** | Growth | **`audit_log` + `cron_runs` unpartitioned, unbounded, no retention.** audit_log ~355 rows/day at 30 members → ~28M rows / 8–10 GB per year at scale; single heap. | `pg_stat_user_tables`; `migrations/056` notes pruning "isn't included" |

### P1 — Serious degradation

- **Realtime = 74% of DB time** (§3.2) + per-viewer `postgres_changes` on `loto_equipment` (`loto/page.tsx:160`, `status/page.tsx:46` — the latter *also* 30 s-polls, so the channel is redundant). A 50-person crew on the LOTO board = 50 replication-fed channels.
- **407 unindexed foreign keys** (write-amplification on `DELETE`/key-`UPDATE`, slow joins) — index the ~50–80 that are actually queried/deleted-through; skip decorative audit columns.
- **Missing composite indexes** for hot filter shapes: `(tenant_id, created_at desc)`, `(tenant_id, status)`, `(tenant_id, expires_at)` on permits/incidents/equipment/auths. `audit_log` already models this (`idx_audit_log_tenant_time`).
- **74 "multiple permissive policies"** across 61 tables OR-evaluated per row — **`profiles` has 10** (hot path of nearly every request); several chat/assistant tables have 3 each.
- **Metrics helpers download entire tables and count client-side** (`fetchRiskMetrics`, `fetchNearMissMetrics`, `fetchJhaMetrics`, scorecard 6 unbounded reads, `fetchBBSMetrics` `.limit(2000)`).
- **Matrix `select('*')` no pagination**; **manuals/wiki + `/qr/[token]` rendered live/dynamic, uncached** (CDN-cacheable content).
- **Cron N+1s** (`chemicals-weekly-digest:251` `getUserById` per admin; `incident-investigation-sla`; `equipment-readiness-reminders`); **`invite-reminders` pages all ~10k auth users every run** regardless of workload.

### P2 — Hygiene (do during cleanup)

- **317 unused indexes** / 174 tables (write+vacuum overhead) — drop confirmed duplicates first (`loto_equipment` dept dup; redundant `idx_audit_log_tenant`); re-evaluate the rest after real traffic (stats unreliable on a tiny DB).
- **Security advisors:** 2 ERRORs (`rls_disabled_in_public` on `_photo_backup_pre_v2`, `em385_project_number_sequences`; `security_definer_view` on `loto_placard_publishable_status`); 5 `rls_enabled_no_policy` (confirm `tenant_secrets` access path); 70 SECURITY DEFINER functions executable by anon/authenticated (revoke where unintended); leaked-password protection off; 2 public buckets allow listing.
- **Auth pinned to 10 absolute connections** vs `max_connections=90`; move to percentage allocation + ensure pooler.
- **PostgREST schema-cache reload churn** (§3.2) — avoid unnecessary `notify pgrst, 'reload schema'`.

---

## 5. Hardening plan (phased, by leverage)

### Phase 0 — Quick wins, low risk (days) — mostly online, non-blocking
1. **Add the missing indexes** with `CREATE INDEX CONCURRENTLY` (no table lock):
   ```sql
   -- matrix (P0-3): 186× on the matrix view
   create index concurrently idx_ltr_tenant_course_member
     on public.loto_training_records (tenant_id, course_id, member_id);
   -- tenant_id on the 43 tenant tables lacking it (P0-2), composite where time-ordered (P1)
   create index concurrently idx_<t>_tenant_created on public.<t> (tenant_id, created_at desc);
   ```
2. **Retention jobs** (pg_cron, model the existing `prune_anon_report_ip_attempts`): `delete from cron_runs where started_at < now() - interval '30 days'`; `delete from audit_log where created_at < now() - interval '12 months'` (or archive).
3. **Drop duplicate/redundant indexes** (`loto_equipment` dept dup, `idx_audit_log_tenant`).
4. **Add `export const maxDuration = 300`** to the unbounded crons; switch `risk-review-reminders` `Promise.all` → `allSettled`.
5. **Resolve the 2 security ERRORs** and confirm `tenant_secrets` is service-role-only.

### Phase 1 — RLS + caching (1–2 weeks) — the biggest wins
6. **Wrap every bare helper call in `(select …)`** across ~300 policies (P0-1) — mechanical and scriptable from `pg_policies` (`regexp_replace(qual,'is_superadmin\(\)','(select is_superadmin())')`, same for `active_tenant_id()`, `auth.uid()`, `active_facility_id()`). Behavior-preserving; verify with a policy-diff test + spot `EXPLAIN`. Fixes the 51 `auth_rls_initplan` lints and removes per-row profile lookups on every large table.
7. **Consolidate the multiple-permissive policies**, starting with `profiles` (10 → 1–2).
8. **One cached `whoami`/tenant-context endpoint** (cookie/edge-cached, short TTL) hydrating Auth/Tenant/Facility from a single payload; **stop the hard-reload** on tenant/facility switch (request-id guard instead). Verify JWT locally in `tenantGate.ts` instead of `getUser()`; reuse a module-scoped admin client (P0-5).
9. **Single cached server-side dashboard aggregation** per `(tenant, facility)` (`unstable_cache`/`revalidate 30–60 s`); **visibility-gate** all dashboard polls; dedupe the 4 equipment count queries into one (P0-4). Collapses ~190 QPS to near-zero.

### Phase 2 — Background + write-path + Realtime (1–2 weeks)
10. **One throttled, retrying email gateway** (module-level Resend behind `p-limit(2)`/token bucket + 429/`Retry-After` backoff + `email_log` idempotency); move fan-out into a **queue table drained by a bounded cron** (P0-6).
11. **Bound every unbounded cron** to a cursor/drip (`.limit(BATCH)` + watermark), reusing the existing `run-assistant-tasks`/`loto-audit-resume` pattern; prioritize `osha-ita-auto-submit`. Kill the cron N+1s (bulk `.in()`); scope `invite-reminders` to candidate IDs (P0-7, P1).
12. **Realtime diet:** drop the redundant `postgres_changes` channel on the status board (it already polls); prefer Broadcast/a single shared tenant channel over per-viewer `postgres_changes`; audit which subscriptions are essential (addresses the 74%).
13. **Partition `audit_log` by month** (range on `created_at`) with a rolling create/drop job, before a rewrite needs a maintenance window (P0-8).
14. **Index the ~50–80 FKs that matter**; add `(tenant_id, status)` / `(tenant_id, expires_at)` composites (P1).

### Phase 3 — Structural + capacity (ongoing)
15. **Move the hottest client reads to RSC/API + cache** (loto register, dashboards) so reads become poolable/shareable; convert metrics helpers to server-side aggregates or per-tenant materialized summary rows; **materialize the matrix view** refreshed on completion writes; paginate it.
16. **Cache manuals + `/qr/[token]`** (long-TTL for manuals; short `s-maxage`+SWR for placards, split the scan-log write from the cached read).
17. **Connection/infra:** confirm Supavisor **transaction-mode** pooler for any direct-driver worker (the email drainer), right-size PostgREST `db-pool`, move Auth off the 10-absolute cap; consider a **Postgres plan-tier bump** (`max_connections=90` is small for this scale).
18. **Observability + load testing:** see §6.

---

## 6. Beyond fixes — recommendations

- **Run a real load test before launch.** This audit is structural; it can't prove behavior under 650–1,300 concurrent HTTP sessions. Build a **k6/artillery** scenario against staging that exercises login → dashboard → a large-tenant list → matrix → a write, seeded with a **realistic large tenant** (use the §3.1 generator). Watch p95/p99 latency, PostgREST pool saturation, Realtime CPU, and the 90-connection ceiling.
- **Seed a representative scale dataset in staging** (a few large tenants + many small) so every future EXPLAIN/test reflects reality, not 30 members.
- **Stand up query observability:** alert on `pg_stat_statements` top-N by total time, slow-query log, per-tenant QPS, and Realtime CPU. The Realtime 74% and the matrix 29 s would both have been caught by this.
- **Add a `CREATE INDEX CONCURRENTLY` / `EXPLAIN` gate** to the migration review checklist for any new tenant-scoped table or hot query (the schema already has a migration-number guard — extend the discipline to indexes + the `(select …)` RLS pattern).
- **Capacity guardrails:** cap matrix/list result sets server-side; enforce pagination on any `select('*')` over a per-user-growth table; budget AI/email crons per tenant, not globally.
- **Re-run the Supabase advisors** (`get_advisors` security + performance) in CI or monthly — they already surface `auth_rls_initplan`, `unindexed_foreign_keys`, `multiple_permissive_policies`, `unused_index` for free.

---

## 7. Bottom line
The platform's architecture can reach 6,500 users; its current **configuration** can't. The path is **indexes (Phase 0) → RLS `(select …)` wrapping + dashboard/auth caching (Phase 1) → background batching + Realtime diet + partitioning (Phase 2) → structural caching + a real load test (Phase 3).** Phases 0–1 alone remove the failure modes that would surface first (the 29 s matrix, ~190 QPS dashboards, per-row RLS scans, the 3-round-trip bootstrap), and none of it requires a redesign.
