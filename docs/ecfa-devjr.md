# Events & Causal Factors (ECFA) — devjr audit report

Comprehensive audit of the **drag-and-drop ECFA editor** shipped in PR #252
(v1.16.0): the reorder/move engine in `@soteria/core`, the batch-PATCH API,
the `EcfaBoard` editor, and its fold-in to the Investigate & RCA dossier. No
DB migration in this feature (schema landed with ECFA v1.15.0 / #249).

## Scope audited

| Area | File |
|---|---|
| Pure reorder/move/layout math + validators | `packages/core/src/ecfaSchemas.ts` |
| Batch-PATCH + CRUD route | `apps/web/app/api/incidents/[id]/ecfa/route.ts` |
| Drag-and-drop editor | `apps/web/app/incidents/[id]/ecfa/_components/EcfaBoard.tsx` |
| SVG chart renderer | `…/ecfa/_components/EcfaChart.tsx` |
| PDF export | `apps/web/lib/pdfEcfaChart.ts` |
| Fold-in + legacy redirect | `…/investigate/page.tsx`, `…/ecfa/page.tsx` |

## Baseline (the floor — any commit that drops these is a regression)

| Metric | Result |
|---|---|
| Web `tsc --noEmit` | **0 errors** |
| Web `vitest run` | **301 files / 3839 tests passing** |
| Core `vitest run` | **14 files / 157 tests passing** (→ 15 / 206 after this audit) |
| `check:repo` (CI gate) | **pass** — migrations, manuals (40), nav-sync (33 wiki + 52 admin), version (1.16.0) |
| `as any` / `@ts-ignore` / `console.log` / `TODO` in ECFA surface | **0** |
| Auth-gate audit | **clean** — see below |
| RLS scope audit | **clean** — see below |

**Sandbox caveat (not a code issue).** Two native bindings needed manual
placement because the committed lockfile was generated on macOS and the
sandbox blocks postinstall binary fetches (proxy 403 on GitHub/CDN):
`@rolldown/binding-linux-x64-gnu` (vitest 4) and `@img/sharp-linux-x64`
(+ libvips). With those present the suite is fully green. In CI / on the
author's machine these install normally.

**Deploy caveat (pre-existing, not ECFA).** `npm run build` fails `prebuild`
on deep-link credential placeholders in `apple-app-site-association`,
`assetlinks.json`, and `eas.json` (`REPLACE_WITH_APPLE_TEAM_ID`, …). These
are mobile-signing placeholders from the TestFlight runbook (#251), on files
this feature never touched. They need real Apple/Google credentials before a
production deploy — a manual step, not a code fix.

## Auth & RLS audit

- **Reads** (`GET`) use the RLS-scoped `gate.authedClient`, filtered by
  `tenant_id` + `investigation_id`.
- **Writes** (`POST`/`PATCH`/`DELETE`) gate with `requireTenantMember`, then
  `resolveInvestigation` enforces *admin role **or** lead investigator **or**
  team member* before any service-role write. Every write is scoped by
  `.eq('id', …).eq('investigation_id', …).eq('tenant_id', …)`. No ungated
  service-role usage; no query missing the tenant filter.
- **AI assist** route is `requireTenantAdmin`-gated, matching the UI's
  `isAdmin && !readOnly` guard.
- The member-level write gate is **collaborative by design** (mirrors the RCA
  and JHA routes) — ECFA editing is a team activity, not an admin-only one.
  Documented, not a finding.

## Findings shipped

### C1 — Batch reorder rolled back to a stale snapshot on partial failure ✅
`EcfaBoard.commitPatches` applied a drag optimistically, then on a failed
batch `PATCH` did `setNodes(prev)` — reverting to the **pre-move snapshot**.
But the batch is explicitly *non-transactional* (supabase-js has no multi-row
transaction; the route's own comment says the client "reconciles by
reloading"). If one update in the batch failed while others committed, the
server held a **partial** reorder while the client snapped back to the old
picture — a silent client/server divergence that persisted until a manual
refresh.

**Fix:** on error, surface the message **and `await load()`** to re-read
authoritative state. This strictly dominates the old behavior — if the whole
batch failed atomically, the reload returns the unchanged state (identical to
the rollback); if it partially applied, the reload shows the truth. The now-
unused `prev` snapshot was removed.

### C2 — PDF export failed silently ✅
`downloadPdf` (dynamic-imports `pdf-lib`, then builds/downloads the chart) had
no error handling and was called via `onClick={() => void downloadPdf()}`. A
chunk-load failure (stale deploy) or a `pdf-lib` error left the button doing
**nothing** — no feedback — while every other action in the component surfaces
errors via `setError`. **Fix:** wrap the body in `try/catch → setError`.

## Findings NOT shipped (considered / deferred)

### `load()` has no request-race / unmount guard
Both `EcfaBoard.load` and `InvestigatePage.load` are async effects without a
cancellation token. Considered and **deliberately not changed**: React 19
no-ops `setState` after unmount (no leak, no warning); the initial load gates
the UI behind `loading`; subsequent loads are serialized by `busy`; and a
tenant switch unmounts the incident page rather than re-fetching in place. The
realistic race window is negligible, and a generation-counter guard would add
indirection a junior reader would puzzle over. Revisit only if a live tenant
switcher that re-renders this page in place is introduced.

### `NodeControls` barrier field can hold stale local state
The failed-barrier `<input>` seeds `useState(node.failed_barrier ?? '')`,
which only runs on mount. If the barrier changes externally (a collaborator's
edit lands via reload), the local value won't resync and a later `onBlur`
could re-submit the stale text. Low impact (same user typically edits a given
node); deferred.

### `authedHeaders` duplication is app-wide, not ECFA-local
The "get session → build `{content-type, x-active-tenant, authorization}`"
pattern is duplicated in `EcfaBoard`, `InvestigatePage`, `PublishLessonSection`
— and dozens of other client components. A shared `getAuthHeaders()` /
`authedFetch()` helper would be a genuine improvement but is a large cross-
cutting refactor, out of scope for this feature's diff. Recommended as its own
PR.

### `EcfaBoard` render test is intermittently flaky in jsdom
`EcfaBoard.test.tsx`'s "renders drag affordances" assertion occasionally
misses the react-aria drag-handle `aria-label` under parallel runs — the test
file itself notes react-aria pointer drags "are not reliably simulable in
jsdom." Test-only robustness; the reorder/move math is exhaustively covered in
core instead.

## Tests added (this audit)

| File | Count | Covers |
|---|---|---|
| `packages/core/src/__tests__/ecfaSchemas.edge.test.ts` | **49** | title boundaries (300/301 cap), every enum value, unicode/emoji/quote titles, `renumberSequence` empty/single/large/negative, `reorderNodes` ends & no-ops, `moveCondition` index clamping + minimal-patch contract + source compaction, `applyEcfaPatches` identity/merge/unknowns, `layoutEcfaChart` bands / null-lane / incident-only / multi-incident / long-label passthrough / stable id ordering, `summarizeCausalFactors` barrier-trim & full spread |
| `apps/web/__tests__/api/ecfa/route.test.ts` (extended) | **+8** | batch at the 200-row cap, empty array, array-as-patch, null entry, whitespace/non-string title, whole-batch-fails-on-one-invalid, multi-field preservation |

Net: **+57 tests**. All green. Notably, the 49 edge cases passed on first run —
the pure engine is robust at its boundaries (clamping, empties, unicode,
duplicate-sequence tie-breaks), which is itself a positive finding.

## What still needs real-world verification
See `docs/ecfa-smoke-test.md` — a browser + iPad checklist for the things the
sandbox can't drive: real pointer/keyboard drags, RLS across tenants, the AI
co-pilot round-trip, the CAPA cross-link, and the PDF download.
