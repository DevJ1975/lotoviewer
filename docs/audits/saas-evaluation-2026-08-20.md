# Soteria FIELD — SaaS Evaluation & Phased Remediation Plan

**Date:** 2026-08-20 · **Repo:** `DevJ1975/lotoviewer` @ `13ba4f18` · **Version:** 1.17.1
**Production DB:** Soteria Main Project (`zwtnpyjifbdytlektxlc`) — queried read-only for this audit

---

## 1. Verdict

The application code is in **better shape than the process around it**. The codebase is genuinely
disciplined — zero skipped tests, zero empty catch blocks, two `as any` casts in ~1,700 source
files, 277/277 public tables with RLS enabled. Almost nothing is stubbed.

What is broken is the **path from a merged PR to working production**, and that is where the
damage is. Three facts define the current state:

1. **A feature is live in production right now with no database behind it.** Migration 257 shipped
   to `main` on 2026-08-19 and Vercel deployed the code. The migration was never applied. A cron
   fires **every five minutes** against tables that do not exist.
2. **Nothing gates a merge.** `main` has no branch protection, and CI runs neither the test suite
   nor typecheck nor build. The stated reason — 127 failing tests — **is no longer true.** I ran
   all three gates: **2 failures out of 4,150 tests, 0 typecheck errors, 82 lint errors.** The
   gate can be switched on in about a day; the team has been working around a problem that was
   quietly fixed.
3. **36 pull requests are open, the oldest since 2026-05-24.** All 208 merged PRs did land on
   `main` correctly — the backlog is work that never merged, not work that got lost. But **11 of
   the 14 migration-bearing PRs now collide with `main`'s numbering**, in a way GitHub reports as
   `MERGEABLE / CLEAN` and that only breaks *after* the merge. And one of them, **#271, fixes a
   live vulnerability**: every published STRIKE answer key is readable today by any authenticated
   user of any tenant. I confirmed that against production.

What has already been fixed on the `fix/audit-remediation` branch is in **§6**; the phase plan
for the rest is in **§7**, ordered so that the safety net exists *before* the backlog lands.

---

## 2. Did the PRs ship and land on main?

### 2.1 Merged PRs — all verified on main ✅

| Check | Result |
|---|---|
| PRs merged | **208** |
| Merged into a base other than `main` | **0** |
| Merge commits verified as ancestors of `origin/main` | **208 / 208** |
| Reverts on `main` | 1 (`e235a610`, "Energy & Lockout fields with AI assist" — deliberate) |

Verified by resolving every merged PR's `mergeCommit.oid` and testing
`git merge-base --is-ancestor <sha> origin/main`. **Nothing merged has been lost.**

### 2.2 …but "landed on main" ≠ "shipped"

This is the gap that matters. Code reaches production automatically via Vercel; **the database
migration it depends on is a manual copy-paste into the Supabase SQL editor with no ledger.**

`apps/web/app/superadmin/migrations/page.tsx:9-14` states the position explicitly:

> We do NOT query the DB for what's applied — Supabase doesn't track raw SQL pastes through
> `schema_migrations`, so any "applied" column would lie.

I queried production to see what that costs:

| Migration | In repo | In production |
|---|---|---|
| 241 — scale-hardening indexes | ✅ | ✅ applied |
| 242 — retention jobs | ✅ | ✅ applied (2 `pg_cron` jobs live) |
| **257 — predictive safety intelligence** | ✅ | ❌ **NOT APPLIED** |

### 2.3 🔴 Live production incident

`257_predictive_safety_intelligence.sql` creates `vision_sweep_runs`, `vision_sweep_photos`,
`vision_hazard_signals`, and `document_drafts`. **None of the four exist in production.**

The code that needs them is deployed and scheduled:

| Consumer | Exposure |
|---|---|
| `/api/cron/vision-sweep-resume` | `vercel.json` — **every 5 minutes** |
| `/api/cron/vision-hazard-sweep` | `vercel.json` — daily 08:00 UTC |
| `/api/insights/briefing` | **user-facing** (via `lib/safetyBriefingFeatures.ts`) |
| `/api/drafts` | user-facing |

Since the 2026-08-19 deploy, a cron has been erroring roughly **288 times a day** and the
briefing endpoint fails for users. Fix in Phase 0.

#### It is not one migration. A full sweep found four.

Every one of the 258 migration-declared tables was checked against the live schema. **Four
migrations were never applied — the oldest is `034`,** which means this has been happening for a
long time, not just since yesterday. All confirmed by direct query:

| Migration | Missing object | Live consequence |
|---|---|---|
| `034_bug_reports.sql` | table `bug_reports` | `/api/support/bug-report` and `/api/cron/daily-health-report` error |
| `134_loto_review_business_rules.sql` | column `loto_equipment.signed_placard_url` | **placard signing silently counts every item as failed** (`app/departments/[dept]/page.tsx:79`) |
| `236_rca_multi_root_branching_ai.sql` | table `incident_rca_ai_suggestions` | `/api/incidents/[id]/rca/assist` errors |
| `257_predictive_safety_intelligence.sql` | 4 tables | the cron and briefing above |

Two more schema-vs-code mismatches surfaced in the same sweep:

- **3 of the 4 RPCs `reset-demo` calls do not exist.** `app/api/superadmin/tenants/[number]/reset-demo/route.ts:188`
  loops over `seed_wls_incidents_demo`, `seed_wls_near_miss_demo`, `seed_wls_bbs_demo`,
  `seed_wls_iso14001_demo` — only the last one is defined anywhere.
- **The assistant's permit-lookup tool is fully broken.** `lib/support/tools.ts:253,273` selects
  `permit_number, description, status, authorized_at` from both permit tables. **None of those four
  columns exists on either table** — the real ones are `serial`, `purpose`/`work_description`, and
  there is no `status` column at all. Both queries 400, so the tool always returns `{ok: false}`.

This is what "no migration ledger" costs. Nothing detects an unapplied migration; the endpoint
just fails in production and nobody is told.

