# Predictive Safety Intelligence (PSI) — plan

_Authored 2026-08-19. Reviewed twice (AI-engineering and systems-architecture),
then cross-reviewed. Every load-bearing claim below was verified against the
code, not assumed._

## Goal

1. Computer vision + predictive risk modelling to spot patterns **before**
   incidents occur.
2. AI assistants supporting **proactive** decision-making.
3. LLM first-draft regulatory documents — risk assessments, method statements,
   incident reports, JSA checklists.

## 1. What already exists

| Pillar | Shipped today | The real gap |
|---|---|---|
| Computer vision | `assistant-scan-photo` (nameplate OCR). `loto-audit-fpe` — a vision agent over LOTO placard photos: offline, batched, human-gated. Per-upload photo validation was **deliberately removed** (`lib/ai/models.ts` header). | Nothing reads the **field evidence stream** — BBS observation photos, incident attachments, hot-work permit photos, hazwaste inspection photos. No image becomes a countable, trendable hazard signal. |
| Predictive risk | `incidentRiskModel` — deterministic 0–100 score over 19 weighted indicators. `forecast.ts` — EWMA + Poisson prediction intervals + c-charts. `leadingIndicatorSignals` — lagged correlation with a reliability gate. `statistics.ts`. | The score is a **snapshot of current state**, never persisted, so nothing is trendable. No mechanism turns a firing signal into a ranked, evidenced recommendation. |
| Proactive assistant | `/api/assistant/chat` (pull, 17 tools). Operator Console. `assistant_tasks` + cron. Weekly digests. | Nothing **initiates**. No defensible answer to "what should I do this week, and why that". |
| Regulatory drafts | `generate-loto-steps`, `generate-confined-space-hazards`, toolbox talks, `rca-assist`, `ecfa-assist`. | **Method statements (SWMS/RAMS) do not exist in the product at all.** No shared draft contract, so every generator re-litigates provenance, review gating, and grounding. Nothing is RAG-grounded despite `lib/ai/rag.ts` existing. |

## 2. Invariants inherited from this codebase

- **I1 — numbers are deterministic; LLMs only narrate.** `incidentRiskModel`
  states the score "is intentionally NOT produced by an LLM". Every number PSI
  emits is reproducible without an API key.
- **I2 — no per-upload AI gate.** Vision runs offline and batched over stored
  photos, honouring the documented operator decision.
- **I3 — nothing AI-authored writes live data.** Signals and drafts are staged;
  a human accepts. Mirrors `incident_ecfa_ai_suggestions`.
- **I4 — tenant *and facility* isolation is structural.** Migration 211 only
  auto-scopes generated policies; hand-written ones must carry the facility
  clause themselves.
- **I5 — degrade, don't break.** Cross-module gathers are best-effort.

## 3. What the two reviews changed

The first draft of this plan proposed department-level risk segmentation, a
numeric confidence gate on vision output, ungrounded document drafting, and
wiring vision signals straight into the risk score. All four were wrong.

**Verified findings that changed the design:**

1. **SSRF (merge-blocking).** `bbs_observations_v2` is inserted directly from
   the browser via PostgREST and `photo_url` is unconstrained `text`
   (`migrations/162:47-49`, `app/bbs/observe/page.tsx:86`). `imageFetch.ts`
   does a plain unauthenticated `fetch(url)` with no allowlist, size cap, or
   redirect limit. A nightly service-role sweep fetching those URLs is a
   tenant-controlled SSRF. → **The sweep never fetches a stored URL.** It
   derives the storage key and downloads with the service role, as
   `storagePhotoSearch.ts:86` already does, rejecting keys outside the tenant
   prefix.
2. **Department has no join key.** It is free text on `loto_equipment` only;
   `incidents` deliberately has no department FK (`059:57-59`).
   `facility_id` *is* a real indexed axis (`migration 210` Bucket A) — but
   migration 210 **backfills every pre-existing row to the tenant's primary
   facility** (`210:102-110`), so any window straddling that migration renders
   a backfill artifact as a finding. → **Facility segmentation is deferred**
   until there is an exposure denominator and a backfill-window guard.
3. **Self-reported numeric confidence is not a probability.** The house
   precedent (`lib/loto/audit/schemas.ts`) uses an ordinal
   `high|medium|low` and lets deterministic code decide. → PSI does the same.
4. **Identity must be content-addressed.** Keying signals by run id means every
   resume re-inserts the same finding. → Natural key on
   `(tenant_id, source_kind, source_id, photo_sha256, hazard_code)`.
5. **`MODEL_PRICING` silently falls back to Sonnet pricing** for an unknown
   model id (`usageAggregator.ts:58`), so a new model constant without a
   pricing row makes `checkTenantBudget` under-bill and stop enforcing. →
   Pricing rows ship with the constants, plus a test that every routed model
   has one.
6. **Ungrounded citations are the highest-liability failure.** A method
   statement with an invented CFR cite gets signed. → Retrieve-then-draft via
   `lib/ai/rag.ts`; store `chunk_ids`; reject any citation that does not
   resolve to a retrieved chunk; `jurisdiction` is a required input, never
   inferred.

