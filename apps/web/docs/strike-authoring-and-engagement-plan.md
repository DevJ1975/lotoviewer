# STRIKE Authoring, Content, And Engagement Plan

Follow-on plan to `strike-microlearning-implementation-spec.md`. That document defined
STRIKE and carried it through Phase 3. This one covers the effort named in PR #271:
authoring UI, block-based content, narration, and gamification.

PR #271 is the hardening phase and a prerequisite for all four. Assessment integrity is
theater while the answer key leaks, so nothing here should start before 256 is applied
and #271 is merged.

## Where We Are Today (Baseline)

What is genuinely built:

- Data model across eleven tables (migration 114), tenant/global scoping, RLS.
- Learner playback, quiz submission, server-side scoring, attempts, version-bound
  completions — `/strike/[slug]`, `/api/strike/[moduleId]/submit`.
- Assignments, recurring-assignment cron, QR launch cards, Studio requests.
- Source-linked requirements and readiness checks — `/api/strike/assign-from-source`.
- Vimeo-only video since migration 225, with a CHECK constraint added in 256.

What the spec calls implemented but is thinner than it reads:

- **There is no publish control.** `/api/superadmin/strike/route.ts` exports `GET` and
  `POST` only. `POST` creates a draft module and a version 1 shell; the page copy says
  so outright — "Publish controls can build on the same Studio route." Nothing
  transitions `draft → in_review → published → archived`. Every published module today
  got there through direct SQL.
- **Site and department assignment targeting does not resolve.**
  `isStrikeAssignmentApplicable` (`packages/core/src/strike.ts:117`) returns `false` for
  both, with a comment saying worker profile context is not in the STRIKE shell yet.
  Only tenant, role, and user targets work.
- **`missedFeedback` is computed and returned, and nothing renders it.**
  `/api/strike/[moduleId]/submit/route.ts:234` builds per-question feedback scoped to
  missed questions. #271 removed the pre-answer explanation leak and moved explanations
  here; the result screen has not caught up.

## Phase 0: The Publish Decision

This is the gate. It is a schema and policy decision, and building an authoring UI
before settling it would be the mistake.

`isStrikeCompletionCurrent` (`packages/core/src/strike.ts:85`) treats any version
mismatch as stale:

```ts
if (input.requiredVersionId && input.moduleVersionId &&
    input.requiredVersionId !== input.moduleVersionId) {
  return false
}
```

`computeStrikeReadiness` then counts that worker as missing, and readiness falls from
`ready` to `partial` or `blocked`. Because publishing is a manual SQL act today, this
almost never fires. An authoring UI makes it a button. Correcting a typo in one answer
option would mass-invalidate every completion of that module and, once requirement
checks gate high-risk work, could stop a shift.

The inverse failure is equally real: if a new version does not invalidate, then a module
corrected because it taught something wrong never retrains anyone.

So the version row must stop meaning two different things. Proposal:

- Add `retraining_required boolean not null` and `supersedes_version_id uuid` to
  `strike_module_versions`.
- Publishing always mints a new immutable version row. Never edit a published version in
  place — a completion is federal training evidence and must bind to the exact content
  the worker saw. In-place mutation is the simpler design and is rejected for that
  reason alone.
- The author declares the revision at publish time, in plain language rather than
  jargon: *"Does someone who already passed this need to take it again?"*
- Currency becomes lineage-aware: a completion is current if its version is reachable
  from the required version by walking `supersedes_version_id`, provided every hop has
  `retraining_required = false`. One substantive hop anywhere in the chain breaks it.

Deliverables: migration, `isStrikeCompletionCurrent` extended to accept the accepted
lineage, unit tests for the editorial chain, the substantive break, and the mixed chain.

Backfill: existing versions get `retraining_required = true` and a null predecessor,
which preserves today's behaviour exactly.

## Phase 1: Authoring UI

Build the missing verbs first, then the surface. Superadmin only to start, matching the
permissions model in the spec.

- `PATCH /api/superadmin/strike` for status transitions, with the legal transitions
  enumerated server-side. `published → draft` must not exist; supersede instead.
- Version editor: metadata, transcript, passing score, retake limit, Vimeo id.
- Question editor for the four existing types — `multiple_choice`, `true_false`,
  `select_all`, `acknowledgement`. This is the highest-value screen in the phase; quiz
  content is currently authored in SQL.
