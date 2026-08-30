# STRIKE — Phase 2 handoff (authoring studio)

**Date:** 2026-08-29
**Scope:** What shipped in PR #271, what is still owed, and the design decisions
Phase 2 should execute against. Written as a handoff because the planning
artifact lived outside the repo; everything needed to continue is here.

Phase 1 (security hardening) is **merged**. Phase 2 (the authoring studio) is
**planned but not started**.

---

## Why this work exists

STRIKE can only deliver one Vimeo video plus a flat multiple-choice quiz, and
quiz content can only be entered by **raw SQL** — there is no authoring UI for
questions at all. The goal is that a tenant safety manager can build meaningful
training with or without video, with narration, interactive quizzes and
gamification, matched to Articulate Rise/Storyline and Adobe Captivate practice,
mobile-first.

Four specialist reviews (instructional design, SaaS/data, mobile UX,
gamification/graphics) critiqued each other over this. Their conclusions and the
arbitrations between them are recorded below, because several are non-obvious and
were argued to a reversal.

---

## Phase 1 — merged in PR #271

Migration **`260_strike_security_hardening.sql`** (+ `260_rollback.sql`).

Five defects were found in the existing code. **Three are fixed:**

1. **The quiz answer key was readable by every learner.** `strike_answers_read`
   (migration 114) grants row-level `select` on `strike_quiz_answers`, and
   Postgres RLS has no column filtering. No column grant had ever been applied.
   Any session could `select=question_id,is_correct`. Closed with column grants,
   following the precedent in `178_prop65_anon_column_grants.sql`. `explanation`
   went too — it paraphrases the key and was being rendered *before* the learner
   answered.
2. **A question-less module recorded itself as passed.** `scoreStrikeQuiz`
   returns `passed: true` when `possiblePoints === 0`, and the acknowledgement
   was browser-side only, so a bare `POST` with an empty answer map wrote a
   passing, version-bound completion. Server now requires it.
3. **`global/` media reads leaked cross-tenant.** Migration 223 restricted video
   extensions and left `else true`. Audio now follows the video rule.

Plus: the module-toggle bypass on the APIs (`lib/strike/gate.ts` →
`requireStrikeMember` / `requireStrikeAdmin`), and `assign-from-source`'s raw
`e.message` on 500.

### ⚠️ Two defects are still OPEN — do these first in Phase 2

4. **Publishing v2 marks the entire workforce untrained.**
   `app/strike/page.tsx` passes the *latest* version id as `requiredVersionId`
   to `isStrikeCompletionCurrent`, which returns `false` on any mismatch. Every
   v1 completion flips to non-current, tenant-wide, on any publish — even a typo
   fix. Latent only because there is no publish button. **Shipping an authoring
   UI without fixing this converts a latent bug into a routine operation.**
   Fix in the *caller*, not the helper: add `supersedes_completions boolean` to
   the version and pass `requiredVersionId` only when it is set.
5. **Published versions are silently mutable.** No freeze exists.
   `api/superadmin/strike/video/route.ts` updates by id with no status filter.
   A published version's passing score can change and every historical
   completion silently re-means.

### Also owed

The unit suite has **no database**, so `__tests__/migrations/strikeAnswerKeyGrants.test.ts`
asserts the migration *text*. Confirming Postgres actually enforces the grant
means applying 260 to a Supabase branch and checking a learner's
`select('is_correct')` 401s while `select('answer_text')` succeeds.

---

## The constraint that shapes all of Phase 2

Migration 260 revoked `is_correct` and `explanation` from `authenticated`. **An
author must see and edit `is_correct`.** So unlike `EditStepsSheet`, `EcfaBoard`
and every other authoring surface in this repo — all of which write via a direct
browser `supabase.from()` call on RLS alone — **quiz CRUD must go through server
routes on `supabaseAdmin()`**. The column comes back silently missing otherwise.
Content blocks have no such constraint.

---

## Design decisions (arbitrated; do not silently revisit)

**Content model: flat block list, continuous scroll.** No page/lesson layer.
Block-level `IntersectionObserver` tracking ("seen" = ≥50% visible ≥800ms)
delivers everything paging was wanted for — timestamped events about *named
content objects*, per-block dwell time (catches a 5-minute module finished in
40 seconds), and a discrete resume token bound to the attempt rather than a
browser — at finer granularity. A page layer averaging ~1.5 blocks is ceremony.
Keep stable per-block keys, and one phase boundary: **content → graded quiz**.