### 2.4 🔴 Repo/production schema drift

Production RLS policies are wrapped in `( SELECT … )` — the InitPlan optimization from scale-audit
P0-1. The repo's migrations are not:

| | Repo migrations | Production |
|---|---|---|
| `is_superadmin()` wrapped in `(select …)` | **0** | **303 / 303** |
| `active_tenant_id()` wrapped | **0** | wrapped |

The fix was applied straight to the database and never committed. Combined with §2.5, **the repo
can no longer reproduce production.** Re-running `migrations/` against a fresh database yields
the slow, unwrapped policies.

### 2.5 The migration chain cannot rebuild the database

- `loto_equipment` — referenced by 36 migrations and 65 code sites — **has no `create table`
  migration anywhere.** There is no `000_baseline.sql`; the oldest tables predate the chain.
- 10 migration numbers are missing (`044`, `156-159`, `166-169`, `179`) — two clustered runs, the
  signature of dropped branches.
- `seed_*.sql` and `data_hygiene_*.sql` are excluded from the numbering guard and applied by hand
  with no ordering guarantee.

### 2.6 Release tagging never happened

Only **`v1.8.0`** exists on the remote, but the app is at **1.17.1**. `v1.9.0` through `v1.17.0`
shipped untagged. `scripts/backfill-version-tags.sh` is written, verified, and ready — it just
needs credentials an agent session doesn't have:

```bash
DRY_RUN=1 bash scripts/backfill-version-tags.sh   # review
bash scripts/backfill-version-tags.sh             # create + push
```

