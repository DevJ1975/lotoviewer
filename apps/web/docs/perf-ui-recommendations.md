# Performance & UI Recommendations — June 2026 audit

Scope: requested review of performance and UI across the app, prioritized for
the LOTO register (highest-traffic screen) and the field-iPad experience.
Items 1–7 under "Shipped" landed with this audit; everything else is a
prioritized backlog with file references so each item can be picked up cold.

## What is already strong — do not regress

The LOTO dashboard's performance posture is genuinely good; none of the items
below are about making it faster:

- **Stale-while-revalidate cache** (`app/loto/page.tsx` → localStorage):
  instant first paint on PWA reload, background fetch reconciles drift.
- **RAF-coalesced realtime**: bursts of `postgres_changes` events (CSV import,
  bulk update) collapse into one reconcile per frame.
- **Memoized rows + `content-visibility: auto`** (`EquipmentListPanel`):
  near-virtualization without a dependency; ~1000-row lists stay responsive.
- **Lazy PDF generation**: `pdf-lib` codepaths (`lib/pdfPlacard`, `lib/report`)
  are `await import()`-ed from BatchPrintModal / StatusReportButton /
  PlacardPdfPreview — they never weigh down the dashboard bundle.
- **Fonts/images**: `next/font` with `display: swap`; `next/image` with
  Supabase `remotePatterns`.
- Route-level `error.tsx` / `global-error.tsx` boundaries are in place.

## Shipped with this audit (LOTO-first: a11y, touch, UI consistency)

1. **PWA/status-bar chrome color** now matches the steel-deep header
   (`#0E1A2E`) instead of the retired navy — `app/layout.tsx`,
   `public/manifest.json`.
2. **WCAG AA contrast**: `--color-caution-orange` darkened `#EA580C → #C2410C`
   (3.6:1 → 5.2:1 for the white 11px safety-tag text) — `app/globals.css`.
3. **Screen-reader pass** over the register: named search input, `aria-pressed`
   filter chips, `aria-current` selection (sidebar + rows), a real
   `progressbar` for overall completion, decorative dots/mini-bars hidden,
   sr-only "Verified" — `components/dashboard/*`.
4. **Shared primitives for edge states**: filtered-to-zero list uses
   `EmptyState` with a Clear Filters action; placard loading uses `OpsSpinner`.
5. **Skip-to-content link** as the shell's first Tab stop — `AppChrome.tsx`.
6. **Register rows are real buttons** (Tab/Enter/Space, inset focus ring,
   `aria-current`), and the **flag control works on touch**: still a 24px
   hover-reveal for mouse users, but always visible at 44px on coarse pointers
   (`pointer-coarse:` variants) instead of being invisible on iPads.
7. **iPad-portrait master-detail**: below `lg` the placard panel is a
   right-anchored slide-over (scrim, Escape, 44px close, scroll lock) instead
   of stacking two screens below the list. Desktop ≥1024px is untouched.

## Performance backlog (prioritized)

### High
- **Admin scorecard waterfall** — `app/admin/insights/scorecard/page.tsx`
  runs ~6 independent `useEffect` fetches (scorecard metrics, incident
  metrics, OSHA summaries, establishments, targets, incident-risk). Merge the
  independent ones into a single effect with `Promise.all` (~200–300 ms
  saved), and consider one server-side aggregation endpoint.
- **Eager `recharts` import on the scorecard** (~40–60 KB gz on first paint).
  Load the chart section with `next/dynamic` so the KPIs paint first.
- **`persistTargets()` serial loop** (same file, ~lines 244–262): each metric
  awaits a delete then an insert. Batch the deletes and inserts, or
  `Promise.all` the per-metric pairs.

### Medium
- **No HTTP cache headers on read-heavy GETs** — e.g.
  `app/api/admin/review-links` (returns 50 rows), `app/api/admin/members`.
  Short `Cache-Control: private, max-age=…` (or an ETag) would cut repeat
  latency for roster-style data.
- **Member-creation waterfall** — `lib/members/server.ts:138-180` does four
  sequential round-trips on the cold path; the membership and profile lookups
  are independent and can run in parallel.
- **LOTO list `select('*')`** — `app/loto/page.tsx:88-93` documents the
  rollback from a narrow projection after a schema-mismatch error. Once the
  offending column is identified (the fetch now logs the PostgREST message),
  restore the narrow projection: it trims notes/large text from every
  dashboard load. Note `PlacardDetailPanel`'s full-row re-fetch then becomes
  load-bearing again — keep it.

### Low
- **Pagination hygiene**: BBS dashboard fetches `.limit(1000)` with no cursor;
  the superadmin daily cron aggregates `.limit(50_000)` rows in memory. Both
  work today; both will degrade silently with tenant growth.
- **Auth-gate duplication**: `requireTenantAdmin()` is re-implemented inside
  some routes (e.g. `app/api/admin/review-links/route.ts`) instead of imported
  from `lib/auth/tenantGate.ts`. Consolidate so policy fixes land once.

## UI / accessibility backlog

- **Replicate the row pattern**: other module list views (incidents, permits,
  hazardous waste) share the clickable-div/hover-reveal idiom that the LOTO
  register just fixed. The `EquipmentRow` structure (row button + absolutely
  positioned sibling action, `pointer-coarse:` sizing, inset focus ring) is
  the template.
- **Finish the token migration**: legacy hexes (`#1B3A6B` et al.) still appear
  outside `globals.css`; Spectrum 2 migration (Phase 2b/2c comments in
  `globals.css`) is mid-flight. A grep-able rule — raw hex belongs only in
  token definitions — would stop reintroductions.
- **Module guard boilerplate**: `ModuleGuard` + `ModuleHeaderAccent` wrap
  nearly every module route by hand; hoisting them into the module `layout.tsx`
  files removes the per-page repetition.
- **FormShell field duplication**: `/admin/working-at-heights` has 5+
  near-identical form pages; the field definitions could be data, not JSX.
- **Theme contrast audit**: caution-orange was the only measured AA failure,
  but dark-mode and `[data-theme="field"]` combinations haven't been swept
  systematically (the field theme targets AAA — worth verifying it still
  holds across the safety-tag family).

## Pre-existing defects noticed during verification (not addressed here)

- **`adminCatalog` duplicate slug** — "Multi-agent audit" and "Audit log" both
  use slug `audit`, which fails
  `__tests__/lib/adminCatalog.test.ts > uses unique slugs across every
  section` on main. Renaming either changes its URL, so the owning team
  should pick the survivor.
- **`react-hooks/refs` lint error** at `app/loto/page.tsx:196` — the
  documented render-phase `searchParamsRef` sync predates this audit; an
  effect-based sync changes its timing semantics, so it was left for a
  deliberate follow-up.