- Publish dialog carrying the Phase 0 question and showing the blast radius before
  confirmation: how many completions the choice will invalidate, and how many workers
  that moves out of `ready`.
- Render `missedFeedback` on the result screen. Small, already-paid-for, and it closes
  the loop #271 opened.

Tenant-admin authoring stays out of this phase. The spec gates it behind a per-tenant
permission that does not exist yet, and superadmin authoring is what STRIKE Studio
actually needs.

## Phase 2: Block-Based Content

Today a version is one video plus a transcript plus a flat question list. Block-based
content lets a module interleave text, image, video, callout, and question blocks.

- New `strike_content_blocks` keyed to `module_version_id`, with `block_type`,
  `sort_order`, and a typed `content jsonb`. Blocks inherit the version's immutability.
- Questions become a block type that references `strike_quiz_questions` rather than a
  parallel list, so scoring keeps its single source of truth.
- Keep `scoreStrikeQuiz` untouched. Blocks change presentation and ordering, not grading.

**Constraint that must not be missed.** Migration 256 revokes column access on
`strike_quiz_questions` and `strike_quiz_answers` and re-grants an explicit list. The PR
flags it: a column added later is *not* readable from the browser until a migration
grants it. Any block work that adds a column to either table has to extend those grants
in the same migration, and any new table holding answer-adjacent content — an
explanation block, a hint — needs the same withhold-then-grant treatment from its first
migration, not retrofitted.

## Phase 3: Narration

The schema already anticipates this. `strike_module_versions` carries `captions_path`
and `transcript`, and #271 extended the `global/` media policy to audio extensions
specifically because narration audio was coming.

- Per-block narration audio under the existing path convention:
  `strike-media/global/...` and `strike-media/{tenant_id}/...`.
- Generated narration is AI-assisted content and inherits the spec's rule — a human
  approves before publication. Store the approver and timestamp on the version.
- Section 508 is a stated requirement, so captions and transcript stay mandatory for
  published versions. Narration supplements text; it never becomes the only channel.
- Validate audio duration against `duration_seconds` at publish time rather than trusting
  the upload.

## Phase 4: Gamification

Deliberately last. Engagement mechanics on top of an assessment surface that leaked its
own answer key would have been indefensible, and the readiness numbers only became
trustworthy in #271.

- Streaks, badges, and completion milestones as derived read models over
  `strike_completions`. No new source of truth.
- Leaderboards scoped to site or department — which is blocked until
  `isStrikeAssignmentApplicable` resolves those targets, so that gap is Phase 4's real
  prerequisite, not a nice-to-have.
- Reward voluntary completion specifically. The spec already lists it as a leading
  indicator, and it is the one metric that distinguishes a training culture from a
  compliance checkbox.
- Never gamify pass rate or score. It creates pressure to make assessments easier and
  corrupts the evidence.

## Permissions And Invariants

- Superadmin authors and publishes. Tenant admins assign and request Studio work.
- RLS stays the hard boundary; route checks narrow further.
- `requireStrikeMember` / `requireStrikeAdmin` (added in #271) gate every new route. The
  module-disabled hole they closed is easy to reopen when adding endpoints.
- Published versions are immutable. Corrections supersede.
- Completions always bind to `module_version_id`.
- Column grants are withhold-by-default on any table holding answer-adjacent data.

## Migration Discipline

Migrations in this repo are applied by hand — there is no CI step that runs them. Every
phase here adds at least one. Each needs a rollback file alongside it, following the
`256` / `256_rollback` pairing, and the PR body must state the apply-before-deploy
ordering the way #271 does.

## MVP Scope

If this has to ship in one increment rather than four, the defensible cut is Phase 0 plus
the question editor, the `PATCH` transitions, and `missedFeedback` rendering. That gives
STRIKE Studio a way to author and correct modules without SQL, and it is the smallest
version that does not create a readiness incident on first use.

## Open Product Decisions

- Does an editorial republish notify anyone, or land silently?
- When a substantive version invalidates completions, are workers auto-assigned the new
  version, or does it surface as overdue and wait for a supervisor?
- Can a tenant pin to an older global version, or does Trainovate's publish always win?
- Is there a grace window between substantive publish and readiness enforcement, so a
  correction does not stop work the same morning it ships?
- Do gamification signals cross tenant boundaries for benchmarking, or stay tenant-local?