**Storage: hybrid, split on a security boundary.** `content jsonb` on
`strike_module_versions` for presentation blocks; the existing
`strike_quiz_questions` / `strike_quiz_answers` tables unchanged for assessment.
A jsonb document is one column, so you cannot grant "the lesson but not the
answer key" on it — folding the quiz tables in would make defect #1 unfixable
without an API rewrite. Questions bind to blocks via a nullable `block_key`.

**jsonb validation: `check (jsonb_typeof(content -> 'blocks') = 'array')` only.**
The house idiom is exactly this, six instances, no helper functions.
`145_loto_competency_exams.sql` states the doctrine: *"the DB only enforces that
it's an array because question schemas evolve faster than migrations should."*
Pin the shape in a TS validator instead. Do **not** write a structural CHECK
function.

**Branching: deferred.** A scenario stem followed by a normal single-select is a
*content pattern needing zero engineering*. A real branching engine needs graph
reachability, cycle and orphan detection, and referential repair on every delete
— authored by someone who currently enters questions via SQL. It also breaks
version-is-content, the same invariant defect #4 exists to protect. Ship one-way
remediation links from a wrong answer to the block that teaches it.

**Hotspot: grade by target id, never coordinates.** That makes a hotspot question
*literally* `select_all` with a pictorial affordance — a one-line change to
`scoreStrikeQuiz` — and the parallel accessible list stops being a 508 "fallback"
and becomes the same input rendered without the image.

**Gamification: conservative.** Append-only event ledger, never counters.
`unique (tenant_id, user_id, event_type, dedupe_key)` with
`dedupe_key = version:{id}` means passing the same version twice earns zero —
idempotency and anti-farming from one index. Per-tenant leaderboards only; team
boards default on, individual boards need *both* tenant enable and per-user
opt-in; the learner always sees their own rank privately. No speed scoring (it
rewards skimming hazardous-energy content and is discoverable in litigation), no
daily streaks (impossible at 2–6 modules/month, and penalising absence suppresses
incident reporting).

---

## Phase 2 build order

**Migration A — `strike_content_immutability`.** Freeze triggers on
`strike_module_versions` / `_quiz_questions` / `_quiz_answers`, plus
`supersedes_completions`. **No status-gated freeze exists in this repo** —
synthesise the *shape* from the append-only audit triggers
(`038_risk_audit_log.sql:66-139`, `059`, `230`: `create or replace function` +
`drop trigger if exists` + `raise exception … using errcode =
'integrity_constraint_violation'`) with the *conditional column-diff body* from
`249_profiles_privileged_columns.sql`. Condition on **`old.status = 'published'`**
and list only content columns, so draft→published and published→superseded still
pass. ⚠️ Exclude the `video_*` columns — the video route updates published rows
today and would break on apply.

**Migration B — `strike_content_model`.** `content jsonb`,
`partial_credit_scope`, `review_policy`, `validity_days` on the version;
`block_key`, `graded`, `bank_tag` on questions. Keep
`check (block_key is null or graded = false)` — that makes "an inline formative
check gates a federal credential" unrepresentable. **Extend migration 260's
column grants** to cover the new question columns or they will be invisible to
the browser; 260 is revoke-then-grant-explicit precisely so this is a conscious
step.

**`/strike/studio`** — tenant-facing, gated on `requireStrikeAdmin` (already
built) **and** the existing dead `tenant_authoring_enabled` flag. RLS already
permits tenant authoring; migration 116 locked only `strike_studio_requests`, so
**no access migration is needed**. Extract `ModuleList` / `NewModuleForm` /
`Metric` / `StatusPill` / `EmptyState` out of `app/superadmin/strike/page.tsx`
into `components/strike/studio/`, parameterised on `scope` + `tenantId` + an
injected fetcher, with two thin host pages. The POST route is already
scope-agnostic; only the *page* hardcodes the superadmin fetch and shows a Scope
picker a tenant author must not see.

### Patterns to copy, with their known gaps

- **Draft shape** from `components/placard/EditStepsSheet.tsx`:
  `{ key, dbId?, sort_order, ...fields }` — `key` is stable React identity before
  Postgres assigns one. Blank new rows are silently dropped on save.
- Its save is a partitioned batched-insert + `Promise.all` per-row updates with
  **no rollback and a generic error toast**. Copy the partition, fix the failure
  reporting.
- It has **no reorder at all**. Take reorder from
  `app/incidents/[id]/ecfa/_components/EcfaBoard.tsx` — the repo's only
  `useDragAndDrop` usage — plus the pure `reorderNodes` / `renumberSequence`
  helpers in `packages/core/src/ecfaSchemas.ts:388-419`, which emit a *minimal*
  patch set. Persistence is optimistic → one batched PATCH → reconcile or roll
  back.
