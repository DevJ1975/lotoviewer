# Soteria FIELD EMS Module — ISO 14001 Implementation Plan

Oct 1, 2026 · @Jamil

## How to use this document

This plan adds an ISO 14001 environmental management system (EMS) module to Soteria FIELD (repo `DevJ1975/lotoviewer`), delivered in eight phases, each a separate branch and pull request. Paste the master prompt in the last section into Claude Code first, then paste one phase prompt per session. Every phase prompt tells Claude Code to read this plan, read the repo, confirm its assumptions, and stop for your approval before writing migrations.

The plan is written for a coding agent, so it is text only: no diagrams, so it pastes clean. Where the repo's conventions are unknown (ORM, auth, file storage, queue), the plan says `DISCOVER` and Phase 0 fills the gap. Nothing here assumes a specific database or framework beyond what is already in the repo: Next.js web, Expo mobile, a shared package layer, multi-tenant data.

What ships at the end of Phase 7:

1. Aspects and impacts register with significance scoring and change triggers
2. Compliance obligations register with a scheduled, documented evaluation of compliance
3. Permit and registration vault with renewals, conditions as tasks, and an ownership-change workflow
4. Environmental objectives tracker and management of change (MOC)
5. Environmental field rounds on QR-tagged assets, offline-capable, with photo evidence
6. Hazardous waste tracker (generator status, accumulation clocks, manifests) and a shared chemical inventory
7. CAPA, internal audit, and management review
8. Environmental dashboard and exportable reports

An ISO 45001 (OH&S) module is not in scope for these phases, but the shared core is built so it can be added later without a rewrite; see the "ISO 45001 extension" section for the seams, placeholder tables, and future phases 8 to 11.

Work the phases in order. Phases 1 and 2 are the minimum viable EMS; Phase 4 is where Soteria FIELD's existing LOTO field workflow gives you the most leverage.

## Design dialogue: lead auditor and SaaS developer

The module must make an auditor's three-way check (document, floor, people) answerable from one screen, and it must never let a required record go silently missing. Those two sentences drove every decision below. The dialogue is reproduced so Claude Code understands the *why* behind each feature, not just the *what*.

**Auditor:** The first thing I ask on any 14001 audit is "show me your aspects register, your legal register, and your last evaluation of compliance." If any of the three is missing or undated, that is a major nonconformity before I walk the floor. The product must make those three records impossible to forget.

**Developer:** So the registers are first-class entities, not documents. Each row carries `last_reviewed_at`, `reviewed_by`, and `next_review_due`. A register with any row past due shows amber on the dashboard; a register with no rows at all shows red. The evaluation of compliance is a scheduled job that creates a task per obligation, and the task cannot close without a result and evidence.

**Auditor:** The second thing I look for is whether the register reflects today's plant. Sites rebuild lines, add machines, change owners. The register goes stale because nobody tells the environmental coordinator. I find obsolete aspects for processes that no longer exist and missing aspects for machines that arrived last quarter.

**Developer:** That is a management-of-change problem. An MOC record (new equipment, new chemical, process change, ownership or name change) fans out to the aspects, obligations, permits, and objectives it touches and marks each one `review_required`. Nothing is edited automatically; the right people get a task. Aspects also get an `obsolete` state with a reason and date, so a retired process stays in history but leaves the active view.

**Auditor:** Third: operating conditions. Clause 6.1.2 requires aspects to be considered under normal, abnormal, and emergency conditions. Most sites score only normal operation. Spills, start-up, shutdown, and weather events are where the real impacts are.

**Developer:** `operating_condition` becomes a required enum on every aspect scoring row, and a single aspect can have three scoring rows, one per condition. The register view groups them so the gap is visible: an aspect with only a normal-condition score shows a "no abnormal/emergency assessment" chip.

**Auditor:** Fourth: objectives. Clause 6.2 wants measurable environmental objectives with owners, resources, dates, and a way to evaluate results. Sites often have real improvement projects (lighting retrofits, low-NOx burners, eliminating a hazardous chemical) that are never written up as objectives, so they get no credit and no tracking.

**Developer:** The objectives tracker takes a baseline, a target with a unit, an owner, a due date, and a progress log. It links to the aspects it improves and to the capital or maintenance project behind it. A site with zero active objectives gets a dashboard warning, because that is the single most common Clause 6 finding.

**Auditor:** Fifth: permits. On a site that has changed hands, the first thing I check is the name on every permit. Air, waste, wastewater, stormwater, Tier II, SPCC. If the holder of record is a previous owner, that is a compliance exposure the site may not even know it has. Renewals for the permits the plant cannot run without are a continuity risk, not a paperwork item.

**Developer:** The permit vault stores holder of record, agency, permit number, issue and expiry, and a `business_critical` flag. An ownership-change MOC generates a checklist row per permit: notify, transfer, confirm, with evidence. Expiry countdowns escalate at 180, 90, and 30 days. Permit conditions become recurring tasks so a quarterly sampling requirement cannot be forgotten.

**Auditor:** Sixth: the floor. Weekly satellite accumulation area checks, quarterly stormwater visuals, monthly SPCC containment inspections. These are the records I sample most, and they are the ones most often missing weeks. The inspector walks the yard with a clipboard, and the form never makes it to a file.

**Developer:** This is where Soteria FIELD already wins. We already have QR-tagged assets with inspection history, offline capture, and photo evidence for LOTO. A waste container, a tank, an outfall, and a containment berm become asset types with environmental inspection templates. Missed rounds surface the same way a missed LOTO periodic inspection does.

**Auditor:** Last: findings. Internal audit findings and agency findings must go through corrective action with root cause and an effectiveness check, and management review must see compliance status and changing circumstances. If I cannot trace a finding to a closed, verified action, Clause 10 fails.

**Developer:** CAPA is one workflow for internal audit, agency inspection, field round failures, and incidents. Closure requires a root cause, an action owner, a verified date, and an effectiveness check with evidence. Management review is a generated pack that pulls the Clause 9.3 inputs from the live data, so the meeting starts with the facts rather than a slide someone assembled the night before.

**Agreed design principles:**

1. Every required record is an entity with review dates, never a free-form document.
2. Change flows outward: one MOC marks everything it touches for review.
3. Required fields encode the standard (operating condition, significance method, holder of record).
4. Reuse the asset and inspection model; do not build a parallel one.
5. Absence is visible: empty or stale registers, zero objectives, and missed rounds show on the dashboard without anyone running a report.
6. Evidence is attached at the point of action: photos, documents, and sampling results live on the row they prove.

## Lessons from the audit, generalized into requirements

Each lesson below is a pattern seen at heavy-industry sites with a change of ownership; none is a client fact, and none should be reproduced as seed data. The requirement column is what Claude Code builds.

| # | Pattern an auditor finds | Clause / rule | Product requirement |
| --- | --- | --- | --- |
| L1 | Leadership knows the issues but no dated context analysis, interested-parties register, or climate-change determination exists | 14001 4.1, 4.2, Amd 1:2024 | Context register: issues (internal/external, incl. climate), interested parties with needs and which become obligations, dated reviews |
| L2 | Scope statement names a previous legal entity or omits parts of the site | 14001 4.3 | Scope record with legal entity, physical boundary, activities, products; versioned; shown on dashboard |
| L3 | Policy lacks one of the three commitments or is signed by a prior owner | 14001 5.2 | Policy record with three required commitment checkboxes, signatory, date, version; stale signatory warning |
| L4 | Aspects register exists but has obsolete rows, undocumented change reviews, and only normal-condition scoring | 14001 6.1.2 | Aspect lifecycle (active/obsolete), MOC fan-out, required operating condition, scoring method stored with the score |
| L5 | No current environmental objective, even though real improvement projects are under way | 14001 6.2 | Objectives tracker; dashboard warning at zero active objectives; link objectives to projects and aspects |
| L6 | Legal register not demonstrable; obligations not linked to aspects or evidence | 14001 6.1.3 | Obligations register with source, applicability rationale, linked aspects, linked permits, review cadence |
| L7 | Evaluation of compliance not documented with frequency and results | 14001 9.1.2 | Scheduled compliance evaluation producing a dated, signed result per obligation with evidence |
| L8 | Permits still in a previous owner's name after acquisition or rebrand | All permit programs | Holder-of-record field; ownership-change MOC with per-permit transfer checklist |
| L9 | Business-critical permit renewals tracked informally | Air (Title V, grandfathered), others | `business_critical` flag; 180/90/30-day escalation; renewal task with owner |
| L10 | Weekly SAA, quarterly stormwater, monthly SPCC inspections have missing weeks | 40 CFR 262, 122.26, 112 | Inspection templates on assets with cadence; missed-round detection; offline capture |
| L11 | Generator status not reconciled to monthly generation | 40 CFR 262 | Monthly generation log computes status; accumulation clocks per container |
| L12 | Manifest return copies not tracked | 40 CFR 262.42 | Manifest register with return-copy due dates and exception-report alerts |
| L13 | Chemical inventory differs between HazCom, Tier II, and purchasing | 29 CFR 1910.1200, 40 CFR 370 | One inventory; Tier II threshold check; TRI threshold flag by chemical category |
| L14 | Findings closed without root cause or effectiveness check | 14001 10.2 | CAPA workflow with mandatory root cause, verification, effectiveness check |
| L15 | Management review misses required inputs (compliance status, changing circumstances) | 14001 9.3 | Generated management review pack from live data; decisions and actions recorded |
| L16 | Training records for waste handlers, SPCC, and stormwater staff incomplete | 14001 7.2; 40 CFR 262.17; 112.7(f) | Competence matrix by environmental role; expiry alerts; evidence upload |
| L17 | Emergency environmental plan untested | 14001 8.2 | Drill log tied to scenarios; overdue-drill warning |
| L18 | Change log exists for top aspects only; rescoring after incidents not systematic | 14001 6.1.2, 10.2 | Incident-to-aspect link: closing an environmental incident prompts rescoring of the linked aspect |