`CHANGELOG.md` also says `[Unreleased] — Nothing pending`, but three features have landed on
`main` since 1.17.1 (#279 ISO 14001, #280 BBS tile, #281 predictive safety intelligence).

### 2.7 Process drift from the documented convention

`docs/runbooks/versioning.md` §2 requires squash-merge and branch protection. Neither holds:

| Documented | Actual |
|---|---|
| "Squash-merge to keep `main` history one-commit-per-change" | **180 merge commits**; 13 subjects appear twice on `main` |
| "`main` … is protected" | `GET /branches/main/protection` → **404 Branch not protected** |
| "Every change reaches `main` through a pull request" | 297 of the last 400 non-merge commits carry no `(#N)` |
| "Delete the branch after merge" | **242 remote branches**; 132 already merged, 206 with no open PR |

### 2.8 Open PR backlog

**36 open** (25 draft, 11 ready), oldest 2026-05-24. **20 closed unmerged** — 14 of them on a
single day (2026-05-24), a mass cleanup that discarded work including xAPI integration, the AI
compliance calendar, hazardous-waste Phase 1, and the STRIKE quiz maker. Six others were closed
solely to resolve migration-number collisions (#173, #174, #176, #177, #178, #232) — the same
failure mode that now blocks 11 open PRs.

> Per-PR triage, the collision map, duplicates, and the nine merge waves are in **§5**.

---

## 3. Module completeness

~41 top-level modules registered in `packages/core/src/features.ts`, 344 API routes, 263
migrations, 354 test files.

### 3.1 Ranked, most incomplete first

| # | Module | State | Evidence |
|---|---|---|---|
| 1 | **Mobile (`apps/mobile`)** | 7 of 41 modules; **cannot ship to stores** | Hazwaste writes to AsyncStorage and never syncs. No AI, no push. 5 unfilled `REPLACE_WITH_…` placeholders |
| 2 | **Intelex data connector** | Hard `501` | `lib/insights/historyConnectors.ts:60-95` — blocked on client credentials |
| 3 | **In-app Manuals** | Machinery done, **content 1/41** | 40 of 41 rows in `seed_module_manuals.sql` are `'## Overview … **Edit me.**'` |
| 4 | **Deep-link / store config** | Non-functional, **guard bypassed** | `ALLOW_DEEPLINK_PLACEHOLDERS=1` is hard-coded into `check:repo` *and* required in the Vercel build env |
| 5 | **Inspections** | Thinnest first-class module | 849 LOC, 9 files, no template detail editor |
| 6 | **Working at Heights** | Explicit "Coming soon" | `app/working-at-heights/page.tsx:93,170` — dead `<ComingSoonCard>`; only draft-status wiki page |
| 7 | **Fleet** | Name promises what isn't built | `app/fleet/page.tsx:44` — "(coming soon) monitored journey plans" |
| 8 | **BBS** | Two open deferrals | **D3.1** no rate limit on anonymous QR intake; **D3.2** photo table + RLS exist, **no upload endpoint** |
| 9 | **OSHA ITA** | Code complete, never exercised live | `api/osha/300a/submit-to-ita/route.ts:71` returns 501 while `OSHA_ITA_BASE_URL` is unset |
| 10 | **Webhooks, SSO** | Functional, **0 dedicated tests** | |
| 11 | EM-385, Equipment Readiness, Hazardous Waste, Safety Boards | Under-tested | 1–3 test files each, no wiki page |
| — | Chemicals/SDS, Incidents, LOTO, Superadmin | **Mature** | LOTO: 49 files, 25 test files, 26 migrations |

### 3.2 Cross-cutting

- **Manuals are empty for end users.** `check-manual-coverage.mjs` verifies a *row exists*, not
  that it has content — so this passes CI green while `/manuals` shows nothing real.
- **18 modules have no wiki page**, including `bbs`, `chemicals`, `hazardous-waste`,
  `toolbox-talks`, `strike`, `safety-boards`, `em385`, `fleet`.
- **Placeholder markers are near-zero** — 2 real TODOs, 0 `FIXME`/`HACK`/`XXX`, 0 `comingSoon: true`
  entries. Incompleteness lives in **docs, content, and coverage**, not stubbed code.

### 3.3 Nearest hard external deadline

**HazCom 2024 employee retraining — 20 Nov 2026, ~3 months out.** `docs/regulatory-review-2026-07.md`
Tier 3a is explicitly not built; no migration exists. Also unbuilt: Cal/OSHA workplace violence
prevention (1 Jan 2027, statute already in force — California tenants arguably non-compliant today)
and Cal/OSHA heat §3396 (already enforceable).

---

## 4. Bugs and risks

### 🔴 Critical

**C1 — Migration 257 unapplied in production.** See §2.3.

**C2 — `tenantGate` never checks `tenants.disabled_at`.**
`apps/web/lib/auth/tenantGate.ts:91-96` selects **only `role`**:

```ts
.from('tenant_memberships').select('role')
.eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle()
```

The DB helper the RLS policies use (`migrations/190_invite_reminders.sql:44-57`) enforces both
`t.disabled_at is null` and `m.invite_cancelled_at is null`. The gate enforces neither.

This matters because **279 of 344 API route files use `supabaseAdmin` (service role), which
bypasses RLS entirely** — for those routes the gate *is* the whole boundary. Only
`requireTenantModuleMember` checks `disabled_at`, and it is used in 13 files versus 128
(`requireTenantMember`) and 101 (`requireTenantAdmin`).

**Impact:** a superadmin disables a tenant; that tenant's signed-in users keep read **and write**
access across ~229 route files until their JWT expires. There is no compensating middleware —
`proxy.ts` only does an Origin/Host CSRF check and there is no `middleware.ts`.

**C3 — STRIKE answer keys are readable by any authenticated user.** Verified against production —
see §5.2. Fix is PR **#271**, open since 2026-07-31.

**C3a — 🔴 The inspector link leaks every tenant's permits.** *Found while fixing M1; not in the
original audit — it is more severe than the M1 trap that led to it.*

`InspectorTokenPayload` is `{ start, end, exp, label }`. **There is no tenant in the token at
all**, and `INSPECTOR_TOKEN_SECRET` is a single global secret. Both consuming routes then query
with the service role and no tenant predicate:

| Route | Query | Auth |
|---|---|---|
| `api/inspector/bundle/route.ts:52,59` | `loto_confined_space_permits`, `loto_hot_work_permits` — date range only | HMAC only, no login |
| `api/inspector/lookup/route.ts:87,93` | same two tables | HMAC only, no login |

So **any inspector URL minted by any tenant returns every tenant's confined-space and hot-work
permits** in that date range — on a public, no-login, deliberately-shareable link handed to
outside regulators. The minting route made it possible: it gated on a *global* `profiles.is_admin`
flag and never read `x-active-tenant`, so a tenant-blind token was the only kind it could produce.

Fixed in this pass — see §6.1.

**C3b — `tenantGate.ts` has zero direct tests.** The authorization boundary for 229 route files
appears in `__tests__` only as `vi.mock(…)`. `npm run test:security` targets `__tests__/lib/auth`,
which contains only `superadmin.test.ts`. The superadmin path is tested; the tenant path is not.
That is why C2 survived.

**C4 — Nothing gates a merge.** `main` unprotected (§2.7). CI (`.github/workflows/repo-health.yml`)
runs repo guards plus a hand-picked ~20-file security subset. Of 334 test files / 4,150 tests,
the rest can regress silently. The workflow justifies this:

> `npm test` has 127 pre-existing failures on main … and `eslint .` has 82 pre-existing errors,
> so a blanket gate would land red and be ignored from day one.

**🟢 …but that justification is stale. I ran all three gates:**

| Gate | Documented (D4.2, `repo-health.yml`, `POSTURE.md`) | **Measured 2026-08-20 @ `13ba4f18`** |
|---|---|---|
| `vitest run` | 127 failures across 22 files | **2 failures / 4,150 tests** (332 of 334 files green) |
| `tsc --noEmit` | "never ran clean" | **0 errors** |
| `eslint .` | 82 errors | **82 errors**, 70 warnings — accurate |

The stale UI fixtures were evidently repaired somewhere along the way and **nobody re-measured or
widened the gate.** The two remaining failures are one small bug, not a fixture rot problem:

- `__tests__/lib/adminCatalog.test.ts:46` — expected 39 redirects, got **43**
- `__tests__/regression/sessionFixes.regression.test.ts:123` — same root cause

Of the 82 lint errors, **58 are `@typescript-eslint/no-unused-vars`** across 58 files — mechanical
deletions (only 3 are eslint-auto-fixable, but the rest are one-line removals). The rest:
26 `react-hooks/preserve-manual-memoization`, 20 `react/no-unescaped-entities`, 19
`react-hooks/refs`.

**This is the single most actionable finding in the audit.** Turning on the full CI gate is
roughly a day of work, not the multi-week fixture-repair project the docs describe. PR **#276**
already does the CI half and has been open since 2026-08-17.

### 🟠 High

**H1 — `npm install` fails on Apple Silicon.** Reproduced first-hand on this machine:

```
npm error code EBADPLATFORM
npm error notsup Unsupported platform for @tailwindcss/oxide-linux-x64-gnu@4.2.4:
  wanted {"os":"linux","cpu":"x64"} (current: {"os":"darwin","cpu":"arm64"})
```

A Linux-only binary is pinned as a hard `devDependency`, so a new developer on a Mac cannot
install the repo without `--force`. The **mirror-image** gap also exists: the lockfile records
only `@rolldown/binding-darwin-arm64`, so vitest cannot start on Linux — CI carries an explicit
`npm install --no-save` workaround (`repo-health.yml:62-66`). Two opposite platform gaps in one
lockfile.

**H2 — Unbounded full-table reads into the browser.** `packages/core/src/insightsMetrics.ts:374-376`:

```ts
supabase.from('loto_confined_space_permits').select('*'),
supabase.from('loto_atmospheric_tests').select('*'),
supabase.from('loto_confined_spaces').select('*'),
```

No `WHERE`, no `.limit()`, no date floor — the entire permit and atmospheric-test history, pulled
into a client component. Same shape in `jhaMetrics.ts:136-138`, `riskMetrics.ts:199,202`,
`nearMissMetrics.ts:134`. **Every P0/P1 in `docs/performance-audit-2026-05-13.md` is unresolved.**

**H3 — 55 GET endpoints return unbounded result sets** (no `.limit()`/`.range()`), including
`fleet/vehicles`, `hazardous-waste/containers`, `safety-boards`, `inspections`, `em385/projects`,
`admin/users`, `superadmin/users`. These grow linearly with tenant data forever.

**H4 — The Supabase client is completely untyped.** `packages/core/src/database.types.ts:25-28` is
an **empty interface** — the generated-types stub was never filled. Every `.from('table')` and
every column name in 272 `select()` calls is unchecked; a typo compiles clean and fails at runtime.
`npm run db:types` exists but has never been run and committed.

### 🟡 Medium

**M1 — Global-namespace primary key on a multi-tenant table.**
`migrations/009_confined_spaces.sql:32` — `space_id text primary key`. `tenant_id` was added later
(`027`) but the PK was never widened to `(tenant_id, space_id)`. Two tenants cannot both have
`CS-001`; the second import silently collides.

⚠️ **Ordering trap:** `api/inspector/bundle/route.ts:75` does
`admin.from('loto_confined_spaces').select('*').in('space_id', spaceIds)` — service role, **no
`tenant_id` filter**. It is safe *only because* `space_id` is globally unique. **Fixing the PK
without first fixing this query converts a schema flaw into a cross-tenant data leak.**

**M2 — Unbounded crons.** 18 of 28 cron routes set no `maxDuration`, including
`superadmin-daily-report`, `training-expiry-reminders`, and `osha-300a-posting-prompt`.

**M3 — N+1 write loops.** `cron/equipment-readiness-reminders/route.ts:81` is a **triple-nested**
loop (tenants × rules × admins) with one insert per iteration. Also `osha-reg-watch:286`,
`meter-bump-reminders:207`, `admin/users/route.ts:277`.

**M4 — Leaked-password protection is off** (D4.4). Confirmed live via Supabase advisors. The
8-character minimum is enforced server-side only on `/api/invites/accept`; `/welcome` and
`/reset-password` call `updateUser({ password })` straight from the browser, so their checks are
UX affordances a devtools call bypasses. **Dashboard toggle, not a code change.**

**M5 — Client-only admin page protection** (D4.1). `components/AuthGate.tsx` is a client
component; every admin page's HTML is served to any signed-in browser. Defence-in-depth only —
the API layer *is* server-gated — but the real fix (adopt `@supabase/ssr`, move the session to
httpOnly cookies) is large and wants its own PR plus a staging soak.

**M6 — Chemicals tenant-policy tables accept member-level writes.** Any tenant member can ban a
chemical org-wide, set MAQ caps, or override storage incompatibility rules. The `restricted` and
`maq` routes still use `requireTenantMember`; they should use `requireTenantAdmin`.

**M7 — A vacuous test.** `packages/core/src/__tests__/visionHazardTaxonomy.test.ts` — the test
titled *"treats the same image reached by two URLs as one finding"* asserts
`visionSignalIdentity(base) === visionSignalIdentity({ ...base })`, comparing an object to its own
spread. `visionSignalIdentity` takes no URL parameter, so the stated behaviour is never exercised.

### ✅ Verified healthy — don't spend time here

- **Zero** skipped/disabled tests (`it.skip`, `.todo`, `xit`, …) anywhere.
- **Zero** empty catch blocks, zero console-only-swallow catches, zero `catch (e: any)`.
- **RLS on 277/277** public tables, 375 policies. The 7 tables with RLS-but-no-policies are
  intentional deny-all, each documented in-migration.
- **`exec_readonly_sql` is safe.** The Supabase advisor flags it as executable by `authenticated`,
  but the function body raises `42501` unless `is_superadmin()` — plus a `SELECT`/`WITH`/`EXPLAIN`
  allowlist, a compound-write regex, a 10s `statement_timeout`, and `transaction_read_only`.
  Revoke the grant for tidiness; it is **not** a breach.
- Migration numbering is currently **clean**: 263 SQL files, no duplicate prefixes, highest 257.
  The 256→257 renumber (`88a02a67`) resolved correctly.

---

## 5. Open PR triage

All 36 open PRs were read individually (body, full diff, checks, and a supersession check against
`main`), then cross-analysed for duplicates, conflict clusters, and migration collisions.

### 5.1 🔴 The migration-number trap

**`main` is continuous and fully occupied from 210 through 257. The only free numbers are 258+.**

**14 open PRs add numbered migrations. 11 of them collide.** And the failure mode is vicious:

> Two PRs adding *differently-named* files at the same number merge with **no textual conflict**.
> GitHub reports `MERGEABLE / CLEAN`. `check:migrations` then goes red **on `main`**, after the
> merge — and because it also runs in `apps/web`'s `prebuild`, it reddens the Vercel build too.

This is exactly how the repo accumulated six PRs closed unmerged purely to fix numbering.

| PR | Claims | Collides with |
|---|---|---|
| #278 | `258` | **clean** — sole claimant |
| #271 | `259` (+rollback) | **clean** |
| #272 | `260` | **clean** — comment-only |
| #245 | `244` | `244_incident_ecfa` — *invisible*, git merges clean |
| #183 | `213` | `213_chemical_emergency_phone` (title says 212, file says 213 — both wrong) |
| #270 | `256` | `256_wls_iso14001_demo` (landed yesterday, #279) |
| #228 | `234` | `234_chemical_sds_fetch_pending` — already renumbered once, stale again |
| #193 | `217–219` | main's `217–219` LOTO audit trio |
| #198 | `217` | main's `217` **and** #193's `217` |
| #211 | renames `222`→`225`, adds `226` | **destructive** — would delete main's `222` and dupe `225`/`226` |
| #212 | `227` | `227_em385_requirements_catalog` |
| #217 | `232–237` | 6-way — moot, close as duplicate |
| #234 | `236–241` | 6-way — *this PR was itself the renumbering fix for #217 in June and has now collided a second time* |
| #235 | `236–239` | 4-way, plus head-on with #234 |

**Sequencing rule:** only three free slots exist. At most three migration-bearing PRs land without
renumbering, and each one consumes the next. **Renumber at the moment of rebase, immediately
before merge, and land migration-bearing PRs one at a time.**

⚠️ Two more drift items surfaced here:
- **#198's migration was already applied to production under prefix `217`.** After renumbering,
  the repo prefix will no longer match what production ran. Reconcile by hand.
- **#278's `258` is committed but explicitly not applied.** Same class of bug as C1.

### 5.2 🔴 A live vulnerability sitting in an unmerged PR — #271

**Every published STRIKE quiz answer key is readable today by any authenticated user of any
tenant, via a single PostgREST call.** I verified this against production:

- `strike_quiz_answers` grants `arwdDxtm` (all) to `authenticated` **and** `anon`
- policy `strike_answers_read` permits `SELECT` for any authenticated user on any **published
  global** module — with **no column restriction**, so `is_correct` and `explanation` come back

STRIKE is safety microlearning whose completions feed the training-competency matrix, so this is
a training-integrity and compliance-record problem, not just a game. PR **#271** fixes it with
column-level grants in migration 259.

**The migration must be applied *before* the deploy** — the code change alone only stops the app
from *asking* for `is_correct`; the column grant is what actually closes the hole.

### 5.3 Duplicates and near-duplicates

| PRs | Verdict |
|---|---|
| **#217 vs #234** | **Exact duplicate.** Both 72 files / 5,199 diff lines; normalizing migration numbers out leaves **10 differing lines**, all number echoes in comments and `describe()` titles. **Close #217**, keep #234 (rebased later). |
| **#209 vs #248** | Same mobile `tenantId` fix verbatim; #248's copy omits the `loto_energy_steps` tenant filter. Keep #209's. |
| **#255 vs #261** | Competing `.claude/agents/` personas under *different filenames*, so git will never flag them. Strip from both. |
| **#198 vs #211** | Overlapping edits to `regeneratePlacard.ts`. Order them. |

### 5.4 Recommended merge waves

| Wave | PRs | Why |
|---|---|---|
| **1** | **278 → 271 → 272**, then 274, 275, 220, 254, 253, 216, 258, 184, 247 | Clean and high-value; the first three hold the only free migration slots, so they go **strictly in that order**. #275 must land before #277. #247 before #276/#248 so the lockfile regenerates once. |
| **2** | **276**, 273 | **Turn the lights on.** #276 replaces the 28-file subset with a real full-suite + typecheck gate. Rename the required check `security-tests` → `verify` in branch protection in the same window. Retarget #273 at `main` (its base is #271's branch). |
| **3** | slices of 209, 193, 246, 277, 255, 261 | Extract-and-land only; parents don't merge. Highest value-per-line, none needs a migration, and wave 2's gate can finally verify them. |
| **4** | 245 → 183 → 270 | First renumber wave (261, 262, 263). One at a time. #270 must add `seed_wls_iso14001_demo` to its `SEED_FUNCTIONS` or it re-breaks the module #279 just shipped. |
| **5** | 228, 260 | Medium rebases. #260 has a **semantic** conflict git won't surface — `reactivateInvite()` was centralized in `provision.ts`, so the route's own unguarded UPDATE would now run twice. |
| **6** | 234 | GHS / NFPA 704 / DOT placarding — the largest genuinely missing capability and directly HazCom-relevant. Needs six consecutive slots renumbered in one pass. Land #193's core slice first. |
| **7** | 211 → 212 → 198 | The perf/LOTO stack. #212's base **is** #211's branch. #212's `get_gate_context` fronts ~220 routes — **apply before deploy or every authenticated route 500s.** |
| **8** | 215, 222, 200, 202 | Rewrite-first. #222 is a security roadmap that **contradicts `POSTURE.md`** (claims no CSP/HSTS when `next.config.ts` ships both) — worse than publishing nothing. #202 inverts an indicator so a *verified* machine looks worse than an unverified one, on a public QR page. |
| **9** | 235, 248, 277(b) | Hold — re-author, don't rebase. #235 ships non-functional (cron unregistered, no nav entry). #248 (Expo 54→57) repins React in a hoisted workspace, moving the React the **web** app resolves, for `npm audit` 24→16 with 0 critical either way. |

### 5.5 Close now

**#217** (exact duplicate of #234) · **#209**, **#212**, **#200**, **#193**, **#235** (close after
extracting the named slices — do not rebase) · **#222**, **#202** (re-author).

---

## 6. Remediation applied (branch `fix/audit-remediation`)

### 6.1 Fixed and verified

| ID | Fix | Verification |
|---|---|---|
| **C3a** | **Inspector cross-tenant leak closed.** `tenantId` added to `InspectorTokenPayload` and to the HMAC canonical string, so it cannot be edited in the URL. All six queries across `bundle` and `lookup` now filter `tenant_id`. The mint route moved from the global `profiles.is_admin` check to `requireTenantAdmin`, so a token can only be minted for a tenant the admin actually belongs to. Both client pages carry the param through. | 3 new tests: swapped tenant → `Bad signature`; absent tenant (the pre-fix token shape) → `Invalid tenant`; malformed → `Invalid tenant`. **Every token minted before this fix now fails verification — intended, they were tenant-blind.** |
| **C2** | **`tenantGate` now enforces tenant lifecycle.** The membership lookup embeds `tenants(disabled_at)` and selects `invite_cancelled_at`, matching the DB helper the RLS policies use. Fails closed if the embed is absent. | 22 new tests in `__tests__/lib/auth/tenantGate.test.ts` |
| **C4** | **`tenantGate` has tests at last** — the boundary for 229 route files. Covers disabled tenant, cancelled invite, non-member, role escalation both ways, superadmin bypass, the DB-flag-without-allowlist case, and both PostgREST embed shapes. Already inside `test:security` via `__tests__/lib/auth`. | 22 tests |
| **C5** | **CI gate widened.** The 28-file `security-tests` subset is replaced by a `verify` job running typecheck → lint → full suite → `packages/core` suite → production build. | See §6.3 |
| **C5** | **The 2 failing tests fixed.** Both traced to one cause: `MOVED_ADMIN_ROUTES` emits a wildcard rule *and* a bare companion, and neither assertion accounted for it. The implementation was correct and documented; the tests were stale. | `adminCatalog` + `sessionFixes` green |
| **H1** | **`npm install` works on Apple Silicon.** Removed the Linux-only `@tailwindcss/oxide-linux-x64-gnu` hard `devDependency`, and added the missing `@rolldown/binding-linux-{x64,arm64}-gnu` entries so `npm ci` resolves on Linux too. The CI workaround step is deleted. | `rm -rf node_modules && npm ci` → **exit 0, no `--force`**, on this darwin/arm64 machine |
| **H2** | **Unbounded metric reads bounded.** `insightsMetrics`, `jhaMetrics`, `riskMetrics`, `nearMissMetrics` moved from `select('*')` on whole tables to column projections, server-side status/date predicates, and named `.limit()` backstops. Displayed totals now come from `count: 'exact'`, so they stay right even if a cap bites; every cap warns rather than truncating silently. | +4 tests; `packages/core` 300/300 |
| **M1** | **Inspector bundle tenant filter added** — the prerequisite for ever fixing the confined-spaces PK. | Part of C3a |
| **M2** | **18 unbounded crons capped.** `maxDuration` set per route, sized to the work (60s bounded statements, 300s multi-tenant fan-out and LLM calls), each with a reason. | `tsc` clean, cron tests pass |
| **M3** | **N+1 write loops batched.** The triple-nested loop in `equipment-readiness-reminders` (tenants × rules × admins) now inserts in 500-row chunks; `osha-reg-watch` became one `upsert … ignoreDuplicates` returning only new rows, preserving the counters exactly; `meter-bump-reminders` batched. Errors that were previously discarded now reach Sentry. | Counters verified equivalent |
| **M6** | **Chemicals policy writes are admin-only.** `restricted` and `maq` POST handlers moved to `requireTenantAdmin`; reads stay member-level because every worker needs to see what is banned. | — |
| **M7** | **Vacuous test replaced.** The "two URLs as one finding" test compared an object to its own spread; the function takes no URL, so that property is structural, not testable. Replaced with three that assert something: field-order independence, and that content hash and source id are each load-bearing. | — |
| **H4** | **Real Supabase types generated** — 20,286 lines covering 277 tables, 17 views, 38 functions, 16 enums, replacing the empty `interface Database {}`. Also fixed the `db:types` script, which wrote to `apps/web/lib/database.types.ts` while the stub everything imports lives in `packages/core/src/` — so running it would never have helped. The script now emits its own header, which the old `> file` form would have destroyed on first regeneration. | See the caveat in §6.2 |
| **C5** | **82 lint errors → 0.** Not cosmetic: several were real bugs. A "Saved." banner gated on `Date.now() - savedAt < 5000` read the clock during render, so nothing scheduled a re-render at the 5s mark and the banner lingered until some unrelated render (3 pages). Permit-expiry validation and gas-meter bump/calibration status compared against `Date.now()` during render, so **the answer froze at whenever the last render happened** (3 pages, now on a sampled clock). `useFormDraft`'s `wasRestored` was render-visible state hidden in a ref, so React never knew when it changed. | 0 errors; 72 warnings unchanged, byte-identical set |
| — | **Three literal NUL bytes removed** from source. `lib/loto/audit/agents/ehs.ts` used a raw NUL as a dedupe separator, `api/chat/channels/[id]/attachments/route.ts` had raw `0x00`/`0x1f` inside a regex, and `visionHazardTaxonomy.test.ts` had one in a test string. All three made their file read as **binary**, so plain `ripgrep` skipped them entirely. Replaced with escapes — identical values, files now UTF-8. | — |
| **D3.1** | **Anonymous BBS intake rate-limited** — per `(token, IP)`, checked before the body is parsed or the DB touched, returning 429 with `Retry-After` and no detail that would help a caller calibrate. | — |

### 6.2 Deliberately not done, and why

- **C1 (migration 257) and M4 (leaked-password protection)** are production and dashboard actions,
  not code. They need your hands — see §6.4.
- **M5 (client-only admin page protection, D4.1)** means adopting `@supabase/ssr` and moving the
  session to httpOnly cookies app-wide. Large and regression-prone; it wants its own PR and a
  staging soak, exactly as `deferred-work.md` says.
- **The confined-spaces composite PK (M1 proper)** is deliberately *not* changed. The inspector
  query that made it dangerous is now filtered, so the ordering trap is defused — but widening
  the PK is a schema migration that needs a sequenced slot and a data backfill.
- **The durable BBS throttle table** is the correct shape for D3.1 and needs a migration slot.
  The in-process limiter shipped here is a real reduction in abuse volume, not a security
  boundary, and says so in the code.
- **No migration was added by this work.** Migration-slot contention is a headline finding of this
  audit; adding an unsequenced slot would have contradicted it.
- **The generated types are not yet wired into any client, and that is deliberate.**
  Parameterising the four client entry points with `SupabaseClient<Database>` was measured: it
  produces **260 type errors**. So the file is currently inert — it checks nothing until the
  wiring lands. Shipping the wiring here would have left the branch red and blocked the CI gate,
  which is the higher-value win. The honest framing: *types generated and triaged; wiring
  sequenced as its own PR.* The categorised breakdown is below, and note that ~40 of the 260
  disappear by applying the missing migrations rather than by editing code.
- **The broken assistant permit-lookup tool** (`lib/support/tools.ts`) is left unfixed on purpose.
  It is not a typo — there is no `status` column to map to, so choosing what the assistant
  surfaces is a product decision, and with the typing off nothing would verify a guess.

### 6.3 Verified green

Every gate the new CI job runs, executed locally on this branch:

| Gate | Result |
|---|---|
| `npm run check:repo` | **PASS** |
| `tsc --noEmit` | **0 errors** |
| `eslint .` | **0 errors** (72 warnings, unchanged set) |
| `npm test` (apps/web) | **4,172 / 4,172** across 335 files |
| `npm run test:core` | **300 / 300** across 21 files |
| `npm run build` | **exit 0** |
| `rm -rf node_modules && npm ci` | **exit 0** on darwin/arm64, no `--force` |

### 6.4 The new CI gate

`.github/workflows/repo-health.yml` — the `security-tests` job is now `verify`:

```
typecheck  →  lint  →  npm test  →  npm run test:core  →  npm run build
```

⚠️ **When you enable branch protection, require `verify`, not `security-tests`** — the job was
renamed, and a protection rule pointing at the old name would block every merge.

### 6.5 Still needs your hands

These are the Phase 0 items that no code change can complete:

1. **Apply the four unapplied migrations to production** — `034`, `134`, `236`, `257` (§2.3).
   This is the live-outage fix, and it also removes ~40 of the 260 typing errors.
2. **Enable branch protection on `main`**, requiring `Repo health` and `verify`.
3. **Enable Supabase leaked-password protection** (M4) and set a minimum length.
4. **Backfill the release tags** — `scripts/backfill-version-tags.sh`, needs push credentials.
5. **Re-mint any live inspector URLs.** The C3a fix invalidates every existing one by design.

---

## 7. Phase plan

Ordered on one principle, per your instruction to make sure they can **ship safely**: the safety
net goes in *before* the backlog lands. Phases 0–1 are prerequisites for everything after them.

### Phase 0 — Stop the bleeding · ~1 day · do today

| # | Action | Where |
|---|---|---|
| 0.1 | **Apply migration 257 to production.** Paste `257_predictive_safety_intelligence.sql` into the Supabase SQL editor. Verify `vision_sweep_runs`, `vision_sweep_photos`, `vision_hazard_signals`, `document_drafts` exist, then confirm `vision-sweep-resume` goes green. | Supabase dashboard |
| 0.2 | **Audit every other unapplied migration.** Probe production for a distinctive object from each of `243`–`256` before assuming 257 was the only gap. | read-only SQL |
| 0.3 | **Enable branch protection on `main`** — require PR, require `Repo health` + `Wiki sync`, require up-to-date branches, block force-push and deletion. | GitHub settings |
| 0.4 | **Enable Supabase leaked-password protection** and set the minimum length (M4/D4.4). | Supabase dashboard |
| 0.5 | **Backfill release tags** — `DRY_RUN=1 bash scripts/backfill-version-tags.sh`, review, then run for real. | local, your credentials |
| 0.6 | **Close the STRIKE answer-key leak (C3).** Land **#271**, applying migration `259` **before** the deploy — the code change alone does not close it. | PR #271 |
| 0.7 | **Update `CHANGELOG.md`** — move #279/#280/#281 out of `[Unreleased]`. | `CHANGELOG.md` |

**Exit criteria:** no cron erroring in production; `main` protected; answer keys no longer
readable; tags match shipped versions.

### Phase 1 — Build the safety net · ~1 week · blocks everything downstream

| # | Action | Notes |
|---|---|---|
| 1.1 | **Introduce a migration ledger.** A `schema_migrations` table plus an idempotent apply script, so "did this ship?" is answerable. This is the root cause of 0.1 and it will recur until fixed. | new; retro-stamp 001–257 as applied |
| 1.2 | **Commit the RLS `(select …)` rewrite as a migration (258).** Capture what production already has so the repo reproduces it (§2.4). | generate from `pg_policies` |
| 1.3 | **Add `000_baseline.sql`** capturing `loto_equipment` and every other pre-chain table (§2.5). | `pg_dump --schema-only` as the seed |
| 1.4 | **Turn on the full CI gate — ~1 day, not weeks.** Fix the 2 failing tests (`adminCatalog` redirect count), clear the 82 lint errors (58 are unused-vars), then land **PR #276**. `tsc --noEmit` is *already* clean. | D4.2 — see the measured table in C4 |
| 1.5 | **Fix the lockfile both ways** (H1) — regenerate so it records Linux *and* darwin bindings; drop `@tailwindcss/oxide-linux-x64-gnu` as a hard dep; delete the CI workaround. | D4.3; own PR, touches whole lockfile |
| 1.6 | **Generate real Supabase types** (H4) — run `npm run db:types`, commit, add a CI drift check. | turns 272 unchecked `select()`s into typed ones |

**Exit criteria:** CI red means broken; a fresh clone installs on macOS *and* Linux; the repo can
rebuild the database.

### Phase 2 — Close the security gaps · ~1 week

| # | Action |
|---|---|
| 2.1 | **Fix `tenantGate`** (C2): join `tenants.disabled_at` and `tenant_memberships.invite_cancelled_at` into the membership lookup so `requireTenantMember`/`requireTenantAdmin` match the DB helper. |
| 2.2 | **Write the first `tenantGate` tests** (C3): disabled tenant, cancelled invite, non-member, role escalation, superadmin bypass. Add to `test:security`. |
| 2.3 | **Move chemicals `restricted` + `maq` routes to `requireTenantAdmin`** (M6). |
| 2.4 | **Rate-limit the anonymous BBS intake** (D3.1) — mirror migration 067's throttle pattern. |
| 2.5 | **Fix the inspector bundle's missing tenant filter** (M1) — *before* touching the confined-spaces PK. |
| 2.6 | Revoke `EXECUTE` on the SECURITY DEFINER helpers from `anon`/`authenticated` where not needed. |
| 2.7 | Invite-lifecycle audit trail + token edge cases (D4.5, D4.6). |

### Phase 3 — Land the backlog · ~3–4 weeks

Follow the nine waves in **§5.4**. The rules that keep it safe:

- **Wave 1's first three merge in strict order** (#278 → #271 → #272) — they hold the only three
  free migration slots.
- **Wave 2 (#276) before anything large.** Until the gate is real, "checks green" carries almost
  no information — which is why all 36 of these needed hand-triage.
- **Migration-bearing PRs land one at a time**, renumbered at the moment of rebase. The allocation
  in §5.1 is invalidated by any out-of-order merge.
- **Two PRs must have their migration applied *before* their code deploys** — #271 (the column
  grant *is* the fix) and #212 (`get_gate_context` fronts ~220 routes; deploy-first means every
  authenticated route fails closed with a 500).