- **react-aria's `Button slot="drag"` gives keyboard lift/move/drop/cancel for
  free** (EcfaBoard already ships it). Add ▲▼ buttons for **touch and gloved
  hands** — that is the real argument, not accessibility.
- Per-block property forms: lift the *rendering* half of `TemplateFields`
  (`components/safetyBoards/TemplatePicker.tsx`) with a **static**
  `BLOCK_FIELD_SCHEMAS` map in `packages/core`. Skip the DB-backed
  `fields_schema` layer — block kinds are known at build time. Add a `textarea`
  variant.
- Live preview: `useMemo` deriving the rendered view from the same state the
  editor mutates, as `ManualEditor` does. No second renderer.
- Image upload: `ManualEditor`'s flow, but targeting the **private**
  `strike-media` bucket, so it returns a signed URL, not `getPublicUrl`.
- Forms stay hand-rolled `useState`. `react-hook-form` and `zod` are installed
  but used in 2 and 1 files respectively; matching them here would introduce the
  pattern for the second time ever.

### Version 2+ / copy-on-edit is new ground

Nothing in this repo deep-copies a parent plus children. `manual_versions`
archives *backward* via a trigger; `adoptLibraryChemical` copies one row with
zero children. Write it as a service-role route: read source version +
questions + answers, strip ids, insert the version, insert questions capturing an
old-id→new-id map, insert answers re-pointed through it.
`POST /api/superadmin/strike` hardcodes `version_number: 1` — that literal is the
seam.

### Publish preflight

Pure `validateStrikeVersionForPublish()` in `packages/core`, returning
`{ index, message }[]` per `validateQuestions` in `lotoCompetencyExam.ts`. Blocks
on: missing image alt, missing audio/video transcript, **any graded question with
no correct answer**, unset passing score, AI-drafted blocks without recorded
human approval.

Two deliberate departures from house posture, both justified:
- **Blocking, not an advisory banner.** `EditStepsSheet` renders its OSHA check
  as a non-blocking amber banner. A question with no correct answer is
  *unpassable forever* and silent (`packages/core/src/strike.ts:142`).
- **A publish confirmation dialog** stating the blast radius ("142 people hold a
  current completion of v1") and forcing minor-update vs material-change. The
  repo's two publish UIs are non-modal with no confirmation; neither can mark a
  workforce untrained.

---

## Operational gotchas (all cost real time to rediscover)

- **`npm install` needs `SENTRYCLI_SKIP_DOWNLOAD=1`** — the Sentry CLI binary
  fetch is a hard install failure on a restricted network. CI already does this.
- npm's optional-dependency bug drops `@rolldown/binding-linux-x64-gnu`;
  **vitest will not start** without it. `@img/sharp-*` are now pinned in
  `optionalDependencies`.
- **Check CI *jobs*, not runs.** The `repo-health` workflow's run-level
  `conclusion` read `success` while the `verify` job inside it had failed. That
  hid a broken `main` for over a week.
- `verify` runs typecheck → lint → full suite → core → build, and **stops at the
  first failure**, skipping everything after. A typecheck break silently disables
  all downstream gating.
- **Migrations are applied by hand — there is no runner.** Idempotent, safe to
  re-run, ending with `notify pgrst, 'reload schema';`. Get numbers from
  `node scripts/next-migration-number.mjs <slug>`, never by eyeballing:
  this migration collided twice (256 → 259 → 260) while its PR was open.
  Reference migrations by **slug** in prose, not by number.
- A merged branch must be **restarted from `main`**, not stacked on.

---

## Open decision: NPM additions

Proposed, not actioned — verified against the dependency list on `main`:

| Package | Gap it fills |
|---|---|
| `testcontainers` | 4375 tests, **none touch a database**, while RLS/column grants/freeze triggers all live *in* the DB. Directly closes the owed proof above. |
| `@upstash/ratelimit` | `lib/rateLimit/memory.ts` says in its own header it is "not a security boundary" — on serverless the ceiling is `limit × live instances`. |
| `eslint-plugin-jsx-a11y` | Absent. Section 508 is binding per the STRIKE spec; a11y is caught only by hand-written regression tests. |
| `@playwright/test` | No browser E2E at all. PWA offline, service worker, QR entry, iOS autoplay are untestable in jsdom. |
| `size-limit` | No bundle budget; mobile-first on plant cellular. |
| `intl-messageformat` | `packages/core/src/i18n.ts` has 27 keys and **no interpolation or pluralization**. Spanish matters for this workforce. |

**Do not add:** three.js, framer-motion, canvas-confetti, lottie, react-dnd —
each is replaceable with CSS, native `<canvas>`, or react-aria's
`useDragAndDrop`, which is already a dependency.
