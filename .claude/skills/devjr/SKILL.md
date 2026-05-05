---
name: devjr
description: Comprehensive multi-phase audit + refactor + bug-hunt + edge-case workflow for a recently-shipped feature set. Run when the user asks for a "complete audit", "clean up the code", or "make sure everything works" after a session of feature development. Honest about what's testable in a sandbox vs. needs manual verification.
---

# devjr — Comprehensive audit & cleanup workflow

A reusable five-phase workflow for auditing, refactoring, bug-hunting,
and adding edge-case coverage to a recently-shipped feature set.
Designed for the moment when the user has just built several
modules across multiple commits and wants confidence in the result
before pausing or shipping.

## When to use

- User asks for a "complete audit", "code review", "find bugs",
  "make sure everything works", "10× test", etc.
- After a multi-commit session of feature development.
- Before a real-world ship (mobile TestFlight, prod deploy).

## What this can and can't do — be honest first

**Can do:**
- Static analysis (tsc, eslint, grep for known smells)
- Code review of files added in the session
- Bug hunt by inspection (RLS bypasses, auth gates, race conditions,
  state-after-unmount, error swallowing, validation gaps)
- Refactor duplicated patterns into shared helpers
- Write edge-case tests (empty input, max input, null fields,
  special characters, boundary values, tenant scope)
- Run the test suite, tsc, and dev-boot smoke

**Can NOT do — say so up front:**
- "Click every link 10 times" — there's no browser to drive
- Manual UI smoke testing — closest equivalent is a written
  smoke checklist for the user to run themselves
- Interactive mobile testing — Expo Go isn't available
- "10× test" in practice means: tests hammer each code path
  with varied inputs programmatically + a smoke checklist for
  the user

State this honestly before starting so the user knows the trade.

## Phase A — Inventory & static checks (commit 1)

1. Capture the baseline:
   - `npx tsc --noEmit` in each app (web + mobile, etc.)
   - `npx vitest run --reporter=dot` in the web app
   - `npx expo export --platform ios` for mobile (tolerant of
     sandbox flake — log the result but don't block on it)
   - **Simulate the deploy-environment build, not just the dev
     environment.** Run `npm run build` from the deploy root
     with no env overrides (clear `ALLOW_*` bypass vars first).
     Catches `prebuild` / `postbuild` / `predeploy` hooks that
     dev-server boots skip. On lotoviewer this caught a
     `check-deeplink-placeholders.mjs` failure that tsc + vitest
     + dev-boot all passed cleanly.
   - Record numbers as the floor; any commit that drops them is
     a regression.

2. Grep the session's new files for known smells:
   - `as any`, `as never` (audit each — many will be legitimate
     cross-platform shims)
   - `@ts-ignore`, `@ts-expect-error`
   - `console.log` (should be `console.warn` or Sentry in shipped
     code)
   - `TODO`, `FIXME`, `HACK`, `XXX`

3. Auth gate audit:
   - List every API route added in the session
   - For each: confirm `requireTenantAdmin` vs `requireTenantMember`
     matches the operation (mutations → admin; reads → member)
   - Flag any route that uses the service-role admin client without
     a gate

4. RLS scope audit:
   - Grep every `supabase.from(...)` query added this session
   - Confirm each has an `.eq('tenant_id', tenant.id)` (mobile/web
     reads) or relies on the API gate's `gate.tenantId` (server
     routes)
   - Flag any query missing the tenant filter

5. Commit findings as a single inventory commit (or skip if
   nothing changed) so the audit trail is preserved.

## Phase B — Refactor wins (commit 2)

Look for duplication. The strongest signal is the same map/helper
copy-pasted into 3+ files. Examples that often surface:

- Severity/band color maps duplicated across KPI panels, list
  rows, and detail screens. Extract to `lib/<module>Display.ts`
  (web) or `lib/severityColors.ts` (cross-platform).
