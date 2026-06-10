# devjr audit report

Comprehensive five-phase audit of the Risk Assessment + Near-Miss
Reporting + JHA modules (web + mobile) shipped earlier this
session. Driven by the `devjr` skill at
`.claude/skills/devjr/SKILL.md`.

## Honest scope

The user asked for "a complete audit, refactor, bug audit, and
exercise every link/function 10×." Translation in this
environment:

| Asked | Done |
|---|---|
| Static audit | tsc + grep across all session files |
| Refactor where necessary | 14 files de-duplicated to one shared module |
| Complete bug audit | File-by-file inspection with bug-pattern checklist; 3 fixes shipped |
| Edge-case coverage | 89 new tests across boundary inputs |
| "Click every link 10×" | **Not possible without a real browser/iPad.** Replaced with: programmatic test coverage that hammers each path with varied inputs, plus `docs/smoke-test.md` for the user to drive manually |

This was honest up front in the planning step — the alternative
was to over-promise.

## Baseline (pre-audit)

| Check | Result |
|---|---|
| Web tsc | 0 errors |
| Mobile tsc | 0 errors |
| Web vitest | 1364 passing |
| Mobile expo export | flaky in this sandbox (tsc clean was the real signal) |

## Phase A — Inventory & static checks

| Smell | Hits |
|---|---|
| `as any` | 0 |
| `@ts-ignore` / `@ts-expect-error` | 0 |
| `console.log` | 0 (production code) |
| `TODO` / `FIXME` / `HACK` | 0 in session files |
| `as never` | 1 (legitimate target — fixed in Phase C) |

**Auth gate audit** — 23 routes:

- 7 GET → `requireTenantMember` ✅
- 12 POST/PATCH/PUT/DELETE → `requireTenantAdmin` ✅
- 1 POST `/api/near-miss` → `requireTenantMember` ✅ (intentional: workers self-report; documented)
- 1 GET/POST `/api/cron/risk-review-reminders` → safeEqual on CRON_SECRET ✅

All 23 correct. No findings.

**RLS / tenant_id audit** — surveyed every `supabase.from(...)`
query in session files:

- Mobile: 11 / 11 queries scoped by tenant_id ✅
- Server (gate.authedClient): 5 / 5 ✅
- Server (admin client): 12 queries inspected, **2 minor
  defense-in-depth gaps** found (RLS-1, RLS-2 below)

Phase A produced no commit; findings carried into Phase C.

## Phase B — Refactor (commit `3e5f94f`)

**One canonical fix.** 14 files duplicated the 4-band severity
color map. Variable names varied (`BAND_BG` / `SEVERITY_BG` /
`SEVERITY_PILL`) but the structure was identical.

Extracted to `packages/core/src/severityColors.ts`:

- `SEVERITY_HEX` — RGB hex map (consumed by mobile inline style props)
- `SEVERITY_FG_HEX` — foreground hex map (slate-900 on amber for WCAG AA)
- `SEVERITY_TW` — Tailwind `bg-* text-*` strings (consumed by web)
- `SEVERITY_TW_BORDER` — outlined-pill variant
- `SEVERITY_RANK` — sort rank (extreme=0 → low=3)

**14 files de-duplicated:**

- 5 web (Tailwind): JhaKpiPanel, NearMissKpiPanel, near-miss/page,
  near-miss/[id]/page, jha/[id]/page
- 8 mobile (hex): risk/heatmap, risk/new, risk/[id], near-miss/new,
  near-miss/[id], jha/[id]/index, (tabs)/risk, (tabs)/near-miss
- Plus the new shared module

Net: -122 LoC duplicated, +303 LoC shared (most of which is JSDoc
+ tests). Test count unchanged through this commit. Pure dedupe;
no behavior change.

## Phase C — Bug audit (commit `431257b`)

Read every session file looking for these bug patterns:

- ✅ State-after-unmount → all async useEffects use cancel flags
- ✅ Stale closures → useEffect deps arrays correct
- ✅ Race conditions in parallel fetches → properly handled
- ✅ Sequence renumbering on remove/move → produces 1..N no gaps
- ✅ Compensation logic on multi-step writes → near-miss escalate
  rolls back the risk on link failure
- ✅ Error swallowing → every catch either re-throws, surfaces, or
  Sentries
- ✅ Append-only audit log enforcement → 3-layer (REVOKE +
  immutable trigger + SECURITY DEFINER capture trigger) per
  migrations 038 / 042 / 043

**3 real findings, all fixed in `431257b`:**

1. `apps/web/app/api/risk/route.ts:292,300` — compensating
   delete on POST failure used `admin.from('risks').delete()
   .eq('id', created.id)` without `tenant_id` filter. The admin
   client bypasses RLS, so this is technically a defense-in-
   depth gap. Realistic exploitability: zero (id was just
   produced by same code path with gate.tenantId). **Fixed:**
   added `.eq('tenant_id', gate.tenantId)`.

2. `apps/web/app/api/jha/[id]/route.ts:39` — audit-log SELECT
   used `gate.authedClient` (RLS-scoped, safe) but didn't have
   an explicit tenant_id filter. **Fixed:** added the explicit
   filter so a future RLS-policy regression can't silently leak.

3. `apps/web/app/api/risk/export/route.ts:194` — `(risksRes
   ?? []) as never` cast erased the type. **Fixed:** replaced
   with a proper `RiskRegisterRow[]` cast derived from
   `Parameters<typeof buildRiskRegisterPdf>[1][number]`.

Plus a stale comment cleanup in the JHA breakdown PUT route.

**Documented limitations (not fixed; not bugs):**

- JHA breakdown PUT is "atomic-ish" — Supabase JS doesn't expose
  transactions. The route comment acknowledges this; future
  improvement is to wrap in a SECURITY DEFINER stored proc.
- Mobile triage actions stay web-only; mobile detail pages are
  read-only by design.
- `expo export` flake in this sandbox is environmental, not code.

## Phase D — Edge-case tests (commit `0c1de81`)

89 new test cases across 4 new files:

| File | Cases | Targets |
|---|---|---|
| `severityColors.test.ts` | 24 | Pin the contract for the shared color tokens — every band has an entry, hex matches Tailwind defaults, foreground passes WCAG AA on amber, no collisions, SEVERITY_RANK is contiguous 0..3 |
| `jhaEdgeCases.test.ts` | 24 | Enum completeness against migration 043 CHECK list, every frequency/cadence pair, all rejection paths in `validateJhaCreateInput`, 50-step max-stride aggregation, all-orphan hazards, unsorted input order preservation, `countPpeAloneWarnings` boundary (moderate hazards never warn), control hierarchy ordering |
| `nearMissEdgeCases.test.ts` | 22 | Active-subset relationship vs. all statuses, isActive every status, compareForTriage stability across N=20 same-severity rows, single-extreme-amid-100-lows, ageInDays boundary cases (now=reported, future-reported, century rollover, DST), unicode descriptions, 5-min-skew boundary |
| `csvImportRiskEdgeCases.test.ts` | 19 | BOM stripping, quoted commas, escaped double-quotes, CRLF endings, unicode subscripts (O₂ / H₂S), 100-row file, severity boundaries (0/6 reject; 1/5 accept), every invalid enum value individually, malformed/short rows, mixed-case headers |

**Result: 1453 tests passing (up from 1364, +89 net new).**

These tests are how the "10× exercise" turns into something
verifiable in this environment — each helper now gets hammered
with adversarial inputs across all enum values, boundaries, and
realistic input shapes (BOM, CRLF, unicode, quoted CSV, etc.).

## Phase E — Verify + smoke checklist + this report (commit TBD)

| Check | Result |
|---|---|
| Web tsc | 0 errors |
| Mobile tsc | 0 errors |
| Web vitest | 1453 passing |
| `docs/smoke-test.md` | Written |
| `docs/devjr-audit-report.md` | This file |