- **Close before rebasing** (§5.5). Six PRs are better re-authored than rebased; #217 is a pure
  duplicate.
- Delete the 132 already-merged remote branches (`scripts/cleanup-stale-branches.sh`).

### Phase 4 — Performance before it bites · ~2 weeks

| # | Action |
|---|---|
| 4.1 | Move the four `select('*')` metric loaders behind server endpoints with date floors and limits (H2). |
| 4.2 | Add pagination to the 55 unbounded GET endpoints (H3). |
| 4.3 | Set `maxDuration` on the 18 crons missing it; batch the N+1 write loops (M2, M3). |
| 4.4 | Code-split `AppChrome`; add `/api/bootstrap` to collapse the auth/tenant round-trips. |
| 4.5 | Run the k6/artillery staging load test the scale audit calls for and never got. |

> Scale-audit P0-2, P0-3 and P0-8 are **already done** (migrations 241, 242 — verified applied).
> The training-matrix composite index is live; the 186× win is banked.

### Phase 5 — Complete the modules · ongoing, deadline-driven

| Priority | Work | Driver |
|---|---|---|
| **1** | **HazCom 2024** written program + labels tracker + retraining course | **Hard deadline 20 Nov 2026** |
| **2** | Cal/OSHA workplace violence prevention (violent-incident log, 5-yr retention) | 1 Jan 2027; statute already in force |
| **3** | Cal/OSHA heat §3396 measurement log | already enforceable |
| 4 | **Write the 40 placeholder manuals**; strengthen `check-manual-coverage.mjs` to assert content, not just row existence | every module's user-facing docs are `**Edit me.**` |
| 5 | BBS photo upload endpoint (D3.2); Working at Heights Phase 3; Fleet journey planning | named, visible gaps |
| 6 | Wiki pages for the 18 modules that have none | |
| 7 | Mobile parity + store config (fill the 5 `REPLACE_WITH_…` placeholders, then **remove** the `ALLOW_DEEPLINK_PLACEHOLDERS=1` bypass) | unblocks TestFlight / Play |
| 8 | Injury case management Phases 1–3 (180-day cap, First Report of Injury, RTW) | workers-comp statutory forms |

