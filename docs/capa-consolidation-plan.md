# Consolidating the two CAPA systems — design note

**Status:** Design only. Nothing here is applied; no migration is written yet, deliberately —
the vocabulary decision below has to be made first, and it determines the backfill.

Migration `198_incident_actions_completed_by.sql` describes itself as "CAPA consolidation —
phase 1, additive… No data is migrated and no table is dropped here — those are later phases."
This is the plan for those phases.

---

## The problem

Two tables mean "corrective and preventive action":

- **`incident_actions`** (migration 063, + 077/198/236/244) — the `/incidents/[id]/actions` tab.
- **`incident_capas`** (migration 152) — the `CapaPanel` on the incident detail page.

They disagree on vocabulary, so they cannot even be unioned without a mapping:

| Concept | `incident_actions` | `incident_capas` |
|---|---|---|
| Hierarchy of controls | `elimination`, `substitution`, `engineering`, `administrative`, `ppe` | `eliminate`, `substitute`, `engineering`, `administrative`, `ppe` |
| Statuses | `open`, `in_progress`, **`blocked`**, **`complete`**, `verified`, `cancelled` | `open`, `in_progress`, **`completed`**, `verified`, `cancelled` |
| Owner | `owner_user_id` | `assigned_to_user_id` |
| Completed by | `completed_by` (198) | `completed_by_user_id` |
| Verified | `verified_at` / `verified_by` | `verified_effective_at` / `verified_by_user_id` |
| Evidence | `verification_evidence` | `verification_notes` |
| Provenance | `ai_origin` / `ai_edited` (236) | — |
| Source link | `source_rca_node_id`, `source_ecfa_node_id`, `source_thread_id` | — |
| Type | `action_type` (`corrective`/`preventive`/`interim`) | — |

And they have **disjoint consumers**, which is what makes this a correctness problem rather than
a tidiness one:

| Consumer | Reads |
|---|---|
| `api/cron/incident-action-reminders/route.ts:94` — due-date nudges | actions only |
| `app/_components/OpenActionsPanel.tsx:48` — home "your open actions" | actions only |
| `packages/core/src/incidentScorecardMetrics.ts:548,586` — hierarchy mix, on-time closure | actions only |
| `api/cron/incident-trends-weekly` — Monday digest | actions only |
| `api/insights/leading-signals`, `lib/incidentRiskFeatures.ts` | actions only |
| `packages/core/src/ecfaSchemas.ts` — causal-factor → action draft | actions only |
| `packages/core/src/iso45001.ts:122,127`, `iso14001.ts` — conformance evidence | **CAPAs only** |
| `app/admin/insights/risk-intelligence/_components/CapaWidget.tsx` | **CAPAs only** |
| `lib/ai/operator/carveOuts/capaHighSeverityClose.ts` | actions only (third copy of the verify rule) |

So a CAPA entered through `CapaPanel` — which sits on the incident detail page, the most obvious
place to record a corrective action — generates **no reminder**, never shows in the home panel,
and is **invisible to the hierarchy-of-controls mix and on-time-closure metrics**. Actions
entered on the Actions tab never count as ISO 45001 §10.2 evidence. Each system is blind exactly
where the other is authoritative.

## Target

Keep **`incident_actions`**. It is the older table, carries strictly more structure (action type,
source links back to the RCA/ECFA node that produced it, AI provenance), and already has the
operational machinery pointed at it — reminders, scorecard, digest, risk features, safety-board
spawn. Retiring it would mean re-pointing seven consumers; retiring `incident_capas` means
re-pointing two.

What `incident_capas` has that must survive the move:

1. **`verified_effective_at` semantics** — ISO 45001 §10.2 asks for *verification of
   effectiveness*, which is a distinct event from "verified". `incident_actions.verified_at`
   currently carries both meanings. Add an explicit `effectiveness_verified_at` rather than
   overloading.
2. **`verification_notes`** free text — map onto `verification_evidence`.
3. **The different-verifier trigger.** Both tables enforce it (152's trigger, 198's
   `incident_actions_enforce_different_verifier()`); keep the `incident_actions` one.

## Vocabulary decision — needed before any backfill

Two live vocabularies. Pick one, then the backfill is mechanical:

- **Hierarchy:** `elimination`/`substitution` (NIOSH wording, used by `HIERARCHY_RANK` and the
  scorecard) vs `eliminate`/`substitute` (imperative, ISO-flavoured). **Recommend the NIOSH
  wording** — it is what the scorecard already ranks and what `incidentAction.ts` documents.
  Map `eliminate → elimination`, `substitute → substitution`; the other three are identical.
- **Completion:** `complete` vs `completed`. **Recommend `complete`** — it is the
  `incident_actions` value the reminder cron and scorecard already filter on. Map
  `completed → complete`.

`incident_capas` has no `blocked` status, so nothing is lost in that direction.

## Sequencing

Additive first, destructive later — and *land* the later phases, which is where 198 stopped.

1. **Additive schema.** Add `effectiveness_verified_at` + `effectiveness_verified_by` to
   `incident_actions`. No behaviour change.
2. **Backfill.** Insert every `incident_capas` row into `incident_actions` with the vocabulary
   map above, `action_type = 'corrective'`, `verification_evidence = verification_notes`, and a
   `legacy_capa_id` column so the move is reversible and re-runnable. Idempotent on
   `legacy_capa_id`.
3. **Re-point the two CAPA-only consumers** — `iso45001.ts` / `iso14001.ts` evidence sources, and
   `CapaWidget.tsx` — onto `incident_actions`, filtering on the effectiveness columns for the ISO
   evidence claim. This is the step that actually closes the reporting hole.
4. **Redirect the UI.** `CapaPanel` on the detail page and the `/actions` tab become one surface.
   Whichever is kept, the other route stays as a redirect stub — the module already does this for
   `/rca` and `/ecfa`.
5. **Retire.** Drop `/api/incidents/[id]/capas/*`, `packages/core/src/incidentCapa.ts`, and the
   `incident_capas` table — only after a full release window with dual-read in place, and after
   `classifyCapa`/`summarizeCapas`' derived states (`overdue`, `awaiting_verification`) have
   equivalents on the actions side. `incidentCapa.test.ts`'s 17 assertions should move with them,
   not be deleted.

Also fold in `lib/ai/operator/carveOuts/capaHighSeverityClose.ts`, whose header admits it
"mirrors the verify/close half of the PATCH route" — a third copy of the same rule.

## What this is worth

Once step 3 lands, a corrective action recorded anywhere in the product gets a due-date reminder,
appears in the owner's open-actions list, counts toward the hierarchy-of-controls mix and on-time
closure, and stands as ISO 45001 §10.2 evidence. Today none of those are true of half the CAPAs
in the system, and nothing in the UI tells anyone which half they are in.
