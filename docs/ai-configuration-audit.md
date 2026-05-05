# AI configuration audit — Phase 0 (Discovery)

Inventory of every AI surface in the codebase + its configuration
knobs. Output of devjr-style Phase 0 for the comprehensive AI
audit. No code changes in this phase — discovery only.

Captured 2026-05-05 from commit `27ec3ab` (after the regulatory-
citations KB update, before any AI-config remediation).

## Executive summary

**4 AI surfaces total**, all in `apps/web` (mobile has zero direct
Anthropic SDK usage). All 4 use `@anthropic-ai/sdk@^0.90.0`. All 4
read `ANTHROPIC_API_KEY` from env via `new Anthropic()` with no
fallback.

**Top findings ranked by severity:**

| # | Finding | Severity | Surfaces affected |
|---|---|---|---|
| 1 | **3 of 4 routes have no auth gate** — unauthenticated callers can burn API tokens | **P0** | validate-photo, generate-loto-steps, generate-confined-space-hazards |
| 2 | **3 of 4 routes have no rate limit** — single bad actor can exhaust budget | **P0** | same three above |
| 3 | Two different model families (`sonnet-4-6` vs `haiku-4-5-20251001`) with no shared constant | **P1** | all four |
| 4 | One route uses date-stamped model id, three use the alias — inconsistent pinning posture | **P1** | validate-photo vs the rest |
| 5 | No per-tenant token-usage logging — can't attribute spend | **P1** | all four |
| 6 | Photo validation has no image size/dimension cap before Anthropic call | **P1** | validate-photo |
| 7 | `JSON.parse` on AI output without schema validation in validate-photo | **P2** | validate-photo |
| 8 | No per-conversation message cap on chat (per-user cap exists; in a single conversation a user can still hit hourly cap with rapid messages) | **P2** | support/chat |

## Surface inventory

### 1. `/api/support/chat` — Conversational support bot

| Knob | Value | Notes |
|---|---|---|
| Path | `apps/web/app/api/support/chat/route.ts` | |
| Model | `claude-sonnet-4-6` | constant `MODEL` at top of file |
| max_tokens | 1500 | constant |
| SDK | `new Anthropic()` | reads `ANTHROPIC_API_KEY` |
| Auth | ✅ `authedReporter()` (Bearer JWT verify via Supabase) | Bot refuses unauthed |
| Rate limit | ✅ 30 msgs/hour, 200/day per user | Counted via `support_messages` query |
| System prompt | `SYSTEM_PROMPT_PREAMBLE` + KB excerpts + lang instruction | KB resolved by `resolveKb()` |
| KB integration | ✅ via `lib/support/kb` resolver | Auto-loads module files based on path + tenant |
| Tool use | `create_support_ticket` (one tool) | Defined as `ESCALATION_TOOL` |
| i18n | en / es via `pickLang()` | Reads body `lang` field then `Accept-Language` |
| Streaming | ❌ Phase 1 contract = non-streaming | Comment at line 38 acknowledges |
| Conversation persistence | ✅ `support_messages` + `support_conversations` (migration 045) | tenant-scoped |
| Feedback loop | ✅ `support_message_feedback` (migration 046) | thumbs up/down |
| Escalation email | ✅ Resend via `renderSupportTicketEmail` | |
| Error handling | Try/catch, logs to Sentry | Specific 401/429/500 → user-facing message in `try` block |
| Sentry tags | ✅ `route: support/chat` | |

### 2. `/api/generate-loto-steps` — LOTO step authoring