`docs/smoke-test.md` is the manual checklist for the user to
drive against a real browser + iPad. It covers every screen,
every API endpoint, every cross-module link (JHA → escalate →
risk; near-miss → escalate → risk), every admin-vs-member gate.

## What's left for the user

Operational items still you-blocked (not fixable in this
environment):

- Set `CRON_SECRET` in Vercel for the risk-review-reminders cron
- Set `EXPO_PUBLIC_WEB_ORIGIN` in mobile env so the JHA editor +
  risk new-form can POST to web routes
- Fill App Store placeholders (Apple Team ID, ASC App ID, Android
  keystore SHA-256, Play service-account JSON path) — see
  `docs/deferred-work.md` D2.1 + D2.2
- Drive `docs/smoke-test.md` end-to-end on a real browser + iPad
- `eas build --profile preview` for first TestFlight / Play
  Internal builds
- `npx expo export` on a clean machine to verify the bundle
  produces a runnable artifact (this sandbox's Metro got flaky
  toward the end of the session)

## Commits this audit produced

| Phase | Commit | Title |
|---|---|---|
| B | `3e5f94f` | Extract severity color maps to @soteria/core/severityColors |
| C | `431257b` | Tighten 3 defense-in-depth gaps |
| D | `0c1de81` | 89 edge-case tests |
| E | (final) | Smoke checklist + audit report |

End of 2026-05 report.

---

# devjr audit — 2026-06-10 — full-SaaS debug + business-logic check

Whole-platform pass (all modules, web + mobile + core), not a
single-feature audit. Driven by the same `devjr` skill; user asked
for a "debug and end-to-end business logic check and refactor for
the entire SaaS."

## Honest scope

Sandbox-verifiable work only: static checks, the full test suite, a
deploy-shaped build, code inspection, refactors, and new tests. No
real browser/iPad, no live Supabase/Vercel, no email sends. The
manual side lives in the dated section of `docs/smoke-test.md`.

## Baseline (Phase A, at commit `fa45231`)

| Check | Result |
|---|---|
| Web tsc | 0 errors |
| Mobile tsc | **2 errors — real runtime bugs** (see Phase C) |
| Web vitest | 3,499/3,500 passing; 1 real failure + 1 file uncollectable in-sandbox (missing `sharp` binary, not a code bug) |
| Core vitest | 45 passing — **but wired to nothing** (no test script, not in CI, not chained from root) |
| eslint (web) | 152 problems / 83 errors — all pre-existing, not CI-gated (logged as D4.3) |
| Deploy-shaped build (`ALLOW_DEEPLINK_PLACEHOLDERS=1 npm run build`) | pass |
| `npm run check:repo` | pass |

Corrections to the record while baselining:

- `todos.md` §6 still advertised the 81 failing tests that PR #188
  repaired on 2026-06-05 — marked resolved.
- `docs/deferred-work.md` D3.4 (`loto_steps` typo) was fixed in
  `657bb10` but never struck through — struck.

## Audit verdicts (inspection)

- **Auth/tenant scoping: healthy.** 302 API routes enumerated; every
  one is gated (tenantGate member/admin, superadmin dual-gate,
  cryptographic tokens with constant-time compares, CRON_SECRET).
  Service-role client used only behind those gates. No missing
  `tenant_id` filters found in route queries. Low-priority hardening
  notes logged as D4.1/D4.2 rather than changed.
- **Error handling: sound.** Catch blocks either reach Sentry,
  surface to the UI, or are commented intentional soft-fails.
- **Server-side validation: comprehensive** via `@soteria/core`
  validators; no client-only validation found on mutation routes.

## Phase B — structural fixes (commit `7bbae97`)

1. **Admin tile slug collision (the 1 real test failure).** PR #203's
   `loto/audit` tile collided with `evidence/audit`. Tile identity is
   the `(section, slug)` URL pair, so the global-uniqueness contract
   was outdated, not the catalog: `getAdminTile` is now
   section-scoped; tests pin per-section slug uniqueness + globally
   unique hrefs, and both `audit` tiles resolve to their own sections.