- `formatDate` / `formatTime` helpers duplicated across mobile
  screens. Extract to `lib/dateFormat.ts`.
- Status-pill style maps duplicated. Extract.

Rule: if 3+ files have the exact same map, refactor. If 2 files,
note it but only refactor if a third is imminent.

After refactor: tsc + vitest must still pass. Don't change behavior;
just dedupe.

## Phase C — Bug audit (commit 3 if any real bugs)

Read every file added in the session and flag bugs. Fix only the
real ones (no speculative changes). Specific patterns to check:

1. **State updates after unmount** — every mobile/web component
   with an async `useEffect` should have a `cancelled` flag or
   AbortController.

2. **Stale closures** — `useEffect`/`useCallback` deps arrays
   missing referenced state.

3. **Race conditions in parallel fetches** — e.g. detail pages
   loading 4 things via `Promise.all`. What happens if one fails?
   Is the partial state surfaced to the user?

4. **Cleanup logic correctness** — sequence renumbering on item
   delete should produce 1..N with no gaps. Test it.

5. **"Atomic-ish" multi-step writes** — where the code does
   step-1-then-step-2 without a real transaction, document the
   failure-mode contract (compensation? best-effort? alert?).

6. **Error swallowing** — every `try/catch` should either
   re-throw, surface to UI, or call Sentry. Silent catches are
   bugs.

7. **Input validation** — server-side validation must match
   client-side. If only the client validates, server can still
   accept invalid data via a direct API call.

8. **Cross-tab state** — sessionStorage/localStorage drafts can
   be poisoned by a tenant switch in another tab. Scope drafts
   by tenant id.

9. **PPE-alone, audit-log, and other DB-enforced constraints**
   should be exercised once via a test to confirm the trigger
   actually fires.

For each finding: file:line, what's wrong, suggested fix. Then
fix the real ones in one commit; document deferred ones in
`docs/deferred-work.md` so the audit trail is preserved.

## Phase D — Edge-case tests (commit 4)

Add tests for the helpers added in the session, covering at
minimum:

- Empty input → expected zero/null/empty
- Single-item input
- Max-size input (use the API's documented caps as upper bounds)
- Boundary values:
  - Numeric: min, min+1, max-1, max, max+1 (out of range)
  - Enum: every value
  - Strings: empty, single char, very long, with unicode
- Null vs undefined vs missing field
- Special characters: single quotes, double quotes, newlines,
  tabs, unicode subscripts (O₂, H₂S — these break PDF generators
  that don't sanitize)
- Tenant boundary: a query without tenant_id should NOT leak
  cross-tenant data (this is RLS's job, but the test enforces
  the contract)

Target: ~30-50 new tests covering paths not currently exercised.

## Phase E — Verify & commit (commit 5)

1. Full tsc + vitest on both apps (must match or beat baseline)
2. `expo export --platform ios` (mobile bundle clean)
3. Write `docs/smoke-test.md` — a checklist the user can drive
   against a real browser + iPad. Include:
   - Each new screen, what to verify
   - Each new API route, what payload to send
   - Each cross-module link (e.g. JHA → escalate → risk)
   - Each admin-only action vs member-only action
4. Final commit + push.

## How to phrase the plan to the user

Start by being honest about scope (the can-do / can't-do split
above). Propose 3-5 commits across the phases. Estimate
1-3 hours depending on what surfaces. Get a nod or a redirect,
then execute Phase A first and report findings before moving
on — Phase A often changes the priorities for B-D.

If migrations are needed (e.g. a missing constraint surfaces),
surface them and get user signoff before writing — those touch
the live DB.

## After running the workflow

The output is a short audit report listing:
- Baseline tsc/test counts
- Files touched per phase
- Bugs found and fixed
- Bugs documented as deferred
- Refactors applied
- New tests added (count + categories)
- The smoke checklist in `docs/smoke-test.md`

End with: "what's left that would benefit from your real-world
verification on a browser + iPad".