| Knob | Value | Notes |
|---|---|---|
| Path | `apps/web/app/api/generate-loto-steps/route.ts` | |
| Model | `claude-sonnet-4-6` | hardcoded inline at line 132 |
| max_tokens | 16000 | for structured-output authoring |
| SDK | `new Anthropic()` | |
| **Auth** | **❌ NONE** | Anyone on the internet can POST. P0. |
| **Rate limit** | **❌ NONE** | P0. |
| System prompt | `SYSTEM_PROMPT` constant — comprehensive (food production context, energy codes, 8 rules) | Well-tuned to LOTO + ANSI/Z244.1 |
| Output format | `output_config: { format: { type: 'json_schema', schema: STEPS_SCHEMA } }` | Strict schema, `additionalProperties: false` |
| Thinking | `thinking: { type: 'adaptive' }` | Enabled |
| Photo input | URL refs to Supabase public bucket | Both equip + iso photos optional |
| Caller | `apps/web/components/placard/EditStepsSheet.tsx:110` | Single caller |
| Error handling | Anthropic.RateLimitError → 429, APIError → 502, generic → 500 | Better than chat's; no Sentry wrap on the rate-limit branch |
| Sentry tags | ✅ `route: /api/generate-loto-steps` | |

### 3. `/api/generate-confined-space-hazards` — CS hazard authoring

| Knob | Value | Notes |
|---|---|---|
| Path | `apps/web/app/api/generate-confined-space-hazards/route.ts` | |
| Model | `claude-sonnet-4-6` | hardcoded inline at line 198 |
| max_tokens | 16000 | for structured-output authoring |
| SDK | `new Anthropic()` | |
| **Auth** | **❌ NONE** | P0. |
| **Rate limit** | **❌ NONE** | P0. |
| System prompt | Most detailed prompt in the codebase — 95 lines of food-production context, 10 hazard categories, 7 isolation categories, 13 PPE/equipment baseline items, 6 rules | Very well tuned |
| Output format | JSON schema for hazards/isolation_measures/equipment_list/rescue_equipment/notes | Strict |
| Thinking | adaptive | |
| Photo input | URL refs to Supabase public bucket | Both equip + interior photos optional |
| Caller | `apps/web/app/confined-spaces/[id]/permits/new/page.tsx:154` | Single caller |
| Error handling | RateLimitError → 429, APIError → 502, generic → 500 | Same shape as generate-loto-steps |
| Sentry tags | ✅ `route: /api/generate-confined-space-hazards` | |

### 4. `/api/validate-photo` — Photo validation (LOTO photos)

| Knob | Value | Notes |
|---|---|---|
| Path | `apps/web/app/api/validate-photo/route.ts` | |
| Model | **`claude-haiku-4-5-20251001`** | The only haiku usage. Date-stamped vs alias for the other 3. |
| max_tokens | 128 | sane for a JSON validity check |
| SDK | `new Anthropic()` | |
| **Auth** | **❌ NONE** | P0. |
| **Rate limit** | **❌ NONE** | P0. |
| System prompt | Two short prompts (`EQUIP`, `ISO`) | OK for the simple validity check |
| **Image size cap** | **❌ NONE** | Could send a 100MB image to Anthropic — P1. |
| **Image dimensions cap** | ❌ NONE | Could OOM on large uploads. P1. |
| Output parsing | `JSON.parse` on text after stripping markdown fences | No schema validation; malformed → 500 catch |
| Output format | Plain text response, expected to be JSON, post-processed | Less robust than the structured-output path the other two use |
| Caller | `apps/web/components/placard/PlacardPhotoSlot.tsx:158` | Single caller |
| Error handling | Generic try/catch → 500 with "Validation failed" | No specific 429 / 401 handling; user gets opaque error |
| Sentry tags | ✅ `route: /api/validate-photo` | |

## Cross-cutting findings

### Model + SDK consistency

Two distinct issues:

1. **Two model families.** Three routes use Sonnet 4.6; one uses Haiku 4.5. There may be valid reasoning (haiku is cheaper for the simple visual-validity check) but **there's no documented decision** anywhere in the code or comments — the choice looks accidental.

2. **No shared model constant.** `MODEL` is defined in `support/chat/route.ts` but the other three routes hardcode their model name inline. Updating to a new Sonnet version requires editing 3 separate files. Refactor target: a `lib/ai/models.ts` shared module exporting `SONNET = 'claude-sonnet-4-6'` + `HAIKU = 'claude-haiku-4-5'` with one place to bump versions.