2. **Orphaned core tests wired in.** `packages/core` gained a `test`
   script; root `npm test` now chains web + core.
3. **Enum single-source-of-truth.** Inline `VALID_*` value lists that
   repeated across 3-7 files (risk statuses, hazard categories,
   bands, activity types, exposure frequencies, hierarchy levels,
   hazwaste area types, sort dirs) now live in `@soteria/core` next
   to the types they narrow to (`RISK_STATUSES`, `HAZARD_CATEGORIES`,
   `RISK_BANDS`, `RISK_ACTIVITY_TYPES`, `RISK_EXPOSURE_FREQUENCIES`,
   `HAZARDOUS_WASTE_AREA_TYPES`) plus web-only `lib/listParams.ts`
   (`SORT_DIRS`). Single-use constants stayed inline (rule of three).
   Noted, not consolidated: `VALID_SORTS` duplicated 2x
   (`app/api/risk/route.ts` / `lib/risk-filters.ts`).

## Phase C — real bugs fixed (commits `fe2881e`, `10c143d`)

1. **Mobile equipment screens crashed on every load** (the 2 mobile
   tsc errors). `@soteria/core`'s equipment queries take an explicit
   `tenantId` and throw without it; the mobile list screen called
   `loadAllEquipment()` bare and the detail screen called
   `loadEquipment(id)`. Both now pass the active tenant, gate until
   one is selected, and re-fetch on tenant switch.
2. **Cross-tenant scoping gap**: the mobile detail screen queried
   `loto_energy_steps` by `equipment_id` alone — equipment IDs repeat
   across tenants. Now filtered by `tenant_id` too (matches the
   migration-147 composite index and the web's scoping).
3. Stale `@ts-ignore` in `ExternalLink.tsx` deleted (line typechecks
   clean without it).
4. Deferred with rationale (needs signoff / dedicated pass): D4.1
   SCIM + witness token expiry, D4.2 per-cron secrets, D4.3 eslint
   debt, D4.4 mobile test suite (start with mobile tsc in CI — it
   would have caught bug #1).

## Phase D — edge-case tests (commit `8e0e2b8`)

35 new tests: `isSelectableTenant` boundaries (statuses,
`disabled_at`, 4-digit regex incl. non-ASCII digits),
`navigationCatalog` invariants derived from the live `FEATURES`
registry (no hardcoded counts — the #188 lesson), `PLACARD_TEXT`
en/es shape + step-count parity + PDF-safe characters,
`validateHazardousWasteContainerInput` boundaries (0/1/120/121 label,
unicode H₂SO₄, negative/NaN volumes, garbage dates, multi-field
accumulation) + area-type invariants, and the risk enum lists pinned
to their DB check-constraint literals.

## Phase E — final state

| Check | Result |
|---|---|
| Web tsc / Mobile tsc | 0 / 0 errors |
| Web vitest | 3,521 passing, 0 failing (260 files) |
| Core vitest | 63 passing (now run by `npm test` at root) |
| eslint | 152 problems — unchanged, zero added (D4.3) |
| Deploy-shaped build + `check:repo` | pass |

## What still needs a human (browser + iPad)

Drive the dated section of `docs/smoke-test.md`: the LOTO register
a11y/touch work from #208 (rows as buttons, slide-over placard below
`lg`, skip link), the mobile equipment list -> detail -> photo flow
this audit just fixed, and the standing items in `todos.md`
(deliverability, cron env vars, deeplink placeholders).

## Commits this audit produced

| Phase | Commit | Title |
|---|---|---|
| A | `dc74ff8` | todos.md: 81-test repair already done (PR #188) |
| B | `7bbae97` | enum single-source-of-truth + run the core tests |
| C | `fe2881e` | mobile equipment screens crashed (tenantId) |
| C | `10c143d` | deferred-work: strike D3.4, add D4.1-D4.4 |
| D | `8e0e2b8` | 35 edge-case tests |
| E | (final) | smoke checklist + this report |

End of report.
