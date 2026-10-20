# Admin & Superadmin — audit and optimisation plan (2026-10-20)

**Repo:** `DevJ1975/lotoviewer` @ `a771446` (main) · **Version:** 1.19.0 · **Branch:** `claude/zealous-brown-nalfh2`
**Scope:** `/admin/**` (74 pages, 35 API routes), `/superadmin/**` (24 pages, 46 API routes), the gates in
`lib/auth/`, and the client shell that decides who sees them.

Four read-only reviews ran in parallel — authorization/security, database/RLS/query cost, UX and
information architecture, frontend architecture and test coverage — and every finding acted on here
was then re-verified by hand against the code. Nothing was run against the production database, so
anything that depends on live state is marked **SUSPECTED**. The baseline before any change was green:
249/249 tests in the admin, superadmin and auth suites, 0 ESLint errors, `tsc` clean, `check:repo` passing.

---

## 1. Verdict

**The server side is sound; the client side was locking customers out.**

- Every one of the 81 route handlers under `/api/admin` and `/api/superadmin` calls a shared gate. All 37
  superadmin mutations use `requireSuperadmin`; 31 of 33 admin mutations use `requireTenantAdmin` and the
  other two correctly require a superadmin. No cross-tenant IDOR was found in the service-role admin
  routes — every id-taking route filters or pre-checks `tenant_id`.
- But *who is an admin* was decided on the client from `profiles.is_admin`, the pre-multi-tenant flag.
  Migration 028 mapped it onto `tenant_memberships.role` and **nothing has written it since** — not a
  route, not a trigger, not an RPC. The drawer link, the user menu, the `/admin` landing, 56 admin pages
  and 18 module pages all read it. Every owner or admin of every tenant onboarded after migration 028
  therefore saw "Admins only." on the admin area and lost Create/Edit/Import controls on JHA, risk,
  hazardous-waste, environmental and equipment screens. Superadmins pass every check, which is why it
  was never noticed from the operator's seat. **Fixed in this PR** (§2).
- Two superadmin tools were not working or not safe: the saved-query runner refused every call with
  `42501` (the SQL function checks `auth.uid()`, the route called it as service role) and had no
  effective row cap; the push dispatcher let any legacy-flagged user broadcast to every device in every
  tenant. **Both fixed** (§2).
- One **Critical** account-takeover primitive remained in `resend-invite` — the same class the
  2026-08-28 sweep closed in its sibling route. **Fixed** (§2).
- Of the 19 application-code items in `docs/audits/auth-security-sweep-2026-08-28.md`, **13 are still
  open**, and **all 5** of its database items are still open (§4). The biggest open risk is a tenant's
  Anthropic API key being shipped in plaintext to every member's browser (§3, S1).

---

## 2. Fixed in this PR

