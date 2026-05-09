# Comprehensive bug hunt — Complete SaaS slate (2026-05-09)

Branch: `claude/bug-hunt-saas-Smx3U`
Scope: every file added since the chemicals-management merge
(`50e591f`) — the AI assistant + RAG + scan + alerts + policy upload
+ supporting `lib/ai/*` slate. 54 files, ~9k LOC of new web code.

## Honest scope notes

What this audit covered:
- Static analysis (`tsc --noEmit`, `vitest`, `npm run build` from
  the deploy root with no env bypasses except the pre-existing
  `ALLOW_DEEPLINK_PLACEHOLDERS=1` for placeholder mobile config)
- Read every file in the slate; verified each finding before fixing
- Auth-gate + RLS scope audit on every new API route
- Edge-case grep for known smells (`as any`, `@ts-ignore`,
  `console.log`, `TODO`, swallowed catches, missing tenant scope)

What this audit did NOT cover:
- Click-through testing in a real browser / iPad — see
  `docs/saas-bug-hunt-smoke-test.md` for the manual checklist
- Hitting live Vercel / production Supabase
- Cross-region deploy pipeline (CI/CD stays as-is)

## Baseline

| Metric | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 137 files / 2207 tests | 138 files / 2230 tests (+23) |
| `npm run build` | clean (with `ALLOW_DEEPLINK_PLACEHOLDERS=1`) | clean |

The `prebuild` deeplink-placeholder check still trips on
intentionally-unfilled mobile config (`apple-app-site-association`,
`assetlinks.json`, `eas.json`). Behaviour predates this audit.

## Smells: clean

- 0 `as any` / `as never` in the slate
- 0 `@ts-ignore` / `@ts-expect-error`
- 0 `TODO` / `FIXME` / `HACK` / `XXX`
- `console.log` only in `scripts/ingest-regulations.mjs`
  (CLI, appropriate)

## Bugs found and fixed

### 1. `components/ui/markdown.tsx` — link href scheme allowlist (Med)

**Problem:** The assistant's markdown renderer parsed `[text](url)`
links and dropped the href into `<a href={href}>` with no scheme
check. RAG-retrieved chunks or tenant-uploaded policies could
contain links with `javascript:`, `data:`, or `vbscript:` schemes.
React 19 partially mitigates `javascript:` URLs, but defense in
depth is appropriate when the input source is model output +
arbitrary tenant content.

**Fix:** Added `isSafeHref()` — allowlists `http`/`https`/`mailto`/
`tel` and relative paths (`/`, `#`, `?`). Anything else renders as
plain text. Trim before scheme test so `" javascript:..."` doesn't
slip through.

**Tests:** `__tests__/components/markdown.test.tsx` — 16 tests
covering each scheme, leading-whitespace bypass, mixed-case bypass,
empty href, hash anchors, plus core rendering edge cases.

### 2. ilike wildcard escape (Low-Med)

**Problem:** Two routes accept user/model-supplied `equipment_id`
and pass it directly to `.ilike(equipment_id, value)` — `%` and
`_` are interpreted as PostgREST wildcards. Within the tenant
scope (`.eq('tenant_id', gate.tenantId)` is enforced first), this
isn't a cross-tenant data leak, but it can match the wrong row in
the tenant's equipment list.

- `app/api/assistant/hazards/route.ts:110` (user input)
- `app/api/assistant/scan-photo/route.ts:160` (Claude vision output)

**Fix:** Escape `\`, `%`, `_` with a backslash before passing to
`.ilike()`. Also added a 256-char input cap on `equipment_id` to
bound the query string size.

**Test:** length-cap test added to assistant-hazards route tests.
The escape itself isn't end-to-end tested (would require a
supabase query-builder stub) — this is a 4-line transform and
the unit logic is self-evident.

### 3. `app/api/generate-loto-steps/route.ts` — input length caps (Low)

**Problem:** No length caps on `equipment_id`, `description`,
`department`, `notes`, or `context`. Rate limit at 20/hr per user
bounds the abuse window, but a single 4MB description still burns
significantly more tokens than intended.

**Fix:** Type + length caps before any work:
- `equipment_id`, `department`: ≤256 chars
- `description`, `notes`, `context`: ≤4000 chars
- All must be `string` (or `null`/`undefined` for optionals)

**Tests:** 6 new tests in
`__tests__/api/ai/generate-loto-steps.test.ts` — over-cap,
non-string, and the `notes:null` happy-path edge.

## Findings rejected (Explore agent claims that did not survive verification)

The first sweep was delegated to an Explore agent. Each claim
was verified against the actual code; these did not hold up:

| Agent claim | Reality |
|---|---|
| `assistant/chat/route.ts` missing tenant scope on `assistant_conversations` | Conversation lookup checks `existing.user_id !== gate.userId` (implicit user-scope enforcement). Tenant filter would be defense in depth, not a fix for a vuln. |
| `toolUseCount` stale closure | Variable doesn't exist. Loop counter is `loop` against `MAX_TOOL_LOOPS` constant. |
| `getTenantApiKey` silent fallback on lookup failure | Documented design at line 56-57 of `getTenantApiKey.ts`. |
| `embeddings.ts` timeout leak | `clearTimeout(t)` runs in `finally`. |
| `chunker.ts` off-by-one in position tracking | `cursor` advances correctly per paragraph; `text.indexOf(p, cursor)` walks forward. |
| `cron/generate-toolbox-talks` race condition | `23505` unique-violation caught at line 339 — treated as skip, not a failure. |
| `superadmin/policies/upload` batch insert without transaction | `knowledge_chunks` has `ON DELETE CASCADE` to `knowledge_documents`; chunk-insert failure deletes the document, which cascades the partial chunks. |
| `incidents/[id]/classify/ai-suggest` missing UUID validation | UUID validation is in `requireTenantAdmin` chain plus the `.eq('id', id)` returns null for non-UUID and the route returns 404. Not a bug. |

## Refactor opportunities (deferred — not done in this PR)

- `readActiveTenant()` is duplicated in `AssistantDock.tsx` and
  `HazardReport.tsx`. Two files = below the "3+ files = extract"
  threshold; left in place.
- AI-route boilerplate (`requireTenantMember → checkAiRateLimit
  → getAnthropic → log invocation`) is repeated across ~7 routes.
  A `withAiRoute()` wrapper is plausible but would change the
  shape of every route — defer until there's a clear behaviour
  change that warrants it.

## Things this audit specifically did not change

- The deeplink-placeholder pre-build gate. Deliberately failing
  on placeholder mobile config is the right behaviour; the
  placeholders are fine for web-only deploys when
  `ALLOW_DEEPLINK_PLACEHOLDERS=1` is set.
- Set-state-after-fetch in `AssistantDock`, `SupportBot`,
  `assistant/page.tsx`. React 19 emits a dev warning here, not a
  crash. Not a real bug; not fixed.
- `dedupeQuery.eq()` mutation pattern in
  `superadmin/policies/upload/route.ts:142-148`. Stylistic
  deviation from the rest of the codebase (others use
  `let q = ...; q = q.eq(...)`). Works because supabase-js v2
  builders mutate `this` and return self. tsc + tests pass.

## What's left for the user to verify

Per `docs/saas-bug-hunt-smoke-test.md`.