---

## 8. How to verify

```bash
# Phase 0 — the migration actually applied
#   in the Supabase SQL editor, or via read-only MCP:
select to_regclass('public.vision_sweep_runs')     is not null,
       to_regclass('public.vision_hazard_signals') is not null;
#   then watch the cron go green:
gh run list --branch main --limit 5

# Phase 0 — branch protection is on
gh api repos/DevJ1975/lotoviewer/branches/main/protection | jq '.required_status_checks.contexts'

# Phase 0 — tags match shipped versions
git tag --sort=-creatordate | head        # expect v1.17.1 … v1.9.0, not just v1.8.0

# Phase 1 — a fresh clone installs on this machine (currently fails)
rm -rf node_modules && npm install        # must succeed WITHOUT --force

# Phase 1 — the gate is real
npm run check:repo && npm run lint && npm test && npx tsc --noEmit
npm --workspace web run build

# Phase 2 — the tenant gate holds
npm run test:security                     # must include the new tenantGate tests
#   manual: disable a tenant in /superadmin, then confirm an already-signed-in
#   member of that tenant gets 403 from an API route — not just a blank page

# Phase 3 — before each merge
npm run doctor:git
npm run check:migrations                  # no duplicate prefix above 257

# Phase 4 — measure, don't guess
#   EXPLAIN ANALYZE the insights queries at synthetic scale, then k6 against staging
```