| Commit | What | Evidence | Tests |
| --- | --- | --- | --- |
| `fix(admin): decide admin UI access by tenant role…` | `canManageTenant(role, profile)` replaces `profile.is_admin` in `AuthGate`, `AppDrawer`, `UserMenu`, `/admin` landing; wiki answer corrected | `components/AuthGate.tsx:65`, `AppDrawer.tsx:143`, `UserMenu.tsx:58`, `app/admin/page.tsx:17`; no writer of `is_admin` anywhere in `app/`, `lib/` or `migrations/` after 028 | `__tests__/lib/auth/tenantRole.test.ts` |
| `fix(auth): every page now reads the tenant role…` | `hooks/useCanManageTenant.ts`; 74 pages rewritten mechanically (3 expression shapes); `/admin/evidence/audit` filters by active tenant; push self-test button no longer admin-only | 56 files under `app/admin`, 18 under module routes; `audit/page.tsx:50-57` had no `tenant_id` filter | existing suites; lint + `tsc` clean |
| `fix(push): gate manual dispatch on self-or-superadmin…` | `/api/push/dispatch` authorised humans by `is_admin`, fan-out unscoped: legacy admin could push to all tenants; newer users got 403 on their own self-test | `app/api/push/dispatch/route.ts:29-45,97-104` (before) | `__tests__/api/push/dispatch.test.ts` (new, 8 cases) |
| `fix(admin): resend-invite no longer hands an admin the link…` | Raw invite URL returned for any never-signed-in member; accounts are global, so admin of A could set the password of a pending owner of B. Now emailed-only when another tenant shares the account; fails closed | `app/api/admin/users/[userId]/resend-invite/route.ts:136-153` (before); sibling rule at `app/api/admin/users/route.ts:146-153` | `usersResendInvite.test.ts` (+2 cases) |
| `fix(superadmin): run saved queries as the caller…` | RPC now carries the caller's bearer token so `is_superadmin()` sees them; migration **300** moves `LIMIT` inside the subquery so the 5,000-row cap applies | `migrations/127_saved_queries.sql:71-95`; `migrations/029:92-103` | `__tests__/api/superadmin/queries-run.test.ts` (new) |
| `fix(web): the error boundary's "Try again" button…` | `app/error.tsx` destructured `unstable_retry`; Next 16.3 passes `{error, reset, retry}` — the recovery button threw inside the fallback | `node_modules/next/dist/docs/…/error.md:331-332`; `client/components/error-boundary.js:113-114` | — |
| `refactor(auth): one parser for SUPERADMIN_EMAILS…` | Four hand-rolled copies (gate, tenantGate, manuals reader, daily-report mailer) → `lib/auth/superadminAllowlist.ts` | `tenantGate.ts:98`, `superadmin.ts:41`, `manuals/auth.ts:36`, `cron/superadmin-daily-report:404` (before) | `superadminAllowlist.test.ts` (new) |

**Apply by hand after merge:** `apps/web/migrations/300_exec_readonly_sql_row_cap.sql` (Supabase SQL editor).
The route fix works without it; the row cap does not.

After all commits: **340/340** tests in the admin, superadmin, auth, security and e2e-login suites;
ESLint 0 errors (3 pre-existing unused-import warnings untouched); `tsc` clean; `check:repo` and
`check:wiki` passing.

---

## 3. Open findings, ranked

Severity is about consequence. **VERIFIED** = read in the code by the reviewer and re-checked here;
**SUSPECTED** = reasoned from source but depends on production state or was not re-checked.
Effort: S ≤ ½ day, M ≤ 3 days, L = a sprint or more.

### P0 — security (do first)

