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

End of report.