---

## 9. Sources

Repository state verified at `13ba4f18` on 2026-08-20 via `git`, `gh`, and read-only SQL against
the production Supabase project. Prior analysis this builds on:
`docs/deferred-work.md` (D0.1–D4.6), `docs/audits/scale-audit-6500-users.md`,
`docs/performance-audit-2026-05-13.md`, `docs/regulatory-review-2026-07.md`,
`docs/injury-case-management-plan.md`, `docs/mobile-parity-plan.md`, `todos.md`.

**Corrections to the existing docs**, found while verifying:

| Doc claim | Actual |
|---|---|
| `deferred-work.md` D4.3 — lockfile has no Linux rolldown binding | Partly fixed; the **macOS** side is now the broken one (H1) |
| `deferred-work.md` D3.4 — web `loto_steps` typo open | Fixed; zero `from('loto_steps')` hits remain |
| `deferred-work.md` D1.1 — move `lib/supabase.ts` to `packages/core` | Done via D1.3, never struck out |
| Scale audit P0-1 — RLS not wrapped | **Applied in production, absent from the repo** (§2.4) |
| Scale audit P0-2/P0-3/P0-8 | **Shipped** — migrations 241 and 242, verified applied |
| `todos.md` — 81 test failures; D4.2 — 127 failures / 22 files | **2 failures / 4,150 tests** (measured) |
| `POSTURE.md` — `tsc --noEmit` "never ran clean" | **0 errors** (measured) |
| `PROJECT_OVERVIEW.md` — "153 tests passing", one migration file | Badly stale; 354 test files, 263 migrations |
| Supabase advisor — `exec_readonly_sql` callable by signed-in users | Guarded internally by `is_superadmin()`; not a breach |
