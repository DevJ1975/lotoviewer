# /devjr audit — claude/bug-hunt-saas-Smx3U (2026-05-09)

PR #54, draft. Audit ran across the full branch diff against
`main` (commit `7e6967e`): the AI/RAG/scan slate fixes from the
first /devjr pass plus everything that landed during follow-up
work — upstream-error surfacing, hint inferrer, drag-and-drop
upload, shared Dropzone refactor.

## Honest scope

What was actually exercised:
- Static analysis (tsc, vitest, deploy-environment build with
  no env bypasses except the pre-existing
  `ALLOW_DEEPLINK_PLACEHOLDERS=1` for unfilled mobile config)
- Read every prod file the branch touched (12 files); flagged
  bugs found by inspection, not speculation
- Auth/RLS audit on the 3 server routes the branch modified
- Edge-case tests for every helper added or refactored on this
  branch

What was NOT exercised:
- Real browser / iPad click-through — checklist below for the
  user to drive
- Live Vercel / Supabase preview deploy
- Mobile (Expo) bundle — mobile is unaffected by this branch

## Baseline

| Metric | Before audit | After audit |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 140 files / 2259 tests | 142 files / 2287 tests (+28) |
| `npm run build` | clean | clean |
| Smells in branch diff | 0 | 0 |

## Phase A — Inventory + smell grep + auth/RLS

Branch diff: 12 prod files + 6 test/doc files.

Smell grep on the diff: zero `as any`, zero `@ts-ignore`, zero
`console.log`, zero TODO/FIXME/HACK across the slate.

Server-route audit (3 routes touched, no new handlers):

| Route | Auth gate | Tenant scope | Status |
|---|---|---|---|
| `assistant/hazards/route.ts` | `requireTenantMember` | `.eq('tenant_id', gate.tenantId)` | ✓ |
| `assistant/scan-photo/route.ts` | `requireTenantMember` | `.eq('tenant_id', gate.tenantId)` | ✓ |
| `generate-loto-steps/route.ts` | `requireTenantMember` | no DB writes (AI-only) | ✓ |

No auth or RLS regressions from this branch.

## Phase B — Refactor wins

Found `readActiveTenant()` duplicated **5 times** with identical
bodies (way past the 3+ extract threshold):
- `components/AssistantDock.tsx`
- `components/EquipmentScanner.tsx`
- `components/HazardReport.tsx`
- `app/assistant/page.tsx`
- `lib/supabase.ts` (already had it private — just unexported)

Promoted the existing private helper in `lib/supabase.ts` to an
export. Updated all 4 duplicating callsites to import from the
shared spot. Pure dedupe — zero behaviour change. tsc + vitest
unchanged afterwards.

The 25 MB cap is also repeated in 3 places (Dropzone /
safety-boards / sds), but they're conceptually independent
limits and Dropzone already takes a configurable maxBytes.
Not refactor-worthy.

## Phase C — Bug audit

### Bug 1 — regression in the Dropzone refactor (fixed)

**File:** `components/ui/Dropzone.tsx`

The Dropzone's underlying file input doesn't reset its value
on change. The original code in `chemicals/[id]/page.tsx` did
`e.target.value = ''` after every pick so the user could re-pick
the same SDS revision. The refactor lost that reset, breaking
"upload the same file again" — most visible in the `file=null`
immediate-upload pattern (chem detail page) where the dropzone
never holds the selection so the input retains the last-picked
value, and the browser deduplicates the change event for the
same file.

**Fix:** Always reset `e.target.value = ''` after the input's
onChange handler runs. The displayed selected-file UI reads
from the `file` prop, not from the input element, so clearing
is safe for the state-holding callers (policies, chemicals/new)
too.

**Regression test:** `Dropzone.interaction.test.tsx` — "clears
the underlying input on every onChange so the SAME file picks
again".

### Bug 2 — stale validation error on chem-new (fixed)

**File:** `app/chemicals/new/page.tsx`