**The one genuine disagreement** — whether hand-authored precursor rules are
audit-defensible (architect: yes, explainable) or a fitted model with no error
bar (AI engineer: an explainable rule with no measured hit rate answers an
auditor no better than a black box). Both are right about different things:
explainability and validity are orthogonal. **Synthesis, adopted:** rules stay
hand-authored and carry a required `basis` premise, *and* each carries a
validation status computed from that tenant's own history using the existing
`laggedCorrelation` reliability gate. The gate is a **label**, not a firing
gate — requiring `reliable` before a rule may fire would mean no rule fires for
years. Unvalidated rules render as "conditions to check" and never outrank
validated ones.

## 4. Architecture

```
packages/core/src/                    (pure · no I/O · unit-tested)
  visionHazardTaxonomy.ts   closed 14-code vocabulary, per-source eligibility,
                            ordinal gate, evidence sanitizer, content identity
  precursorRules.ts         hand-authored rules + basis + validation label
  safetyBriefing.ts         deterministic ranking of recommended moves
  documentDrafts.ts         draft kinds, review state machine, citation resolution
  methodStatement.ts        SWMS/RAMS domain type + completeness validation

apps/web/lib/
  ai/vision/hazardSweep.ts  claim → download by key → gate → upsert
  ai/drafts/draftDocument.ts retrieve-then-draft, one service, four kinds

apps/web/app/api/
  insights/briefing          GET   ranked moves            (tenant admin)
  drafts                     POST  draft a document        (tenant admin)
  cron/vision-hazard-sweep   POST  opens a run
  cron/vision-sweep-resume   POST  drains claimable work   (*/5)

apps/web/migrations/256_predictive_safety_intelligence.sql (+ 256_rollback.sql)
```

### 4.1 Vision — execution model

The repo's cron ceiling is 300s and `runAudit` does not self-checkpoint; it
survives via a separate `*/5` resume cron with a stall detector. PSI copies
that shape rather than inventing one:

- The nightly cron **only opens a run** and enqueues claimable
  `vision_sweep_photos` work rows. It never processes photos itself.
- `vision-sweep-resume` (`*/5`) claims `queued` rows in bounded batches,
  processes them, and stops on a wall-clock deadline well inside `maxDuration`.
- Every row is terminal-stated: `done`, `not_assessable`, or `failed`.
  **`not_assessable` is first-class** — "we looked and could not tell" is not
  "clean", and an auditor must be able to see the difference.
- Per-tenant opt-in via `tenants.modules`; **off by default**.

### 4.2 What is deliberately NOT wired

Confirmed vision signals do **not** feed `incidentRiskModel` in this phase.
Both reviewers insisted independently and the argument is correct: shipping a
scoring change before per-code precision is measured poisons a number the
product already trusts. The severity weights exist in the taxonomy so the
integration is a one-line change once a gold set exists.

## 5. Phasing

- **Phase 1 (this change)** — the four capabilities above, engine + API +
  tests. No new nav-registered UI. Safe because the sweep is opt-in and off:
  nothing accumulates un-reviewed until a tenant enables it, and the gate on
  enabling it is Phase 2 shipping the review page.
- **Phase 2** — admin review page for vision signals; draft review/accept UI;
  nav + manual + wiki registration.
- **Phase 3** — vision gold set (≥300 photos, stratified by `source_kind`,
  dual-annotated, per-code precision/recall) → then wire into the risk model.
  Facility segmentation with an exposure denominator, a backfill-window guard,
  and persisted nightly score snapshots for trending.

## 6. Model routing

| Surface | Model | Why |
|---|---|---|
| `vision-hazard-sweep` | Haiku 4.5 | High-volume perception behind a conservative deterministic gate and human review — the `loto-audit-fpe` precedent. |
| `draft-regulatory-document` | Sonnet 5 | A qualified professional reads every draft; quality matters and every draft is human-accepted. |
| `safety-briefing-narrate` | Sonnet 5 | Advisory narration over deterministic numbers — the `scorecard-focus` class. |

New model constants are used **only by new surfaces**. Migrating the ~40
existing surface mappings is a separate, testable change; a drive-by bump here
would put every shipped surface's behaviour up for re-validation inside a PR
about something else.

## 7. Residual risks

- **R1 — vision false negatives.** A missed hazard could read as "checked,
  found nothing". Mitigated by the `not_assessable` state and by recording
  photos skipped, not only photos examined. Signals are never a clearance.
- **R2 — cost.** One Haiku call per photo per sweep, bounded by a per-run cap
  and an upfront tenant budget check. Note `checkTenantBudget` reads every
  successful invocation row for the tenant that day — a mid-run re-check would
  be quadratic, so the per-run cap is the control instead.
- **R3 — precursor false positives** eroding trust. Mitigated by the
  validated/unvalidated label, the required `basis`, and cited evidence.
- **R4 — draft over-trust.** Mitigated by enforced citation resolution,
  required jurisdiction, explicit provenance, and no auto-publish.