3. **Inconsistent pinning posture.** The Haiku call uses `claude-haiku-4-5-20251001` (date-stamped, doesn't auto-update). The Sonnet calls use `claude-sonnet-4-6` (alias, auto-updates within the 4.6 family). Either is defensible; **mixing them is not.** Pick one posture and apply uniformly.

### Auth gate gap

`/api/support/chat` correctly gates on a Supabase JWT and rate-limits per user. The other three routes have no gate at all.

**Risk:** anyone who knows the URL can POST and burn API tokens against the org's Anthropic quota. They wouldn't get any *capability* they couldn't get by signing in (the routes return AI-generated content, not protected data), but the *cost* attribution defaults to the org with no per-tenant tracking.

**Fix:** add `requireTenantMember` (or equivalent) to all three. The callers already have the user's session — passing the JWT is one fetch-config change per call site.

### Rate limit gap

Same 3 routes have no rate limit. Once a key is leaked or a buggy client loops, no upper bound on cost. The chat route's 30/hour and 200/day per-user caps should be roughly mirrored; "per session" or "per equipment" caps may also make sense for the authoring routes.

### Token usage observability

No surface logs `input_tokens`/`output_tokens` to a database. Cost
attribution per tenant or per surface is impossible without
re-pulling Anthropic Console data and joining it back to
application logs by approximate time correlation. Not a security
issue but blocks operational answers like "which tenant is
responsible for our Anthropic spend?"

### Privacy

`apps/web/app/privacy/page.tsx:57` claims "the prompt and your work
description are sent to Anthropic's API and discarded after the
response. No model training on your data." For this claim to be
defensible, the user (or whoever owns the Anthropic Console for
this org) needs to verify:

- Privacy → "Use my data to improve Anthropic's models" toggle is OFF for API usage
- The org-level data-retention setting (Anthropic retains API messages for ~30 days for abuse monitoring by default — not the same as training, but worth confirming the privacy-page wording matches the Console state)

This was flagged in earlier session work but isn't directly a code
issue.

## What's working well (not findings — preserves what NOT to break)

- **The KB resolver pattern** is clean: `MODULE_DEFS` array + tenant-gated path matching + always-on `general`. Well-tested (25 vitest cases). The new Federal/Cal/OSHA citations from commit `27ec3ab` plug in without any code changes.
- **Structured outputs via `json_schema`** in the two generation routes — robust against model drift.
- **Comprehensive system prompts** in generate-loto-steps and generate-confined-space-hazards — these are clearly battle-tested. Don't touch them in Phase 1.
- **Sentry instrumentation** — all four routes report errors to Sentry with route tags.
- **Tool-use for escalation** in the chat bot — clean pattern.

## Phase 1 sequence (what I'd commit, in order)

Each commit is independently revertable. Priority ranks within Phase 1:

| Commit | Title | Severity addressed |
|---|---|---|
| 1.1 | Add `requireTenantMember` to validate-photo + generate-loto-steps + generate-confined-space-hazards | P0 (auth gap) |
| 1.2 | Add basic rate-limiting to the three generation routes | P0 (rate limit gap) |
| 1.3 | Extract a shared `lib/ai/models.ts` with `SONNET` + `HAIKU` constants and a `pickModel()` helper | P1 (model consistency) |
| 1.4 | Pin model posture: pick alias-style for both, document why | P1 |
| 1.5 | Add image size/dimension cap to validate-photo | P1 |
| 1.6 | Add JSON-schema parse safety to validate-photo (Zod or hand-rolled) | P2 |

## Honest scope reminder

What's NOT in Phase 1 (deferred to later phases):

- Token usage logging table + per-tenant attribution → **Phase 3**
- Prompt drift between KB and UI → **Phase 2**
- Tests for the new auth gates and rate limits → **Phase 4**
- Documentation handoffs (Anthropic privacy verification, Vercel env audit) → **Phase 5**

## Phase 0 deliverable

This file. No code changes. Awaiting user approval to proceed to
Phase 1.

If user says "skip Phase 1, go straight to X" or "just fix the
P0s," that's fine — Phase 1's commits are independent and can be
selected à la carte.