| ID | Sev | Where | Problem | Fix | Eff | Conf |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | **High** | `components/TenantProvider.tsx:132` `tenants(*)`; `lib/ai/getTenantApiKey.ts:68`; `EditTenantForm.tsx:83,102` | Member-wide `tenants` read plus `select *` ships `settings.anthropic_api_key` in plaintext to every member's browser, viewers included. The client does need `settings` (risk-band config, landing). | Move the key to a service-role-only table (`tenant_secrets`), read it only in `getTenantApiKey`, strip it from `settings`; superadmin form writes through its own route. | M | VERIFIED |
| S2 | **Critical** | `migrations/049:56-65` (prior #1) | `tenant_memberships` UPDATE policy is row-scoped: an admin can PostgREST `update({role:'owner'})` on their own row, then demote the real owner. No guard trigger exists. | `BEFORE INSERT OR UPDATE` trigger modelled on `profiles_guard_privileged_columns()` (249): reject role changes to/from `owner` unless caller is already an owner of that tenant. | S | VERIFIED (policy); trigger absence VERIFIED in repo |
| S3 | **High** | `lib/auth/tenantGate.ts:141-144`; 68 mutating handlers (prior #6) | `requireTenantMember` is role-agnostic; ~68 non-GET handlers (chemicals 20, incidents 14, safety-boards 8, hazardous-waste 7, chat 4, other 15) never consult `gate.role`, so a **viewer** can archive products, edit incidents, create waste streams. RLS is no backstop (`current_user_tenant_ids()` is role-agnostic; most write via service role). ~30 admin pages also write from the browser under that RLS. | Add `requireTenantWriter` (excludes `viewer`); re-point the 68 handlers; admin-scope RLS on the tables the browser writes. Update `authGateMatrix.test.ts`, which pins today's behaviour. | L | VERIFIED |
| S4 | High | `migrations/161_cmms_integrations.sql:144-155` | `webhook_secret` and `base_url` sit under the member-wide `tenant_scope` policy; a viewer reads the secret and forges CMMS webhooks. | Admin-scope policy as migration 194 did for notification channels. | S | VERIFIED |
| S5 | High | `app/api/admin/users/route.ts:235-247` | DELETE: an admin can remove a non-last **owner** — no rank comparison. `reset-access` has the rank check (`:166`); this route and resend-invite did not. | Shared `outranks(callerRole, targetRole)` used by all three; last-owner check is count-then-write (racy) — do it in SQL. | S | VERIFIED |
| S6 | High | `superadmin …/members/[user_id]/route.ts:139-147`; `admin/users/route.ts:249,305` (prior #7, #10) | `alsoDeleteUser` keys on `last_sign_in_at` alone and ignores `getUserById` errors: a user who accepted the invite but hasn't signed in, or an API blip, gets `deleteUser`. | One fail-closed `hasOwnCredential()` using both signals, shared by cancel-invite and resend-invite. | S | VERIFIED |
| S7 | Med | `migrations/003:83`; all superadmin mutations | Trigger audit uses `auth.uid()`, null under service role: tenant disable, role change, transfer-ownership, user delete, reset-demo, export and SQL runs record **no actor**. No step-up auth, no session-age check; rate limiting only on invites, in memory. | `recordSuperadminAction(actor, action, target)` written from each route; require `aal2` (MFA) for disable/delete/transfer/SQL. | M | VERIFIED |
| S8 | High | `app/admin/platform/configuration/page.tsx:48,60,123`; `migrations/014:61` | Edits the deprecated **global** `loto_org_config` singleton (id=1) from a per-tenant admin page; readable by any signed-in user; carries the push dispatch URL/secret hint. | Move the surviving fields to `tenants.settings`; make the push config superadmin-only. | L | VERIFIED |
| S9 | Med | `app/superadmin/migrations/page.tsx:16,26-53` | The one RSC data read: `force-dynamic` `fs.readdir` with **no server auth**. AuthGate is a client wrapper; the RSC payload still renders for any request. Exposure is the migration filename list. | Serve it from a `requireSuperadmin` GET route; make the page a client fetcher like its siblings. | S | VERIFIED (code); payload exposure SUSPECTED |
| S10 | Med | 18 `publicAppUrl` copies; `superadmin/run-cron:37-43,68` | Host-header fallback when `NEXT_PUBLIC_APP_URL` is blank: `run-cron` would POST `CRON_SECRET` to `https://{Host}`. | One `appBaseUrl()` that throws in production when unset. | S | SUSPECTED |
| S11 | Med | prior #15, #16, #13/#14, #17 | Placard QR page hands out the tenant-wide review token; review token ignores `kind`; anonymous-report IP throttle counts successes and is read-then-write; `signOut()` discards its error. All still open; see the 08-28 sweep for the fixes. | As written there. | S–M each | VERIFIED open |

### P1 — data correctness and scale

| ID | Sev | Where | Problem | Fix | Eff | Conf |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | **High** | `migrations/003:98` `log_audit()` (prior #4) | Never populates `audit_log.tenant_id`. Consequences: `/admin/evidence/audit` and `/api/admin/audit-summary` are **always empty** for non-superadmins; `tenant-health.last_activity_at` is always null; retention and legal holds cannot be tenant-scoped (D2). New audited tables keep attaching the trigger (`296:92`). | Derive tenant from the audited row inside `log_audit()`; backfill where recoverable. Null stays correct for cross-tenant superadmin actions. | M | VERIFIED |
| D2 | High | `migrations/242:20-24` `prune-audit-log` | Deletes every audit row older than 12 months, ignoring `legal_holds` and per-tenant retention windows (151: permits 3 yr, incidents 5 yr). | Fix D1 first; exclude tenants with open holds; apply each tenant's longest window; later partition by month. **Changes what is kept.** Production may already carry an out-of-band fix (`migration-reconciliation-2026-08-28.md:176`) — check `cron.job` first. | M | UNVERIFIED in prod |
| D3 | High | `api/admin/users:177-183`, `api/superadmin/users:70-77`, `tenants/[number]/members:88-95` | Each pages through **every** `auth.users` row via `listUsers` (200 per call) to find `last_sign_in_at`. At 6,500 users ≈ 33 serial GoTrue calls per admin page load, and a cut-off past 10k that mislabels active users as "invited". | RPC `auth_sign_in_facts(p_user_ids uuid[])` — SECURITY DEFINER, service_role only, pattern at `248:18-36`. | S | VERIFIED |
| D4 | High | `superadmin/ai-usage:47`, `support-metrics:49` (`.limit(50_000)`), `superadmin/users:40-50`, `cron/superadmin-daily-report:153-170` | Rely on PostgREST returning >1,000 rows; nothing in the repo sets `max_rows`. If the default applies, totals are silently truncated and `truncated: false` lies. | Aggregate in SQL (`ai_usage_rollup(p_since)` by tenant/day/surface/model/status), pricing stays in JS as in 292. **Totals rise to true values.** | M | SUSPECTED |
| D5 | Med | `superadmin/cron-runs:61` | Capped at 2,000 rows while `vercel.json` schedules ≈1,500 runs/day; the "7-day" view covers ~1.3 days and under-counts errors. Wrong today, not just at scale. | RPC with `distinct on (cron_path)` + `count(*) filter (where status='error')`; page the raw list. | S | VERIFIED |
| D6 | Med | `superadmin/audit/route.ts:72-76`; `migrations/291:16-22` | `order by created_at desc limit 300` with no index leading on `created_at` (291 dropped it as "redundant"). Default page load scans and sorts all of `audit_log`. | `create index concurrently audit_log_created_at_idx on public.audit_log (created_at desc);` | S | VERIFIED; plan SUSPECTED |
| D7 | Med | `superadmin/users/[user_id]/route.ts:60-128` | Six serial round trips; membership history read as "last 200 changes platform-wide" then filtered in JS, so it vanishes as the platform grows. | `.in('table_name',[…]).eq('row_pk', id).limit(100)` and `Promise.all`. | S | VERIFIED |
| D8 | Med | `migrations/292:214-220` tenant-health RPC | `active_permits` counts every non-cancelled permit ever issued; member counts include cancelled invites; `last_activity_at` reads all of `audit_log` once D1 lands. | `expires_at > now()`; exclude `invite_cancelled_at`; `lateral … limit 1` for activity. **Changes counts** — confirm definitions with the BI owner. | S | VERIFIED |
| D9 | Med | `lib/members/server.ts:96-114` | Fetches 2×limit then filters the search term in JS; members beyond 500 are unfindable. | Push the search into SQL (`.or(…ilike…)`) with keyset pagination on `131:104`. | S | VERIFIED |
| D10 | Med | policies in migrations 260, 270, 274–277, 288, 295–299 | Call `is_superadmin()` / `active_tenant_id()` / `auth.uid()` **unwrapped**; production wrapped the earlier 303 policies out-of-band, so these probably run per row. A rebuild from the repo would undo the wrapping everywhere. | Commit a `pg_policies` dump as a migration; CI grep that rejects unwrapped helper calls. | S | VERIFIED in repo |
| D11 | Med | `email_log` (057), `loto_webhook_deliveries` (126), `ai_invocations` (047); `cron_runs` pruned at 30 d (242) while the UI offers 90 d | No pruning or partitioning on the first three; the superadmin diagnostics views slow with age. | Retention cron per table; monthly partitions for the two high-volume logs. | M | VERIFIED |
| D12 | Med | `api/cron/invite-reminders/route.ts:205,278,354` (prior #10–#12) | Token supersede and cadence anchor keyed by `user_id` only — a reset in tenant A revokes a live member in tenant B; counter write-back has no compare-and-set. | Scope both by `(user_id, tenant_id)`; CAS on `invite_reminders_sent`. | S | VERIFIED open |
| D13 | Low | `superadmin/search:91,99-108`; `email-log:76`; `webhook-deliveries:122`; `tenant-settings/risk:55-70`; `review-links` GET | Serial second `tenants` read; status counts from the capped page shown as window totals; read-modify-write on `settings` (lost update); unbounded GET. | Parallelise; `count(*) filter`; `settings || $patch`; `.limit`. | S | VERIFIED |
| D14 | Low | `api/contractor-prequal/[token]/route.ts:62` (prior #5) | Portal token never expires. | Return 410 past `approval_expires_at` now; add `portal_token_expires_at` later. | S | VERIFIED open |

### P2 — UX and information architecture

| ID | Impact | Where | Observation | Change | Eff |
| --- | --- | --- | --- | --- | --- |
| U1 | High | `EditTenantForm.tsx:211-224,356`; `superadmin/tenants/page.tsx:251-299`; `MembersSection.tsx:516-525`; `cron/page.tsx:158`; `release-notes/page.tsx:133` | Disabling a live safety tenant saves via plain "Save changes"; bulk module Disable fires on select-all in one click; system-wide user delete is an unlabelled 16 px kebab (1.5:1 contrast) and the undo toast says "Deleted" before commit; "Run now" and "Publish now" (banners every tenant) have no confirmation. | One `ConfirmDialog` with blast radius (tenant #, member count, active permits — `tenant-health` already has both), typed confirmation for disable/delete; labelled danger buttons. | S–M |
| U2 | High | `members/page.tsx:45-47,155`; `workers:58,233`; `scorecard:199,301`; `users:110-135`; `AuthProvider.tsx:87-92` | Failures render as emptiness ("No members found", "Add the first worker"); TRIR/risk sections vanish silently; the users spinner never ends on a network error; a profile-fetch error shows "Admins only."; the "Authorizing" spinner has no timeout, retry or sign-out. | Shared `LoadState` (loading / error+Retry / empty / data) — never show empty when errored. Put the tri-state access screen in `app/admin/layout.tsx` (F9). | M |
| U3 | High | `superadmin/page.tsx:209` `AllMembersPanel`; `/api/superadmin/users` | The landing loads an **unpaginated cross-tenant dump of every user** on each visit, filtered client-side. | Move to `/superadmin/users` with server paging; replace with a "Needs attention" strip (open tickets, failing crons, idle tenants, stale regulations — all from existing endpoints). | M |
| U4 | Med | both landings; `lib/adminCatalog.ts` | Admin: 10 sections / 48 tiles; "Login users (legacy)" and "Workers (legacy)" beside Members; Scorecard, Risk intelligence and Compliance calendar buried 9th. Superadmin h1 says "Tenant management" for a platform console; `identity-drift`, `sds-library`, `manuals/[moduleId]` have no inbound link; the webhook tile promises a "replay" that does not exist. | IA proposal in §5. | M |
| U5 | Med | `components/PageHeader.tsx`, `breadcrumbs.ts` | `PageHeader`/`Breadcrumbs` used by **0 of 98** pages; 25 pages back-link to `/`, 6 to `/admin`; 16 files nest `<main>`. | Adopt `PageHeader` across both trees; delete the dead admin branch of `breadcrumbs.ts` or use it. | M |
| U6 | Med | `cmms/page.tsx:181`, `scim/page.tsx:213`, `support/page.tsx:347` and 12 more | Native `confirm()` ×15 (`AlertDialog` exists, used in 3 files); 8 hand-rolled overlays without `role="dialog"`/focus trap; filter pills without `aria-pressed` (`workers:171`, `support:157`, `cron:105`). | `ConfirmDialog` + `SegmentedControl` on the existing `ui/` primitives. | M |
| U7 | Med | `superadmin/page.tsx:174` (+19 pages); `admin/page.tsx:61`; `users/page.tsx:319-352`; `working-at-heights/anchors/page.tsx:87` | `text-brand-yellow` without `dark:` is 1.4:1 on white; `slate-400` body copy 2.6:1; icon buttons 32 px with zero touch-size variants on a tablet product; 20 raw tables without an overflow wrapper. | Token fix; `size="icon-touch"` row actions; wrap tables. | S |
| U8 | Med | `components/SuperadminImpersonationBanner.tsx:8-27`; `IdleLogout.tsx:8` | Header pill names the *active* tenant while a superadmin page acts on another; banner keys on membership, not sticky; "signed in as" only on the landing. | Sticky "Acting on #0012 · status" bar on every `/superadmin/tenants/[number]/**` page; consider a shorter idle timeout for superadmin sessions. | M |
| U9 | Low | `components/CommandPalette.tsx:159` | ⌘K reaches 18 of 48 admin tiles (no Members, Audit log, Working at Heights). | Feed `getAllAdminTiles()` to the palette. | S |

### P3 — frontend architecture and maintainability

| ID | Impact | Where | Observation | Change | Eff |
| --- | --- | --- | --- | --- | --- |
| F1 | Med | 14 local header builders (`authedHeaders` ×4, `authHeaders` ×3, `tenantHeaders` ×6, `authFetch` ×1), 9 inline, 65 `body.error ?? HTTP n` parses | Only `multi-agent-audit/_lib/authHeaders.ts:10` refreshes a near-expiry token; the rest silently omit the header. | `lib/adminFetch.ts` mirroring `superadminFetch` (tenant + facility headers, refresh, typed result). | M |
| F2 | Med | tree-wide; `members/page.tsx:46,159`; `training-records:41-58` | No pagination anywhere in either tree; ~60 of 92 read chains have no limit; Members capped at 500 and rendered in full. | Server paging or "load more" on the five largest lists first. | M |
| F3 | Med | 77 of 101 data-fetching files | No stale/unmount guard; `AbortController` used in 0 files; every navigation refetches; `superadmin/audit:72-76` fetches on every keystroke with no debounce (`useDebounce` has 0 admin consumers). | A small `useQuery`-style hook (or SWR) adopted incrementally; debounce + sequence guard on search inputs. | M–L |
| F4 | Med | `AuthProvider.tsx:103-117`; `TenantProvider.tsx:190-197`; `AuthGate.tsx:79` | Cold `/admin` load: `getSession` → `profiles` → `tenant_memberships` → page fetch, all serial; SSR output for every admin route is the spinner. | Start the memberships read as soon as the user id is known. | S–M |
| F5 | Med | `scorecard/page.tsx:26-35,50,56`; `AppChrome.tsx:7-31`; `ChatHeaderButton.tsx:10-40` | Static `recharts` import on the 1,576-line scorecard; every route bundles SupportBot (523 lines), AssistantDock (344), CommandPalette; chat polls every 30 s. `dynamic()` is used once app-wide. | `dynamic({ ssr:false })` for charts and click-to-open chrome. | S–M |
| F6 | Low | `evidence/audit:215-230`; `hygiene-log:288-301`; `superadmin/queries:385-396`; `members/page.tsx:70-80` | Four CSV exporters bypass the formula-injection guard in `lib/export.ts:5` (`csvEscape`, 0 consumers). | One `downloadCsv()`. | S |
| F7 | Low | the six largest files | Concrete split points: scorecard tiles/infographics `:470-770`, `IncidentScorecardSection` `:951-1200`, `TargetsBenchmarkPanel` `:1239-1390`, pure helpers `:844-950` + `:1450-1576` → lib with tests; history-import `CsvImport` `:431-652` + mapping helpers `:692-834`; `AuditDetailClient` → `useAuditRun` hook + one POST handler for four; `workers` `AddWorkerForm`/`WorkerRowView`; `members/[memberId]` `MergeMemberDialog`; `users` columns/result card/copy helpers. None of the pure helpers has a unit test today. | Extract as listed, tests with the helpers. | M |
| F8 | Med | `__tests__/` | 63 of 81 admin+superadmin routes have no test (44 mutating): `queries/run` (now covered), `transfer-ownership`, `bulk-modules`, `run-cron`, `release-notes`, `tenants/[number]/logo`, `scim-tokens`, `members/[memberId]` PATCH, `tenant-settings/risk`, `policies/*`, `loto/audit/[runId]/*`, `notifications/*`. No admin or superadmin page has a render test. | Route tests for the mutating list first (the `_helpers.ts` harness makes each ~40 lines). | ongoing |
| F9 | Med | `app/admin/`, `app/superadmin/` | No `layout.tsx` / `loading.tsx` / `error.tsx` in either tree. 16 module layouts already exist as precedent (`app/loto/layout.tsx`). | Thin client `layout.tsx` per tree using `useCanManageTenant()` for a tri-state access screen; `loading.tsx` skeletons. This is UX centralisation, not protection — the Next docs are explicit that layouts neither block the RSC payload nor re-run per navigation. | S |
| F10 | Low | `app/api/admin/prop65/import/route.ts` | Lives under `/api/admin` but is gated by `requireSuperadmin`. | Move under `/api/superadmin` or gate as admin, whichever is intended. | S |

**On D4.1 (server-side page protection):** keep the bearer-token design; do F9 and defer `@supabase/ssr`.
Cookie sessions would protect only page HTML/JS — which holds no tenant data — at the cost of an
app-wide session rewrite that the mobile app and the per-tab `x-active-tenant` header do not map onto.
The real controls are the API gates and RLS, and 57 admin pages read through RLS directly, so S3's
admin-scope policies matter more than a server layout. Fix S9 on its own.

---

## 4. Status of the 2026-08-28 sweep items

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `tenant_memberships` write policy row-scoped | **OPEN** | `049:56-65` unchanged; only trigger is `updated_at` (`027:238`) |
| 2 | `current_user_owner_tenant_ids()` revocation gate | **OPEN** (re-scoped: `current_user_visible_profile_ids()` builds on the gated helper) | `031:74-92` never redefined |
| 3 | `bug_reports`/`support_*` INSERT tenant predicate | **OPEN**, downgraded — tables readable only by superadmins; risk is corrupted operator metrics | `034:55`, `045:80,121` |
| 4 | `log_audit()` never sets `tenant_id` | **OPEN** — drives D1, D2, D8 | `003:98` sole insert |
| 5 | Contractor portal token never expires | **OPEN** | `163:54-58`; lookup checks status only |
| 6 | Viewer write tier | **OPEN** — 68 handlers | S3 |
| 7 | cancel-invite hard-deletes an account with a password | **OPEN** | `members/[user_id]:146` |
| 8 | `releaseInviteToken` resurrects a superseded token | **OPEN** | `tokens.ts:77,162` |
| 9 | `grant-login` always fails | **PARTIAL** — ordering and rollback fixed (`grant-login:113-150`); orphan auth user if the link step fails | |
| 10–12 | Reminder cron tenant scoping / CAS | **OPEN** | `invite-reminders:205,278,354` |
| 13–14 | Anonymous-report throttle | **OPEN** | `ipThrottle.ts:64-68` |
| 15 | QR page hands out tenant-wide token | **OPEN** | `qr/[token]/page.tsx:119` |
| 16 | Review token ignores `kind` / batch | **OPEN** | `review/[token]/route.ts:44` |
| 17 | `signOut()` discards its error | **OPEN** | `AuthProvider.tsx:149` |
| 18 | TenantProvider superadmin race | **PARTIAL** — race fixed by the loading gate; a profile-fetch error still forces sign-out (`TenantProvider:172-183`) | |
| 19 | `reset-access` sends a link `accept` rejects | **OPEN** | `reset-access:138` |
| D4.1 | Server-side page gating | **OPEN** — see F9 | |
| — | Five private `requireTenantAdmin` copies | **FIXED** | none remain |

---

## 5. Phased plan

**Phase 0 — this PR.** Admin access decided by tenant role everywhere; push dispatch, resend-invite,
SQL runner, error boundary, allowlist parser. Apply migration 300 by hand.

**Phase 1 — security, one sprint.** In order: S2 (guard trigger, half a day, closes a Critical),
S1 (`tenant_secrets`), S5 + S6 (shared `outranks()` / `hasOwnCredential()`), S4, S9, S10, then S3 as
its own PR with the gate matrix test updated. S7 (actor recording + `aal2` for destructive superadmin
actions) belongs here too, because Phase 3's confirmation dialogs are only half the control. Carry
S11 from the earlier sweep as written there.

**Phase 2 — data correctness and scale.** D1 first — it unblocks D2, D8 and makes the tenant audit
page work at all — then D3/D5/D7 (small RPC/index changes with visible wins on the superadmin pages),
D6, D9, D13, D14. D4 and D10 need a decision from whoever owns the production database: confirm
`max_rows` and the policy wrapping before changing code. D11 and D2 change what is kept — agree the
retention table with compliance first. Every change marked **changes counts** gets a before/after
screenshot in its PR.

**Phase 3 — UX.** U1 and U2 first (they are safety controls as much as polish), then F9 so the access
and load states live in one place per tree, then U3 (move the member dump off the landing, add the
"Needs attention" strip), U5/U6/U7 as a single accessibility pass, U4/U8/U9 as the IA pass:

- *Admin landing:* lead with Scorecard, Risk intelligence and Compliance calendar; **People &
  Training** (Members with an Add action, training matrix/records, competency exams, contractors —
  Users and Workers become tabs of Members, not tiles); **Programs** (LOTO, Working at Heights,
  Chemicals, Behaviour & Risk, Inspection templates); **Evidence & Compliance** ("Audit log" →
  "Change history", Hygiene log moves here, three manual tiles → one `/manuals` link);
  **Integrations & Settings** ("Configuration" → "Org settings"; merge Historical import + Data
  connectors). Personal tile moves to the user menu.
- *Superadmin landing:* retitle to "Platform operations"; **Triage** (Support, Daily report, Cron,
  Health), **Tenants** (Tenants, Search, Identity drift), **Investigate** (Audit, Email, Webhooks, AI
  usage, Queries), **Content** (Policies, STRIKE, Release notes, SDS library, Wiki, Migrations). Tag
  the tiles that write or broadcast (Cron, Release notes) apart from the read-only ones.

**Phase 4 — architecture.** F1 (`adminFetch`) and F3 (query hook) together, since the hook needs the
fetcher; F2 pagination on the five largest lists; F4/F5 bundle and waterfall work; F6; F7 splits as
each file is next touched (not as a drive-by); F8 route tests continuously, starting with the
mutating list.

---

## 6. Method and what was not checked

Each reviewer worked read-only from the repository; nothing was executed against production, no
query plans or timings were measured, and bundle sizes are described qualitatively. Every finding
acted on in §2 was re-read in the code before the change; where a reviewer's confidence was
SUSPECTED it stays SUSPECTED above. Reviewers reported, and this document keeps, what they did not
open: about 45 admin pages were only grepped, not read; the SCIM routes, mobile app, `homeMetrics`,
Realtime, the superadmin export and reset-demo routes, and the production `cron.job` bodies and
policy text were not examined. The production population of `profiles.is_admin` was not queried;
the fix in §2 does not depend on it, since the role is now read from `tenant_memberships` regardless.