The Dropzone wiring on `chemicals/new` was
`onFileSelected={setSdsFile}`. When the user dropped an
oversized PDF (rejected, error shown), then dropped a valid
PDF, the rejection text stayed on screen alongside the new
selection. `policies/page.tsx` already handled this correctly —
chem-new didn't.

**Fix:** Wrap `onFileSelected` to also clear the error:
`f => { setError(null); setSdsFile(f) }`.

`chemicals/[id]` self-heals because `uploadSds` clears the
error on entry — no fix needed there.

### Cleanup — dead manual input reset (removed)

**File:** `app/superadmin/policies/page.tsx`

The page was doing
`document.getElementById('policy-file').value = ''` after a
successful upload. Now that the Dropzone owns the reset,
those 2 lines are dead. Removed.

### Patterns checked but found clean

- State updates after async unmount in chat surfaces — React 19
  warns rather than crashes; not worth a fix on this branch.
- Stale closures in the new `useEffect` deps — none added.
- Race conditions in parallel fetches — branch doesn't touch
  any.
- Sequence renumbering, atomic-ish writes, audit-log triggers
  — branch doesn't touch any.
- Error swallowing in branch-added code — every catch either
  surfaces to UI or to Sentry.
- The 4xx error mapper's nested-shape extractor — already
  covered by `client.test.ts`. Re-verified: matches the SDK's
  `err.error.error.message` shape with a `err.error.message`
  fallback and `err.message` final fallback.
- Markdown sanitizer's leading-whitespace bypass — Phase D
  added tests for `\t`, `\n`, `file:`, `blob:`, `about:`, and
  scheme-only payloads. All correctly rejected.

## Phase D — Edge-case tests (+28 tests / +2 test files)

| File | Tests | Coverage |
|---|---|---|
| `__tests__/components/ui/Dropzone.interaction.test.tsx` | 16 | drop / drag-depth / disabled / multi-file / X button / same-file regression / custom allowlist / a11y |
| `__tests__/components/markdown.test.tsx` (additions) | +7 | tab/newline scheme bypass, `file:`, `blob:`, `about:`, scheme-only, query-string preservation |
| `__tests__/lib/readActiveTenant.test.ts` | 5 | unset / present / empty-string / storage-throws / SSR |

The Dropzone interaction file uses a faked `DataTransfer` (jsdom
doesn't ship one) and exercises drop, dragenter/leave depth
tracking, the X button, the custom-allowlist pass-through, and
the a11y contract that the input stays in the tab order.

## Phase E — Final state

- 142 test files / 2287 tests passing
- tsc clean
- `npm run build` clean (with `ALLOW_DEEPLINK_PLACEHOLDERS=1`)
- 4 commits in this audit:
  1. Phase B refactor — promote `readActiveTenant` to a shared
     export, dedupe 4 sites
  2. Phase C bugfix — Dropzone input-reset regression + chem-new
     stale-error stickiness + policies/page dead-code cleanup
  3. Phase D — +28 edge-case tests across 3 files
  4. Phase E — this report + smoke checklist update

## Manual smoke checklist

See `docs/saas-bug-hunt-smoke-test.md` for the full list. New
items added by this audit:

- [ ] **Dropzone same-file re-pick (critical regression test)**:
  in `/superadmin/policies` and `/chemicals/<id>`, drop a PDF,
  then re-pick the SAME file from disk via the click flow —
  the change should re-fire (visible by error / upload starting
  again). This was broken in the refactor and is now fixed.
- [ ] **Stale-error clear on chem-new**: in `/chemicals/new`,
  drop an oversized PDF (>25 MB) — error appears. Then drop a
  small valid PDF — error should disappear. Was broken; now
  fixed.
- [ ] **Multi-file drop guard**: drop two files at once — should
  see "Drop one file at a time."
- [ ] **Drag highlight stability**: hover-drag a file across the
  dropzone, keep the cursor inside while moving over the icon /
  text children — the indigo border should stay highlighted (no
  flicker as the cursor crosses child elements).
