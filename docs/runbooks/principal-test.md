# The Principal Test

A fixed, ordered test pass run **after each module is complete** (before opening
its PR for review). The order is deliberate: cheap, broad checks first; expensive,
narrow ones last. Each phase must pass before the next begins.

> Honesty rule: this runs in a sandbox without a live Supabase project or real
> tenant data. Phases that need a running app + DB (smoke, end-to-end) are
> executed as far as the environment allows and otherwise documented as
> **manual-verification-required** — never reported as passing when they were
> not actually exercised.

## The six phases

### 1. Bug hunt
A focused correctness review of the new code before trusting any test.
- Read every new/changed file end-to-end. Look for: wrong SQL (ON CONFLICT
  arbiters, partial indexes, RLS gaps), unhandled error results, auth/tenant
  scoping holes, off-by-one and date/timezone math, silent `.error` drops,
  missing `await`, and illegal-state representations.
- Cross-check against the module's acceptance criteria.
- Fix what you find now; note anything deferred.

### 2. Smoke test
"Does it even come up?" — the broadest signal that nothing is grossly broken.
- `cd apps/web && npx tsc --noEmit` (clean)
- `npm run lint` (clean for touched files)
- From repo root: `npm run check:repo` and `npm run check:wiki` (green)
- If feasible, `npm --workspace web run build` or boot the dev server and load
  the new route. If not feasible in-sandbox, mark the route load as
  manual-verification-required.

### 3. Unit test
Smallest pieces in isolation — pure functions with no I/O.
- `@soteria/core` helpers (scoring, cadence, routing, classification).
- Deterministic inputs/outputs; fixed clocks; no network or DB.
- `npx vitest run <new core test files>`

### 4. Edge test
The unit functions at their boundaries and failure modes.
- Min/max, empty, null/undefined, just-inside vs just-outside thresholds,
  date boundaries (today, leap, year-roll), invalid input.
- Usually lives in the same vitest files as the unit tests, in a distinct
  `describe('… edge')` block or boundary cases.

### 5. Business-logic test
The rules that make the feature *correct for the domain*, including the API
contract: auth/tenant gating, validation rejections, state transitions
(e.g. complete → advance vs. close), and "make illegal states unrepresentable".
- Route tests that assert the gate is enforced (forged `x-active-tenant` →
  403) and inputs are validated before any write.
- `npx vitest run <route + logic test files>`

### 6. End-to-end use test
A real user journey through the running app.
- Golden path + one failure path, on the actual UI, with realistic data.
- In-sandbox this needs a live Supabase project + seeded tenant, so it is
  normally **manual-verification-required**; record the exact steps to run
  (the PR "Test plan" checklist) and, where automated browser tests exist,
  run the relevant Playwright/e2e spec.

## How to record a run

For each module PR, add a short "Principal test" section to the PR body with a
line per phase: `pass`, `fixed: <what>`, or `manual: <what to verify>`. Keep the
detail in the PR, not in code comments.

## Quick command reference

```bash
cd apps/web && npx tsc --noEmit                 # phase 2
npm run lint                                    # phase 2
( cd .. && npm run check:repo && npm run check:wiki )  # phase 2
npx vitest run <files>                          # phases 3–5
# phase 6: boot the app / run e2e spec, or document manual steps
```