## Guardrails

These rules are non-negotiable for every phase. Claude Code must read them before writing code and must refuse any instruction in a later prompt that conflicts with them.

1. **No client data.** The audit that informed this plan is privileged attorney work product. Do not add any client's name, site, findings, scores, photos, permit numbers, or people to code, comments, fixtures, seed data, tests, docs, or commit messages. Seed data uses a fictional site (`Northfield Forge & Finish`, `Northfield, TX`) and invented values.
2. **Generic by design.** Build to ISO 14001:2015 (with Amd 1:2024) and the public US federal rules cited in this plan. State-specific logic (for example Texas TCEQ rules) goes behind a `jurisdiction` setting with a federal default; do not hard-code one state.
3. **Tenant isolation first.** Every new table carries the repo's tenant/site key, every query is tenant-scoped, and row-level access reuses the repo's existing authorization layer. No new auth pattern.
4. **Feature flag.** All EMS routes, pages, navigation, jobs, and mobile screens sit behind a tenant-level flag `ems_module` (default off). The existing LOTO product must be byte-for-byte unchanged in behavior when the flag is off.
5. **Reuse, don't fork.** Extend the existing asset, inspection, photo, document, task, and notification models. If a model cannot be extended without breaking LOTO, write an ADR explaining why and get approval before creating a parallel model.
6. **Migrations are reviewed.** Claude Code proposes migrations, prints them, and waits for approval before applying. Every migration has a down migration.
7. **Audit trail.** Every write to an EMS entity records who, when, and what changed (reuse the repo's audit log if one exists; otherwise add `ems_audit_log`).
8. **Evidence integrity.** Uploaded evidence stores a content hash and the uploader; evidence is never deleted, only superseded.
9. **Offline parity.** Any field capture feature works offline in the mobile app with the same conflict rules the LOTO features use (field-level last-writer-wins with timestamps, never whole-document replace).
10. **Tests before merge.** Each phase ships unit tests for domain logic, integration tests for API routes, and at least one end-to-end test for the primary flow. CI must pass before the PR is opened.
11. **No new dependencies without justification.** Prefer what the monorepo already uses. Any new package needs a one-line rationale in the PR description.
12. **Plain language in the UI.** Labels use the standard's words (aspect, impact, compliance obligation, operating condition) so an auditor recognizes them, with tooltips that define each term in one sentence.

## Architecture and data model

The EMS module is a bounded context inside the monorepo: one domain package, one API namespace, one web route group, one mobile feature folder, all keyed by the existing tenant and site identifiers and hung off the existing `Asset` model. Claude Code adapts the names below to the repo's actual conventions discovered in Phase 0; the shapes are the contract.

**Where it lives (adapt to repo layout):**

```text
packages/ms-domain/         shared management-system core: Discipline type, registerHealth, policyIsComplete, mocFanOut, capaCanClose, mgmtReviewInputs (pure TypeScript, no I/O)
packages/ems-domain/        environmental: scoreAspect, aspectCompleteness, permitEscalation, waste and chemical rules
packages/ohs-domain/        PLACEHOLDER: exports Discipline and a NotImplemented error only; filled from Phase 8
apps/web/app/(ms)/          shared pages: context, policy, obligations, objectives, MOC, CAPA, audits, management review, training
apps/web/app/(ems)/         environmental pages: aspects, permits, rounds, waste, chemicals, dashboard tiles
apps/web/app/(ohs)/         PLACEHOLDER: one page behind ohsms_module that says "OH&S module not yet enabled"
apps/web/app/api/ms/ and api/ems/   REST or RPC handlers (match the repo's 340 existing routes' style)
apps/mobile/features/ms/    shared mobile: CAPA quick-add, training lookup
apps/mobile/features/ems/   Expo screens: rounds, container checks, outfall photos (offline-first)
apps/mobile/features/ohs/   PLACEHOLDER: empty folder with README
packages/db/                migrations + repository functions for ms_*, ems_* tables (match existing ORM)
packages/jobs/              scheduled jobs: compliance evaluation, permit countdowns, missed-round detection
```

**Entities (all rows carry `tenant_id`, `site_id`, `created_at`, `updated_at`, `created_by`, `updated_by`):**

```text
-- SHARED MANAGEMENT-SYSTEM CORE (prefix ms_): used by ISO 14001 now and ISO 45001 later.
-- Every ms_ row carries discipline(ems|ohs|integrated) in addition to tenant_id, site_id and the audit columns.
ms_context_issue          id, discipline, kind(internal|external|climate), description, relevance, last_reviewed_at, next_review_due
ms_interested_party       id, discipline, name, needs_expectations, becomes_obligation(bool), obligation_id?, last_reviewed_at
ms_scope                  id, discipline, legal_entity, physical_boundary, activities, products_services, version, effective_from, approved_by
ms_policy                 id, discipline, text, commitments(json: keyed by standard, e.g. ems.protect_env, ems.compliance, ems.improve, ohs.safe_conditions, ohs.consultation, ohs.eliminate_hazards), signatory, signed_at, version
ms_obligation             id, discipline, title, source_kind(law|permit|contract|voluntary|internal), citation, jurisdiction(federal|state:XX|local), summary, applicability_rationale, owner_id, review_cadence_days, last_reviewed_at, next_review_due, status
ms_compliance_eval        id, obligation_id, scheduled_for, completed_at, evaluator_id, result(compliant|noncompliant|not_applicable|undetermined), notes, capa_id?
ms_moc                    id, discipline, kind(equipment|chemical|process|ownership_name|personnel|other), title, description, requested_by, status, opened_at, closed_at
ms_moc_impact             id, moc_id, target_type(aspect|hazard|obligation|permit|objective|asset|control), target_id, action_required, resolved_at, resolved_by
ms_objective              id, discipline, title, linked_aspect_ids(json), linked_hazard_ids(json), metric, unit, baseline_value, target_value, owner_id, due_date, status, project_ref
ms_objective_progress     id, objective_id, measured_at, value, note, evidence_id?
ms_scoring_method         id, discipline, name, severity_scale(json), likelihood_scale(json), significance_threshold, version
ms_inspection_template    id, discipline, asset_profile_type, name, cadence_days, items(json: prompt, type, pass_criteria), opens_capa(bool)
ms_inspection             id, template_id, asset_id, performed_at, performed_by, result(pass|fail|na), items(json), offline_captured(bool), synced_at
ms_capa                   id, discipline, source_kind(internal_audit|agency|inspection_fail|incident|compliance_eval|consultation|other), source_id, description, root_cause, root_cause_method, owner_id, due_date, status, verified_at, verified_by, effectiveness_check_at, effectiveness_result, evidence_ids(json)
ms_internal_audit         id, discipline, scope, auditor_id, planned_for, performed_at, findings_count, report_document_id
ms_internal_audit_finding id, audit_id, standard(iso14001|iso45001|osha|other), clause, requirement, evidence, statement, severity(major|minor|observation|opportunity), capa_id
ms_mgmt_review            id, discipline, held_at, attendees(json), inputs_snapshot(json), decisions(json), actions(json: capa_id or task_id)
ms_training_requirement   id, discipline, role, requirement, cadence_days, citation
ms_training_record        id, requirement_id, user_id, completed_at, expires_at, evidence_id
ms_drill                  id, discipline, scenario, held_at, participants(json), lessons, capa_id?
ms_chemical               id, name, cas, sds_document_id, max_onsite_qty, unit, ehs(bool), tri_category?, location   -- serves HazCom (45001 side) and Tier II / TRI (14001 side)
ms_evidence               id, kind(photo|document|sample_result|signature), storage_key, sha256, uploaded_by, uploaded_at, superseded_by?
ms_audit_log              id, entity, entity_id, action, before(json), after(json), actor_id, at

-- ISO 14001 SPECIFIC (prefix ems_): built in Phases 1 to 7.
ems_aspect                id, name, process_area, activity, aspect_type, impact_description, lifecycle_stage, status(active|obsolete), obsolete_reason, obsolete_at, review_required(bool), review_reason, last_reviewed_at, next_review_due
ems_aspect_score          id, aspect_id, operating_condition(normal|abnormal|emergency), severity(int), likelihood(int), method_id, score(computed), significant(bool), scored_at, scored_by, rationale
ems_aspect_obligation     aspect_id, obligation_id
ems_permit                id, program(air|waste|wastewater|stormwater|spcc|epcra|other), agency, permit_number, holder_of_record, issued_at, expires_at, business_critical(bool), status, document_id
ems_permit_condition      id, permit_id, text, cadence_days?, task_template_id?, owner_id
ems_asset_env_profile     asset_id(FK existing asset), env_asset_type(waste_container|saa|caa|tank|outfall|containment|booth|other), capacity, contents, containment_capacity, last_inspected_at
ems_waste_stream          id, name, waste_codes(json), characterization_basis, profile_document_id, hazardous(bool)
ems_waste_container       id, asset_id, waste_stream_id, start_accumulation_at, location_kind(saa|caa), closed(bool), labeled(bool)
ems_waste_generation_log  id, month(YYYY-MM), waste_stream_id, quantity_kg, acute_kg
ems_manifest              id, manifest_number, shipped_at, transporter, tsdf, return_copy_due_at, return_copy_received_at, document_id

-- ISO 45001 SPECIFIC (prefix ohs_): PLACEHOLDERS ONLY in this plan; see the ISO 45001 section. Not created before Phase 8.
ohs_hazard                id, name, process_area, activity, routine(bool), hazard_category, who_is_exposed, status(active|obsolete), review_required(bool), last_reviewed_at, next_review_due
ohs_risk_assessment       id, hazard_id, operating_condition(normal|abnormal|emergency), severity(int), likelihood(int), method_id, score(computed), acceptable(bool), assessed_at, assessed_by, rationale
ohs_control               id, hazard_id, hierarchy_level(elimination|substitution|engineering|administrative|ppe), description, verified_at, linked_procedure_ref, linked_loto_procedure_id?
ohs_consultation          id, kind(committee|toolbox|survey|report|other), held_at, participants(json), topics, outcomes, capa_id?
ohs_contractor            id, name, scope_of_work, prequalification_status, insurance_expires_at, orientation_completed_at, linked_moc_id?
ohs_health_surveillance   id, program(noise|respiratory|exposure|ergonomic|other), user_id, performed_at, result_summary, next_due, evidence_id
-- ohs_incident: reuse the repo's existing incident model with a discipline tag; create ohs_incident only if none exists (ADR required).
```

**Key relationships:**

1. `ems_asset_env_profile.asset_id` points at the existing asset table; environmental assets are ordinary assets with a profile, so QR tags, location, and photo history come for free.
2. `ems_moc_impact` is polymorphic; it is the only place where change fans out.
3. `ems_capa` is the single sink for anything that fails: inspections, evaluations, audits, agency actions, incidents.
4. `ems_evidence` is append-only and referenced by id from any entity.

**Computed rules (live in `packages/ems-domain`, pure functions, fully unit-tested):**

1. `scoreAspect(severity, likelihood, method)` returns score and significance.
2. `generatorStatus(monthlyLogs)` returns `VSQG | SQG | LQG` from 40 CFR 262.13 thresholds (100 kg / 1,000 kg hazardous per month; 1 kg acute).
3. `accumulationDeadline(container, generatorStatus)` returns the on-site time limit (SAA up to 55 gal, then 3 days to move; CAA 90 days LQG, 180/270 days SQG).
4. `manifestExceptionDates(shippedAt, generatorStatus)` returns return-copy due and exception-report due (LQG: 35 days contact, 45 days report; SQG: 60 days).
5. `permitEscalation(expiresAt, today)` returns none | 180 | 90 | 30 | expired.
6. `registerHealth(rows)` returns green | amber | red from review dates and row counts.
7. `tierIIThreshold(chemical)` returns whether the max on-site quantity exceeds 10,000 lb (or the EHS threshold planning quantity / 500 lb when `ehs` is true).

**Services and jobs:**

1. Nightly `ems.evaluateDueItems`: creates compliance-evaluation tasks, permit renewal tasks, missed-round flags, training expiry notices.
2. On MOC open: `ems.fanOutChange` creates impact rows for linked entities and assigns review tasks.
3. On inspection fail or compliance result noncompliant: `ems.openCapa` creates a CAPA with the source link.
4. On incident closure (reuse the repo's incident model if present): prompt rescoring of linked aspects.

## ISO 45001 extension: architecture and placeholders

ISO 14001 and ISO 45001 share the same high-level structure (Annex SL), so the EMS build creates a shared management-system core with the `ms_` prefix and a `discipline` column; the ISO 45001 module later adds only the OH&S-specific entities (`ohs_` prefix) and reuses everything else. Nothing OH&S-specific is built in Phases 0 to 7; this section fixes the seams so the later build is additive.

**Naming rule for Claude Code:** the entities marked shared core in the Architecture code block are created with the `ms_` prefix from Phase 1 onward. Wherever a phase section or phase prompt writes `ems_objective`, `ems_moc`, `ems_capa`, `ems_context_issue`, `ems_interested_party`, `ems_scope`, `ems_policy`, `ems_obligation`, `ems_compliance_eval`, `ems_scoring_method`, `ems_inspection_template`, `ems_inspection`, `ems_internal_audit`, `ems_mgmt_review`, `ems_training_*`, `ems_drill`, `ems_chemical`, `ems_evidence`, or `ems_audit_log`, read it as the `ms_` table of the same name. The Architecture code block is the source of truth.

**What is shared and what is specific:**

| Layer | Entities | Built in | Notes |
| --- | --- | --- | --- |
| Shared core (`ms_`) | context, interested parties, scope, policy, obligations, compliance evaluation, MOC, objectives, scoring methods, inspection templates and inspections, CAPA, internal audit and findings, management review, training, drills, chemicals, evidence, audit log | Phases 1 to 7 | `discipline` defaults to `ems`; UI filters by discipline; `integrated` is allowed where a tenant runs one combined system |
| EMS specific (`ems_`) | aspects and scores, permits and conditions, environmental asset profiles, waste streams, containers, generation log, manifests | Phases 1 to 5 | No OH&S reuse |
| OH&S specific (`ohs_`) | hazards, risk assessments, controls with hierarchy level, consultation records, contractors, health surveillance | Phase 8 onward (future) | Placeholders only now |
| Existing product | LOTO procedures and periodic inspections, machine guarding, permits to work, incidents (if present) | Already shipped | Become the 45001 Clause 8.1 operational-control evidence by link, not by rebuild |

**Seams to build now (cheap in Phases 0 to 7, expensive to retrofit):**

1. `discipline` column on every `ms_` table, indexed with `tenant_id` and `site_id`; the domain package exposes `Discipline = 'ems' | 'ohs' | 'integrated'` and every shared service takes it as a parameter.
2. `ms_policy.commitments` is a JSON map keyed by standard, so a 45001 policy (safe and healthy conditions, eliminate hazards and reduce risks, consultation and participation, plus compliance and improvement) stores alongside the 14001 commitments without a schema change. `policyIsComplete(policy, discipline)` reads the required keys for the discipline.
3. `ms_moc_impact.target_type` already includes `hazard` and `control`; `mocFanOut` has a switch on `discipline` with an `ohs` branch that throws `NotImplemented` and a unit test asserting that behavior.
4. `ms_scoring_method.discipline` lets a site keep separate aspect and risk matrices or one shared matrix.
5. `ms_inspection_template.asset_profile_type` is generic (not `env_asset_type`) so safety templates (eyewash, extinguisher, guarding, confined space entry equipment) can attach to the same asset model.
6. `ms_internal_audit_finding.standard` carries `iso45001` and `osha` values from day one so an integrated audit records both.
7. Route and folder layout reserve the namespace: `packages/ms-domain` (shared), `packages/ems-domain` (environmental), `packages/ohs-domain` (stub exporting `Discipline` and `NotImplemented` only), `apps/web/app/(ms)/`, `apps/web/app/(ems)/`, `apps/web/app/(ohs)/` (empty route group with a single placeholder page behind `ohsms_module`), `apps/mobile/features/ohs/` (empty).
8. Feature flags: `ems_module` (Phases 0 to 7) and `ohsms_module` (future), both default off; the EMS navigation groups shared items under a "Management system" heading so the 45001 items slot in beside them.
9. Dashboard tiles are registered through a `tiles` registry keyed by discipline so the integrated view is a merge, not a rewrite.
10. `docs/ohs/` folder created with this section copied as `README.md` and an empty `adr/` folder.

**Placeholder phases (not scheduled; sized for later planning):**

| Phase | Scope | Reuses | New |
| --- | --- | --- | --- |
| 8 | Hazard identification and risk assessment (45001 6.1.2.1, 6.1.2.2), hierarchy of controls (8.1.2), MOC `ohs` branch | `ms_scoring_method`, `ms_moc`, `ms_objective`, asset model | `ohs_hazard`, `ohs_risk_assessment`, `ohs_control`; link controls to existing LOTO procedures |
| 9 | Worker consultation and participation (5.4), incidents and investigation (10.2), health surveillance (9.1.1) | `ms_capa`, repo incident model, `ms_training_*` | `ohs_consultation`, `ohs_health_surveillance`; incident-to-hazard rescoring prompt |
| 10 | Contractors and procurement (8.1.4), emergency preparedness OH&S (8.2), safety inspection templates on assets | `ms_inspection_template`, `ms_drill`, `ms_moc` | `ohs_contractor`; safety templates (eyewash, extinguisher, guarding, confined space, electrical) |
| 11 | Integrated management system: combined policy, objectives, audit, management review, dashboard; dual evidence pack (14001 + 45001 + OSHA 1910 cross-reference) | Everything in `ms_` | Tile merge, integrated audit pack, OSHA 1910 citation map on obligations |

**ISO 45001 clause placeholders (where each will land):**

| Clause | Requirement (short) | Lands in | Status |
| --- | --- | --- | --- |
| 4.1 to 4.4 | Context, interested parties (workers explicitly), scope, system | `ms_context_issue`, `ms_interested_party`, `ms_scope` with `discipline=ohs` | Shared core, ready after Phase 1 |
| 5.1 to 5.3 | Leadership, policy, roles | `ms_policy` commitments keyed `ohs.*`; owner fields | Shared core, ready after Phase 1 |
| 5.4 | Consultation and participation of workers | `ohs_consultation` | Phase 9 |
| 6.1.2.1 | Hazard identification | `ohs_hazard` | Phase 8 |
| 6.1.2.2 | Assessment of OH&S risks | `ohs_risk_assessment` | Phase 8 |
| 6.1.2.3 | OH&S opportunities | `ms_context_issue` risk/opportunity tag, `ms_objective` | Shared core |
| 6.1.3 | Legal and other requirements | `ms_obligation` with `discipline=ohs`; OSHA 1910 citations | Shared core |
| 6.2 | OH&S objectives | `ms_objective` with `linked_hazard_ids` | Shared core |
| 7.1 to 7.5 | Resources, competence, awareness, communication, documented information | `ms_training_*`, `ms_evidence`, `ms_audit_log` | Shared core |
| 8.1.1 | Operational planning and control | Existing LOTO, guarding, permit-to-work modules linked from `ohs_control` | Phase 8 link |
| 8.1.2 | Hierarchy of controls | `ohs_control.hierarchy_level` | Phase 8 |
| 8.1.3 | Management of change | `ms_moc` with `personnel` kind and `ohs` fan-out | Shared core; `ohs` branch Phase 8 |
| 8.1.4 | Procurement, contractors, outsourcing | `ohs_contractor` | Phase 10 |
| 8.2 | Emergency preparedness and response | `ms_drill` with `discipline=ohs` | Shared core |
| 9.1 | Monitoring, measurement, evaluation of compliance | `ms_inspection`, `ms_compliance_eval`, `ohs_health_surveillance` | Shared core; surveillance Phase 9 |
| 9.2 | Internal audit | `ms_internal_audit`, findings with `standard=iso45001` | Shared core |
| 9.3 | Management review | `ms_mgmt_review` with 45001 inputs (incidents, consultation, worker participation) | Shared core; inputs list extended Phase 11 |
| 10.2 | Incident, nonconformity, corrective action | `ms_capa`, repo incident model | Shared core; incident link Phase 9 |
| 10.3 | Continual improvement | Objectives and CAPA trends | Shared core |

## Phase 0: repo discovery, scaffolding, feature flag

Phase 0 produces no user-facing feature; it produces a written map of the repo and the empty, flagged skeleton every later phase builds on. Branch: `feat/ems-phase0-scaffold`.

**Discovery (write results to `docs/ems/00-repo-map.md`):**

1. Identify the ORM and migration tool, the database, and the migration command. Record the exact command to create, apply, and roll back a migration.
2. Identify the tenant and site keys (column names, how they are injected into queries, how authorization checks them). Record one example query from an existing LOTO repository function.
3. Identify the existing `Asset` model (or equivalent): table name, primary key, type discriminator, QR/tag field, location fields, relation to inspections and photos.
4. Identify the existing inspection, photo/evidence, document, task, notification, incident, and audit-log models. For each: table, key fields, service functions, and whether it is used by mobile.
5. Identify the API convention (REST handlers vs server actions vs tRPC), the validation library, the error shape, and the auth middleware. Record one existing route as the template.
6. Identify the mobile offline mechanism (queue, storage, sync, conflict rule) used by LOTO field capture.
7. Identify the feature-flag mechanism. If none exists, propose a `tenant_features` table with `feature_key` and `enabled` and a `hasFeature(tenantId, key)` helper, and wait for approval.
8. Identify the test runner, test locations, CI workflow, lint and format commands.
9. Identify the design system / component library and the navigation structure for web and mobile.

**Scaffolding:**

1. Create `packages/ems-domain` with `types.ts`, `scoring.ts`, `waste.ts`, `permits.ts`, `health.ts`, each exporting stub functions with full JSDoc and a passing unit test file.
2. Create the web route group and API namespace with a single `GET /api/ems/health` returning `{ enabled: boolean }` from the feature flag.
3. Add the `EMS` navigation entry (web and mobile), rendered only when `ems_module` is enabled for the tenant.
4. Add an `ems_audit_log` migration only if no reusable audit log exists.
5. Add seed script `scripts/seed-ems-demo.ts` that creates the fictional tenant `Northfield Forge & Finish` with the flag enabled and no other data.
6. Add `docs/ems/README.md` linking this plan, the repo map, and the ADR folder `docs/ems/adr/`.

**Acceptance:** CI green; LOTO test suite unchanged and passing; flag off shows no EMS navigation or routes (404); flag on shows an empty EMS landing page; repo map answers all nine discovery questions with file paths.

## Phase 1: registers and compliance evaluation

Phase 1 delivers the three records an auditor asks for first: the aspects and impacts register, the compliance obligations register, and a documented, scheduled evaluation of compliance. It also delivers the context, scope, and policy records because they are small and the dashboard needs them. Branch: `feat/ems-phase1-registers`.

**Migrations:** `ems_context_issue`, `ems_interested_party`, `ems_scope`, `ems_policy`, `ems_scoring_method`, `ems_aspect`, `ems_aspect_score`, `ems_obligation`, `ems_aspect_obligation`, `ems_compliance_eval`, `ems_evidence` (if no reusable evidence model). Print all migrations and wait for approval.

**Domain logic (`packages/ems-domain`):**

1. `scoreAspect(severity, likelihood, method)`: score = severity × likelihood by default; the method record may override with a lookup matrix; `significant` when score ≥ `significance_threshold`.
2. `aspectCompleteness(aspect, scores)`: returns which operating conditions are missing scores.
3. `registerHealth(rows, today)`: red when no active rows; amber when any `next_review_due` < today; green otherwise.
4. `policyIsComplete(policy)`: all three commitment flags true and a signatory and date present.

**API (match repo convention):**

1. CRUD for each entity, tenant-scoped, with list endpoints supporting filter by status, process area, significance, and review-due.
2. `POST /ems/aspects/:id/scores` requires `operating_condition`, `severity`, `likelihood`, `rationale`; computes and stores score and significance server-side; never trusts a client-supplied score.
3. `POST /ems/aspects/:id/obsolete` requires a reason; sets status, `obsolete_at`, and keeps history.
4. `POST /ems/obligations/:id/evaluate` creates a compliance evaluation with result, notes, and evidence ids; a `noncompliant` result auto-creates a CAPA stub (Phase 6 completes the workflow; in Phase 1 store `capa_id` as null and write a TODO issue).
5. `GET /ems/registers/health` returns health for context, aspects, obligations, scope, policy in one call.

**Scheduled job:** `ems.scheduleComplianceEvaluations` runs nightly; for each obligation with `review_cadence_days`, if no evaluation exists in the window, create a task assigned to `owner_id` with a due date. Reuse the repo's task and notification models.

**Web UI:**

1. `/ems/aspects`: table with columns name, process area, condition coverage chips (N/A/E), highest score, significant badge, last reviewed, next due; filters; row drawer with scoring history and linked obligations; bulk CSV import with a downloadable template.
2. `/ems/obligations`: table with source kind, citation, jurisdiction, owner, last evaluation result, next evaluation due; row drawer with linked aspects, linked permits (Phase 2), evaluation history, evidence.
3. `/ems/context`: three tabs: issues, interested parties, scope and policy. Policy form shows the three commitment checkboxes and refuses save when any is unchecked, with a one-sentence explanation of Clause 5.2.
4. Every table shows a health strip (green/amber/red) at the top using `registerHealth`.

**Mobile:** read-only aspect lookup by process area, so a supervisor can answer "what are the significant aspects of this area" during a walk.

**Tests:** unit tests for all domain functions including threshold edges; API tests for tenant isolation (tenant B cannot read tenant A's aspects); e2e: create an aspect, score it under normal and emergency, mark an obligation evaluated, see register health change.

**Acceptance:** an auditor can open `/ems` and, within three clicks, see a dated aspects register with condition coverage, a dated obligations register, and the last evaluation result per obligation with evidence.

## Phase 2: permit vault and ownership-change workflow

Phase 2 makes every permit, registration, and plan a tracked record with a holder of record, an expiry countdown, and conditions turned into recurring tasks, and it introduces the MOC entity so an ownership or name change can drive a transfer checklist. Branch: `feat/ems-phase2-permits`.

**Migrations:** `ems_permit`, `ems_permit_condition`, `ems_moc`, `ems_moc_impact`. Add `permit_id` nullable FK on `ems_obligation`.

**Domain logic:**

1. `permitEscalation(expiresAt, today)`: returns the active escalation tier (none, 180, 90, 30, expired) and the next tier date.
2. `ownershipChangeChecklist(permits)`: returns one checklist item per permit with steps `notify agency`, `submit transfer or update`, `confirm holder of record updated`, each needing evidence.
3. `mocFanOut(moc, links)`: returns the list of impact rows to create by `kind`: `ownership_name` touches every permit and the scope record; `equipment` touches aspects in the named process area and SPCC-relevant assets; `chemical` touches aspects, obligations tagged air or waste, and the chemical inventory (Phase 5); `process` touches aspects in the process area.

**API:**

1. CRUD for permits with document upload (reuse document model) and conditions.
2. `POST /ems/permits/:id/conditions/:cid/materialize` creates a recurring task from a condition's cadence.
3. `POST /ems/moc` creates the MOC and calls `mocFanOut`; `POST /ems/moc/:id/impacts/:iid/resolve` records resolution with evidence; MOC closes only when all impacts are resolved.
4. `GET /ems/permits/expiring?days=180` for the dashboard.

**Scheduled job:** extend the nightly job: for each permit crossing an escalation tier, create or bump a renewal task and notify the owner; `business_critical` permits also notify the site lead role.

**Web UI:**

1. `/ems/permits`: cards grouped by program; each card shows holder of record, agency, number, expiry with countdown badge, business-critical flag, condition count, document link. A holder of record that does not match the scope's legal entity shows a red "holder mismatch" badge.
2. `/ems/permits/:id`: detail with conditions table (text, cadence, owner, last done, next due), linked obligations, documents, history.
3. `/ems/moc`: list and detail; detail shows impact rows as a checklist with evidence upload per row and a progress bar; an `ownership_name` MOC renders the per-permit transfer checklist.

**Tests:** escalation tiers at boundaries; holder mismatch detection; MOC fan-out creates the expected impacts for each kind; closing an MOC with unresolved impacts is refused.

**Acceptance:** creating an `ownership_name` MOC on the demo tenant produces one transfer checklist item per permit; a permit expiring in 29 days shows the 30-day badge and has a renewal task assigned.

## Phase 3: objectives tracker and management of change

Phase 3 closes the most common Clause 6 finding (no measurable objectives) and finishes the MOC flow started in Phase 2 so that equipment, chemical, and process changes keep the registers current. Branch: `feat/ems-phase3-objectives-moc`.

**Migrations:** `ems_objective`, `ems_objective_progress`. Add `review_required` and `review_reason` on `ems_aspect` if not already present.

**Domain logic:**

1. `objectiveStatus(objective, progress, today)`: `on_track | at_risk | overdue | achieved | abandoned` using linear expected progress between baseline date and due date; `at_risk` when actual is more than 20 percent behind expected.
2. `objectivesHealth(objectives)`: red when zero active objectives; amber when any overdue or at risk.
3. `mocFanOut` (from Phase 2) is completed for `equipment`, `chemical`, and `process` kinds; each impact row carries a suggested action (`rescore aspect`, `add new aspect`, `review obligation applicability`, `update SPCC inventory`).

**API:**

1. CRUD for objectives; `POST /ems/objectives/:id/progress` with value, note, optional evidence.
2. `GET /ems/objectives/health` for the dashboard.
3. `POST /ems/aspects/:id/rescore` accepts a new score row and clears `review_required`; records the triggering MOC or incident id in `rationale`.
4. `GET /ems/aspects?review_required=true` for the coordinator's work queue.

**Web UI:**

1. `/ems/objectives`: cards with metric, baseline, target, current value, owner, due date, status chip, sparkline of progress; empty state explains Clause 6.2 in two sentences and offers a "create from an improvement project" shortcut that pre-fills from an MOC or CAPA.
2. `/ems/objectives/:id`: progress log, linked aspects, linked project reference, evidence.
3. `/ems/moc/:id` (extend): suggested-action buttons on each impact row open the right form in a drawer (rescore aspect, new aspect, obligation review) and resolve the row on save.
4. `/ems/aspects` (extend): "review required" filter and a banner with count when any exist.

**Mobile:** none beyond Phase 1 lookup.

**Tests:** status computation at boundaries; health rules; fan-out for each MOC kind; rescore clears `review_required` and keeps history.

**Acceptance:** opening an `equipment` MOC naming a process area marks every active aspect in that area `review_required`; rescoring each one from the MOC detail resolves its impact row; the dashboard objectives tile turns red when the last active objective is closed.

## Phase 4: environmental field rounds on assets

Phase 4 is where the module earns its keep: weekly waste-area checks, quarterly stormwater visuals, monthly SPCC containment inspections, and ad-hoc outfall or booth checks run on the mobile app, offline, against QR-tagged assets, using the inspection and photo machinery LOTO already has. Branch: `feat/ems-phase4-rounds`.

**Migrations:** `ems_asset_env_profile`, `ems_inspection_template`, `ems_inspection`. If the existing inspection model can carry a template id and JSON items, extend it instead and record the decision in an ADR.

**Inspection templates (seed as system templates, editable per tenant):**

1. `SAA weekly`: container closed, labeled with words "Hazardous Waste" and hazard indication, start date visible, under operator control, no leaks, volume under 55 gal (or 1 qt acute), aisle clear, spill kit present.
2. `CAA weekly`: accumulation start dates within limit for generator status, containers closed and labeled, aisle space, inspection log signed, emergency equipment present, contingency contact posted.
3. `Stormwater quarterly visual`: per outfall: flow present, color, odor, sheen, floatables, suspended solids, foam; photo required; BMP condition; housekeeping of yard storage, scrap bins, dumpsters.
4. `SPCC monthly`: per tank or containment: tank condition, containment integrity, drainage valve closed, accumulated water, oil staining, leak detection, spill kit; photo required for any fail.
5. `Paint booth / coating area`: filters in place and dated, VOC/HAP usage log current, solvent containers closed, rags in closed containers.
6. `Universal waste / used oil`: labeled, dated, closed, within one year.

**Domain logic:**

1. `nextDue(template, lastInspection)` and `missedRounds(template, inspections, today)` returning the count of missed intervals.
2. `inspectionResult(items)`: any required item failed → `fail`; a fail on a template flagged `opens_capa` creates a CAPA stub.
3. `containmentCapacityOk(tank, containment)`: containment ≥ largest tank volume plus freeboard (store the freeboard rule as a tenant setting; default 110 percent).

**API:**

1. `POST /ems/assets/:id/env-profile` to classify an existing asset as an environmental asset type.
2. `GET /ems/rounds/due?assignee=me` returns due and overdue inspections grouped by route.
3. `POST /ems/inspections` accepts a completed inspection with items, photos (evidence ids), `offline_captured`, and client timestamp; idempotent on a client-generated id so offline retries never duplicate.
4. `GET /ems/assets/:id/inspections` history.

**Mobile (Expo, offline-first; mirror LOTO field capture exactly):**

1. `Rounds` screen: today's due list, grouped by area; tap to start; scan QR to jump to the asset.
2. `Inspection` screen: template items as pass/fail/na with a note and photo per item; required-photo enforcement; signature at the end; saves locally first, queues sync, shows "waiting for signal" state identical to LOTO.
3. `Asset` screen (extend): environmental profile section with last inspection, next due, open CAPAs.
4. Conflict rule: field-level last-writer-wins on `items` keyed by item id with timestamps; never replace the whole inspection.

**Web UI:**

1. `/ems/rounds`: calendar and list of scheduled rounds, missed-round badges, assignment; template editor per tenant.
2. `/ems/assets`: environmental asset list with type, last inspection, next due, open CAPAs; bulk classify existing assets by type.
3. Inspection detail with photos, items, signature, and a "open CAPA" button.

**Scheduled job:** extend nightly job: compute missed rounds per template and asset; create tasks for the area owner; feed the dashboard.

**Tests:** due and missed computation across month boundaries; idempotent offline submit; tenant isolation on asset profiles; e2e on mobile: complete an SAA inspection offline, reconnect, verify one record with photos on the web.

**Acceptance:** a user can classify three assets (an SAA drum, an outfall, a tank), run all three templates on a phone in airplane mode, reconnect, and see the results, photos, and next-due dates on the web; a skipped week shows as a missed round the next morning.

## Phase 5: waste tracker and chemical inventory

Phase 5 adds the RCRA records that are most often reconciled wrong (generator status, accumulation time, manifest returns) and a single chemical inventory that serves HazCom, Tier II, and TRI screening. Branch: `feat/ems-phase5-waste-chemicals`.

**Migrations:** `ems_waste_stream`, `ems_waste_container`, `ems_waste_generation_log`, `ems_manifest`, `ems_chemical`.

**Domain logic (all with explicit threshold constants and citations in JSDoc):**

1. `generatorStatus(monthLog)`: VSQG ≤ 100 kg hazardous and ≤ 1 kg acute; SQG > 100 kg and < 1,000 kg; LQG ≥ 1,000 kg or > 1 kg acute (40 CFR 262.13). Return the status and the month that set it.
2. `episodicWarning(log)`: flag any month whose status exceeds the site's registered status.
3. `accumulationDeadline(container, status)`: SAA: no clock until 55 gal (1 qt acute) is reached, then 3 days to move; CAA: 90 days for LQG; 180 days for SQG (270 when the TSDF is over 200 miles).
4. `manifestExceptionDates(shippedAt, status)`: LQG: contact transporter/TSDF at 35 days, exception report at 45 days; SQG: exception report at 60 days (40 CFR 262.42).
5. `tierIIThreshold(chemical)`: general threshold 10,000 lb; EHS: the lesser of 500 lb or the threshold planning quantity (store TPQ on the chemical row; the EHS list itself is reference data, loaded from a CSV the tenant maintains).
6. `triScreen(chemical, usage)`: flags when the chemical's TRI category is set and usage exceeds the stored reporting threshold (25,000 lb manufactured/processed or 10,000 lb otherwise used; PBT thresholds stored per chemical).

**API:**

1. CRUD for waste streams (with profile document), containers (linked to assets), generation log (monthly), manifests (with document), chemicals (with SDS document).
2. `GET /ems/waste/status` returns current and 12-month generator status with the determining month.
3. `GET /ems/waste/containers/clocks` returns every open container with days remaining.
4. `GET /ems/manifests/open` returns unreturned manifests with their exception dates.
5. `GET /ems/chemicals/tier2` returns the chemicals over threshold for the current year with location and max quantity.

**Web UI:**

1. `/ems/waste`: status tile with 12-month bar of monthly generation and the registered status line; containers table with clock badges (green/amber/red); manifests table with return-copy status; waste stream list with profiles.
2. `/ems/chemicals`: inventory table with SDS link, max on-site quantity, EHS flag, Tier II over-threshold badge, TRI flag; CSV import and export in a Tier II-ready column layout.
3. Cross-link: a chemical with a TRI flag shows the aspects it relates to; a waste stream shows the containers and the last three manifests.

**Mobile:** container start-accumulation capture by QR scan (sets `start_accumulation_at`, requires the label photo); manifest photo capture at pickup.

**Tests:** every threshold edge in the domain functions with the citation in the test name; manifest dates across leap years; Tier II export column order; tenant isolation.

**Acceptance:** entering twelve months of generation data shows the correct status and the determining month; a container started 88 days ago on an LQG site shows a red clock; a manifest shipped 36 days ago on an LQG site shows a "contact transporter" alert; a chemical at 12,000 lb shows the Tier II badge.

## Phase 6: CAPA, internal audit, management review

Phase 6 turns every failure source (inspection fail, noncompliant evaluation, internal audit finding, agency action, incident) into one corrective-action workflow with root cause and effectiveness verification, and it generates the Clause 9.3 management review pack from live data. Branch: `feat/ems-phase6-capa-review`.

**Migrations:** `ems_capa`, `ems_internal_audit`, `ems_internal_audit_finding` (id, audit\_id, clause, requirement, evidence, statement, severity(major|minor|observation|opportunity), capa\_id), `ems_mgmt_review`, `ems_training_requirement`, `ems_training_record`, `ems_drill`. Replace the Phase 1 and Phase 4 CAPA stubs with real rows.

**Domain logic:**

1. `capaCanClose(capa)`: requires root cause and method, at least one completed action, `verified_at` and `verified_by`, and an effectiveness check with result `effective`; otherwise return the list of missing items.
2. `findingTemplate()`: enforces the Requirement → Evidence → Statement structure; `statement` must not be empty and the UI shows a hint to state facts, not legal conclusions.
3. `mgmtReviewInputs(tenant, site, period)`: assembles the Clause 9.3 inputs: status of previous actions; changes in issues, interested parties, obligations, significant aspects, risks (from MOC and register history); objectives progress; monitoring results; compliance evaluation results; audit results; CAPA status; resource adequacy (free text); communications from interested parties (free text); opportunities (free text).
4. `trainingStatus(requirements, records, users)`: current, expiring in 30 days, expired, missing per user per role.

**API:**

1. CRUD for CAPA with state machine `open → root_cause → actions → verification → effectiveness → closed`; transitions validated server-side.
2. `POST /ems/capa/from/:source_kind/:source_id` used by inspections, evaluations, findings, and incidents.
3. Internal audit: create audit, add findings with the template, link each finding to a CAPA, upload report.
4. `POST /ems/mgmt-review/generate?period=...` returns the inputs snapshot; `POST /ems/mgmt-review` saves the meeting with decisions and actions (each action creates a task or CAPA).
5. Training requirements and records CRUD; `GET /ems/training/matrix` returns the status grid.
6. Drills CRUD; overdue drill detection by scenario cadence.

**Web UI:**

1. `/ems/capa`: kanban by state with age, owner, source badge; detail drawer with the required sections in order, a 5-Whys / fishbone helper (free-form, stored as `root_cause_method`), action list, verification, effectiveness check with evidence.
2. `/ems/audits`: audit list and detail; findings table using the Requirement / Evidence / Statement columns; one-click CAPA creation per finding; export findings to CSV and PDF.
3. `/ems/management-review`: generate pack for a period; review each input section; record decisions and actions; save; print to PDF.
4. `/ems/training`: matrix by role with status colors; evidence upload; requirement editor with citation.
5. `/ems/drills`: scenario list with cadence and last held; drill record with lessons and CAPA link.

**Tests:** state machine refuses illegal transitions; `capaCanClose` lists each missing item; management review inputs include every Clause 9.3 category; training status at expiry boundaries.

**Acceptance:** a failed SPCC inspection creates a CAPA that cannot close until root cause, verification, and an effective effectiveness check are recorded; generating a management review pack for the demo tenant shows every input section populated or explicitly marked "no data in period".

## Phase 7: environmental dashboard and reports

Phase 7 gives the site environmental lead one screen that answers "what is late, what is missing, what expires, what is open" and gives an auditor a one-click evidence pack. Branch: `feat/ems-phase7-dashboard`.

**No new migrations.** Read-model queries only; add database views or cached aggregates if the repo already uses that pattern.

**Dashboard `/ems` (tiles, each clickable to its list, each with green/amber/red):**

1. Register health: context, scope and policy, aspects, obligations (from `registerHealth`).
2. Objectives: active count, at-risk count, overdue count; red at zero active.
3. Compliance evaluation: evaluations due in 30 days, overdue, last period's noncompliant count.
4. Permits: expiring at 180/90/30, expired, holder mismatches, business-critical renewals.
5. Rounds: due today, missed this month, by template.
6. Waste: generator status with determining month, containers in amber or red, open manifests past 35 days.
7. Chemicals: Tier II over-threshold count, TRI flags, SDS missing.
8. CAPA: open by age bucket (0–30, 31–90, 90+), overdue effectiveness checks.
9. Training: expired and expiring in 30 days.
10. Change: open MOCs, unresolved impact rows, aspects with `review_required`.
11. Emergency: drills overdue.

**Charts (reuse the repo's charting library):** 12-month waste generation bars with the status threshold line; objectives progress lines; CAPA opened vs closed per month; round completion rate per template.

**Reports (server-rendered PDF or the repo's export pattern):**

1. Audit evidence pack: scope and policy, aspects register with scores, obligations register with last evaluation, permit list with holder of record, objectives status, CAPA log, rounds completion summary, training matrix; each section carries the generation timestamp and the tenant's site name.
2. Management review pack (from Phase 6).
3. Waste annual summary: monthly generation, status, manifests, exception reports.
4. Tier II worksheet export in agency column layout.
5. CSV export for every register table.

**Role views:** site environmental lead sees everything; area supervisor sees rounds, CAPAs, and aspects for their area; auditor role is read-only with export; reuse the repo's role system.

**Tests:** each tile's query tested against seeded fixtures for all three colors; report generation snapshot tests; role access tests.

**Acceptance:** with the demo tenant seeded by `scripts/seed-ems-demo.ts --full`, every tile renders with a color, every chart has data, and the audit evidence pack generates in under 10 seconds and opens as a PDF.

## Testing, acceptance criteria, definition of done

A phase is done when its PR passes CI, its acceptance scenario runs end to end on the demo tenant, the LOTO suite still passes, and the flag-off path is unchanged. The checklist below is copied into every phase PR description.

**Definition of done, per phase:**

- [ ] Migrations reviewed and approved before apply; down migrations tested
- [ ] Domain functions in `packages/ms-domain` and `packages/ems-domain` have unit tests covering every threshold edge named in this plan
- [ ] API tests prove tenant isolation (cross-tenant read and write both refused)
- [ ] At least one end-to-end test for the phase's primary flow (web) and, for Phases 4 and 5, one mobile offline flow
- [ ] Feature flag off: no EMS routes, navigation, jobs, or mobile screens; LOTO suite green
- [ ] Feature flag on: phase acceptance scenario passes on the demo tenant
- [ ] ISO 45001 seams present for every shared table created in this phase (`discipline` column and index, generic field names, `ohs` branches that throw `NotImplemented` with a test); no `ohs_` table created
- [ ] No client names, sites, numbers, or people anywhere in the diff (grep the diff for the client's company, site, and prior-owner names, which you keep in a local, git-ignored list; the result must be empty)
- [ ] Audit log entries written for every create, update, and state transition
- [ ] `docs/ems/` updated: repo map, ADRs for any model decision, a one-page user guide for the phase's screens
- [ ] PR description lists new dependencies with rationale, or states "none"
- [ ] Lint, type check, and format pass

**Cross-phase regression suite (run before each PR):** Phase 1 acceptance, Phase 2 ownership-change checklist, Phase 4 offline inspection, Phase 6 CAPA close rules.

**Performance budget:** register list pages render under 500 ms at 2,000 rows; dashboard under 1.5 s with 12 months of data; mobile inspection save under 100 ms locally.

**Security:** every new route behind the existing auth middleware; file uploads validated by type and size using the existing upload path; evidence hashes verified on download.

## ISO 14001 clause to feature traceability

Every clause of ISO 14001:2015 (with Amd 1:2024) maps to at least one feature and one phase, so a certification auditor can be walked through the product clause by clause.

| Clause | Requirement (short) | Feature | Phase |
| --- | --- | --- | --- |
| 4.1 | Internal and external issues, including climate change | Context issues register with climate kind | 1 |
| 4.2 | Interested parties and their needs; which become obligations | Interested parties register linked to obligations | 1 |
| 4.3 | Scope of the EMS | Scope record, versioned, legal entity and boundary | 1 |
| 4.4 | EMS processes and interactions | Module map page listing processes and owners; management review inputs | 1, 6 |
| 5.1 | Leadership and commitment | Management review attendance and decisions; objectives ownership | 6 |
| 5.2 | Environmental policy with three commitments | Policy record with required commitment flags, signatory, version | 1 |
| 5.3 | Roles, responsibilities, authorities | Owner fields on every entity; training matrix by role | 1, 6 |
| 6.1.1 | Risks and opportunities | Context issues with risk/opportunity tag; MOC | 1, 2 |
| 6.1.2 | Aspects under normal, abnormal, emergency conditions; life-cycle; significance | Aspects register with operating-condition scores, lifecycle stage, scoring method | 1 |
| 6.1.3 | Compliance obligations | Obligations register with source, applicability, links | 1 |
| 6.1.4 | Planning action | Objectives, CAPA, MOC impacts | 3, 6 |
| 6.2 | Objectives and planning to achieve them | Objectives tracker with baseline, target, owner, due date, progress | 3 |
| 7.1 | Resources | Management review resource input; objectives project reference | 3, 6 |
| 7.2 | Competence | Training requirements and records by role | 6 |
| 7.3 | Awareness | Mobile aspect lookup by area; policy visible in app | 1 |
| 7.4 | Communication | Interested-party communications log (free text in management review); notification history | 6 |
| 7.5 | Documented information | Versioned records, evidence with hashes, audit log, document links | 0, all |
| 8.1 | Operational planning and control; life-cycle; outsourced processes | Inspection templates, permit conditions as tasks, chemical approval via MOC | 2, 4, 5 |
| 8.2 | Emergency preparedness and response | Drill log with scenario cadence; spill response items on rounds | 4, 6 |
| 9.1.1 | Monitoring, measurement, analysis, evaluation | Rounds, waste log, charts, dashboard | 4, 5, 7 |
| 9.1.2 | Evaluation of compliance | Scheduled evaluations with dated results and evidence | 1 |
| 9.2 | Internal audit | Internal audit records with Requirement / Evidence / Statement findings | 6 |
| 9.3 | Management review | Generated inputs pack, decisions, actions | 6 |
| 10.1 | General improvement | Objectives, CAPA | 3, 6 |
| 10.2 | Nonconformity and corrective action | CAPA with root cause, verification, effectiveness | 6 |
| 10.3 | Continual improvement | Objectives trend, CAPA trend charts | 7 |

**Federal rule coverage (United States):** 40 CFR 262 (generator status, accumulation, manifests) in Phase 5; 40 CFR 112 (SPCC inspections, containment) in Phase 4; 40 CFR 122.26 (stormwater visual inspections) in Phase 4; 40 CFR 370 and 372 (Tier II, TRI screening) in Phase 5; 40 CFR 63 aerospace and area-source coating rules (usage logs, filter checks) in Phase 4 templates and Phase 1 obligations; 29 CFR 1910.1200 (chemical inventory, SDS) in Phase 5. State and local rules are entered as obligations with `jurisdiction` set, not hard-coded.

## Copy-paste prompts for Claude Code

First, export this document as Markdown and save it in the repo as `docs/ems/EMS_IMPLEMENTATION_PLAN.md` on a branch `feat/ems-plan`; commit it. Every prompt below tells Claude Code to read that file, so the plan travels with the code. Then paste the master prompt once per new session, followed by the phase prompt you are working on.

**Master prompt (paste first in every session):**

```markdown
You are working in the Soteria FIELD monorepo (DevJ1975/lotoviewer). For this work you are two people in one: a Lead ISO 14001 auditor with 30 years in aerospace and defense manufacturing, and a senior full-stack SaaS engineer who owns this codebase. The auditor decides what the system must record and prove; the engineer decides how it fits this repo. When they disagree, say so and propose a resolution before coding.

Before anything else:
1. Read docs/ems/EMS_IMPLEMENTATION_PLAN.md in full. It is the contract. Quote section names when you reference it.
2. Read CLAUDE.md, README.md, and docs/ems/00-repo-map.md if they exist. Read manufacturing-readiness-backlog.md if it exists and note any item that overlaps the EMS work.
3. Restate the Guardrails section back to me in your own words, in ten lines or fewer, and confirm you will follow them. In particular: no client data anywhere, feature flag ems_module default off, reuse the asset and inspection models, migrations printed and approved before apply, tests before PR.
4. Restate the naming rule from the "ISO 45001 extension" section: shared management-system tables use the ms_ prefix and carry a discipline column; environmental-only tables use ems_; the ohs_ tables are placeholders and must not be created before Phase 8. The Architecture code block is the source of truth for table names; where a phase section still says ems_<shared>, create ms_<shared>.

Working agreement for every phase:
- Work on the branch named in the phase section. Never commit to main.
- Start in plan mode: produce (a) the list of files you will create or change, (b) the migrations as SQL or ORM schema diffs, (c) the domain function signatures with JSDoc, (d) open questions where the repo differs from the plan. Stop and wait for me to reply "go" before writing application code.
- Implement in small commits with conventional-commit messages prefixed ems(phaseN):. Run lint, type check, and the full test suite before each commit.
- Build the ISO 45001 seams listed in the "ISO 45001 extension" section as part of the phase that creates each shared table (discipline column, policy commitments JSON, generic asset_profile_type, finding standard enum, tiles registry, reserved folders and the ohsms_module flag). Do not build any OH&S feature.
- When the phase's acceptance scenario passes on the demo tenant (scripts/seed-ems-demo.ts), open a PR whose description contains the Definition of done checklist from the plan with each box honestly ticked or left open with a reason.
- If you hit something the plan does not cover, write an ADR in docs/ems/adr/ (context, options, decision, consequences) and ask before proceeding.
- Keep docs/ems/00-repo-map.md current whenever you learn something new about the repo.
- Never invent regulatory thresholds. Use the ones stated in the plan and cite the CFR section in JSDoc and test names. If you believe a threshold is wrong, flag it; do not silently change it.
- Use plain language in UI copy and the standard's own terms (aspect, impact, compliance obligation, operating condition), with a one-sentence tooltip definition for each.

Acknowledge, then wait for the phase prompt.
```

**Phase 0 prompt:**

```markdown
Phase 0. Read the "Phase 0", "Architecture and data model", and "ISO 45001 extension" sections of docs/ems/EMS_IMPLEMENTATION_PLAN.md. Create branch feat/ems-phase0-scaffold. Answer all nine discovery questions with file paths and one code example each, and write them to docs/ems/00-repo-map.md. Then propose the scaffold as a file list: packages/ms-domain (shared core: Discipline type, registerHealth stub), packages/ems-domain, packages/ohs-domain (stub exporting Discipline and NotImplemented only), the (ms), (ems), and (ohs) route groups, the API namespace, feature flags ems_module and ohsms_module, the tiles registry, the seed script, docs/ems and docs/ohs folders. Stop for "go". After go: build the scaffold, prove the flag-off path is unchanged by running the LOTO suite, and open the PR.
```

**Phase 1 prompt:**

```markdown
Phase 1. Read the "Phase 1" section and the Lessons table rows L1 to L7 in docs/ems/EMS_IMPLEMENTATION_PLAN.md. Branch feat/ems-phase1-registers. Plan mode first: migrations for the eleven Phase 1 tables (or fewer if existing models are reused; say which), domain function signatures for scoreAspect, aspectCompleteness, registerHealth, policyIsComplete with threshold tests listed, API routes matching the convention in the repo map, the three web pages, the mobile read-only lookup, and the nightly compliance-evaluation job. Stop for "go". After go: implement, seed the demo tenant with 25 aspects across 5 process areas (fictional site, invented values), 15 obligations, and 6 evaluations; run the acceptance scenario; open the PR.
```

**Phase 2 prompt:**

```markdown
Phase 2. Read the "Phase 2" section and Lessons L8 and L9. Branch feat/ems-phase2-permits. Plan mode: ems_permit, ems_permit_condition, ems_moc, ems_moc_impact migrations; permitEscalation, ownershipChangeChecklist, mocFanOut signatures and tests; routes; permit cards and detail pages; MOC list and detail; nightly escalation extension. Stop for "go". After go: implement; seed 8 permits across air, waste, wastewater, stormwater, SPCC, and EPCRA with one holder mismatch and one permit expiring in 29 days; run the acceptance scenario (ownership_name MOC produces one transfer checklist item per permit); open the PR.
```

**Phase 3 prompt:**

```markdown
Phase 3. Read the "Phase 3" section and Lessons L4, L5, L18. Branch feat/ems-phase3-objectives-moc. Plan mode: ems_objective and ems_objective_progress migrations; objectiveStatus and objectivesHealth with boundary tests; complete mocFanOut for equipment, chemical, and process kinds with suggested actions; rescore endpoint that clears review_required; objectives pages; MOC impact drawers; review-required filter and banner. Stop for "go". After go: implement; seed 3 objectives (one on track, one at risk, one achieved); run the acceptance scenario; open the PR.
```

**Phase 4 prompt:**

```markdown
Phase 4. Read the "Phase 4" section, Lesson L10, and the mobile offline notes in docs/ems/00-repo-map.md. Branch feat/ems-phase4-rounds. Plan mode: decide whether to extend the existing inspection model or add ems_inspection (write the ADR either way); migrations; the six system inspection templates as seed data; nextDue, missedRounds, inspectionResult, containmentCapacityOk with tests; routes including the idempotent offline submit; Expo Rounds and Inspection screens mirroring LOTO field capture; web rounds calendar, asset list, and inspection detail; nightly missed-round job. Stop for "go". After go: implement; seed 3 environmental assets; run the acceptance scenario in airplane mode on a simulator; open the PR.
```

**Phase 5 prompt:**

```markdown
Phase 5. Read the "Phase 5" section and Lessons L11, L12, L13. Branch feat/ems-phase5-waste-chemicals. Plan mode: five migrations; generatorStatus, episodicWarning, accumulationDeadline, manifestExceptionDates, tierIIThreshold, triScreen with every threshold edge as a named test citing the CFR section; routes; waste and chemicals pages; mobile container start and manifest photo capture; Tier II-layout CSV export. Stop for "go". After go: implement; seed 12 months of generation data that crosses from SQG to LQG in month 9, 6 containers, 4 manifests (one past 35 days), 20 chemicals (two over Tier II threshold, one TRI-flagged); run the acceptance scenario; open the PR.
```

**Phase 6 prompt:**

```markdown
Phase 6. Read the "Phase 6" section and Lessons L14, L15, L16, L17. Branch feat/ems-phase6-capa-review. Plan mode: migrations for CAPA, internal audit and findings, management review, training, drills; the CAPA state machine with transition tests; capaCanClose, findingTemplate, mgmtReviewInputs, trainingStatus; routes including POST /ems/capa/from/:source_kind/:source_id and replacement of the Phase 1 and Phase 4 stubs; the five web pages. Stop for "go". After go: implement; seed 10 CAPAs across all sources and states, one internal audit with 6 findings, one management review, a training matrix for 4 roles, 3 drill scenarios; run the acceptance scenario; open the PR.
```

**Phase 7 prompt:**

```markdown
Phase 7. Read the "Phase 7" section. Branch feat/ems-phase7-dashboard. Plan mode: the eleven dashboard tiles with their queries and color rules, the four charts using the repo's charting library, the five reports using the repo's export pattern, the three role views, and the --full flag for scripts/seed-ems-demo.ts. Stop for "go". After go: implement; run the acceptance scenario (every tile colored, every chart populated, evidence pack under 10 seconds); open the PR. Then write docs/ems/USER_GUIDE.md: one page per screen, written for a site environmental lead, no jargon beyond the standard's terms.
```

**Resume prompt (when a session is cut off mid-phase):**

```markdown
Resume. Read docs/ems/EMS_IMPLEMENTATION_PLAN.md and docs/ems/00-repo-map.md. Run git status and git log --oneline -20 on the current branch. Tell me which phase we are in, what is done, what is uncommitted, and what the next three steps are according to the phase section. Then continue from the first unfinished step, in plan mode if any migration or model decision remains.
```

**Verification prompt (run before merging any phase):**

```markdown
Verify. Act as the Lead ISO 14001 auditor only. Walk the demo tenant with the feature flag on and, for the phase just completed, answer: which clause requirements can I now evidence from the product, which cannot, and what is the one gap you would raise as a finding. Then act as the engineer: run the Definition of done checklist from the plan against the branch, run the client-name grep, and report each item as pass or fail with the command or file that proves it. Do not change code during verification.
```
