# Phase 1 ISO 14001 gap assessment

- **Assessed:** 2026-10-02, by a lead-auditor review of the Phase 1 functions.
- **Baseline:** `feat/ems-phase1-registers` at `62fb730` (PR #314). File and line references below are to that commit.
- **Standard:** ISO 14001:2015 with Amendment 1:2024.
- **Question asked:** could a customer using only these functions satisfy the standard, and would the evidence the product generates hold up in a Stage 2 audit?

The findings below are as delivered. [Where each one stands](#status) records what has been done since.

## Verdict

Phase 1 is a strong core. Clauses 4.1–4.3, 5.2, 6.1.2, 6.1.3 and 9.1.2 are well supported. Evaluation of compliance is the best-implemented clause the review has seen in EMS software, because the database refuses to seal an unsupported result.

One problem had to be fixed before the report card could be sold as audit-readiness: in five clauses, it could mislead an auditor.

## Positive practices

- **9.1.2 is enforced by the database, not by convention.**
  - A compliant or noncompliant result can't be sealed without evidence.
  - The time and evaluator are stamped by the server, and a sealed result can't be edited.
  - A noncompliant result opens a nonconformity tied to its own obligation (10.2).
- **Evidence integrity:**
  - files are stored with a SHA-256 hash and re-checked on every download;
  - they are never deleted, only superseded with a reason.
- **6.1.2 aspects:**
  - each aspect is scored per operating condition (normal, abnormal, emergency), with a rationale;
  - scores are append-only, under a frozen method;
  - a life-cycle stage is recorded, and gaps in condition coverage are visible.
- **Amendment 1:2024:** the climate-change determination is required and turns the light amber until it's recorded.
- **5.2 policy:** it can't be saved without all three commitments, and it's flagged when the legal entity changes after signing. That flag catches the common ownership-change finding.
- **Register health:**
  - every register carries review dates;
  - "undetermined" results don't count as evaluations;
  - unscheduled obligations and missed deadlines turn the light amber.

## Major gaps

### MJ-1: The report card graded five clauses from evidence an auditor would reject

- **Requirement:** 7.2 asks for competence of people whose work affects environmental performance. 7.3 asks for awareness of the policy and significant aspects. 7.4 covers internal and external communication. 8.1 asks for controls over significant aspects and compliance obligations. 8.2 covers emergency preparedness.
- **Evidence:** in `apps/web/lib/iso14001Signals.ts`:
  - line 233: 7.2 counted *any* LOTO training record;
  - line 246: 7.3 counted *any* toolbox talk;
  - line 247: 7.4 counted only California Prop 65 notifications;
  - line 249: 8.1 counted *any* inspection;
  - line 254: 8.2 was hard-coded to "never drilled".
- **Gap:** clauses 7.2, 7.3 and 8.1 could show "conforming" on safety-only records, which is false assurance. Clauses 7.4 and 8.2 showed gaps that may not exist: a Texas site could never pass 7.4.
- **Fix recommended:** until environmental sources exist, grade these "not assessed" with the reason. Or tag the sources: an environmental flag on training courses, toolbox-talk topics and inspection templates.

### MJ-2: Customers can't retrieve their own audit trail (7.5.3)

- **Requirement:** documented information must be protected from loss of integrity, and must be retrievable.
- **Evidence:** `log_audit()` never writes `tenant_id` (`003_auth_profiles_audit.sql`; repo map §12). Every new EMS table relies on it.
- **Gap:** an auditor asking "who changed this obligation's applicability, and when?" gets no answer from the customer's own view. Only aspect scores keep their own history.
- **Fix recommended:** a platform-wide fix, which predates this work but is now load-bearing for the EMS.

## Minor gaps

| # | Clause | Gap | Where it comes from |
| --- | --- | --- | --- |
| mn-1 | 6.1.2 | Nothing records whether an aspect is one the organization can **control** or only **influence**. | `environmental_aspects` has no such attribute |
| mn-2 | 4.3 | Scope lacks "authority and ability to exercise control and influence", and any exclusions. It can't be shared with interested parties. | `ms_scope_statements` columns |
| mn-3 | 5.2 | The policy is visible to app members only. There's no record of communicating it, no acknowledgement, and no export "available to interested parties". | `ms_policies`; no communication record |
| mn-4 | 5.3 / 4.4 | Context issues, interested parties, scope and policy have no owner. The plan's 4.4 process map ("processes and owners") wasn't built. The master plan's traceability table assigned both partly to Phase 1, but the approved Phase 1 plan dropped them. | No owner column in migration 295 |
| mn-5 | 6.1.1 / 6.1.4 | A risk or opportunity tagged on a context issue, or a significant aspect, has no linked action with an owner and due date. The report card grades 6.1.1 from the *safety* risk register. | `effect` is only a label; readiness 6.1.1 reads `risks` |

## Opportunities for improvement

### Already on the roadmap

- **Phase 2:** attach the permit or rule text to each obligation (6.1.3 "access"). Add an export-control flag on evidence: aerospace and defense customers will upload ITAR/EAR-adjacent drawings.
- **Phase 3:**
  - Objective action plans need *resources* and *how results will be evaluated* (6.2.2), not just target, owner and progress.
  - Add a scoring-method editor. Prime contractors often flow down their own significance criteria.
- **Phase 6:** management-review inputs should pull compliance status automatically (9.3 c).
- **Phase 7:** a compliance-status report and an auditor evidence pack.

### Not in the roadmap

1. **Regulatory change monitoring (6.1.3).** An obligation is only re-checked at its annual review. The repo already ingests regulation text (`apps/web/scripts/ingest-regulations.mjs`), which could flag obligations whose cited rule changed.
2. **Communications and complaints log (7.4, 9.3).** The plan's answer is free text in management review. Auditors want regulator correspondence, notices of violation and neighbour complaints logged against interested parties.
3. **Outsourced processes and external providers (8.1).** For aerospace and defense this is the big one: outsourced plating, anodizing, NDT and coatings. Record each provider's environmental requirements, how they were communicated, and periodic evaluations. The plan only covers OH&S contractors, in Phase 10.
4. **Calibration of monitoring equipment (9.1.1).** pH meters for pretreatment, flow meters and stack monitors. It fits the Phase 4 asset model.
5. **Restricted substances.** Cr(VI), cadmium, PFAS, and REACH SVHC substances with Authorisation sunset dates, linked to aspects and obligations. It fits Phase 5 chemicals. *Verify current REACH and PFAS dates before building.*
6. **Records retention.** There's no retention setting. Deleting a tenant cascades evidence rows while the files stay in storage.
7. **Practical evidence limits.** The 4 MB cap will push users to compress permits and scans. Direct-to-storage upload should come early.

## Recommended order

1. **Now**, a small Phase 1.1 PR: MJ-1, plus mn-1 to mn-4.
2. **A separate platform PR:** MJ-2, the audit-trail `tenant_id` fix.
3. **Phases 2–7**, as scoped above, adding the seven unplanned items to the plan.

## Status

As of 2026-10-02.

| Finding | Status |
| --- | --- |
| MJ-1 | **Addressed in PR #315** (`25c2f6c`). Clauses 7.2, 7.3, 7.4, 8.1 and 8.2 read *not assessed*, with the reason, until environmental sources exist. A not-assessed clause is never conforming and never blocking, stays in the coverage denominator, and holds the band at *ready with gaps*. The review of that PR found the same fault in reverse on 7.5 and 9.2: they read as blocking gaps only because their registers are unbuilt, which held every tenant at *not ready*. They now read *not assessed* too until the registers ship, and stay core clauses, so a real gap blocks once they do. |
| MJ-2 | **Open.** Recommended as a separate platform PR; not started. |
| mn-1 | **Addressed in PR #315.** `environmental_aspects.control_level` (migration 302, proposed, not applied), in the form, sheet and CSV import. The report card counts undecided aspects. |
| mn-2 | **Addressed in PR #315.** The scope's control-and-influence statement (required on new versions) and exclusions (migration 302). The scope and policy download together as one PDF for interested parties. |
| mn-3 | **Addressed in PR #315.** Policy communications are recorded, internal or external (migration 302), and the light stays amber until the policy in force has an internal one. The same PDF makes the policy available outside the organization. Individual acknowledgement by each worker is not built. |
| mn-4 | **Addressed in PR #315, with one deviation.** The 4.4 process map and the two 5.3 roles, each with an owner (migration 302), plus a report-card clause 5.3. Owners are held per process, not per context issue or interested party; per-item owners arrive with mn-5's actions. |
| mn-5 | **Planned** for Phases 3 and 6. |
| Opportunities for improvement | The seven unplanned items are not yet added to `EMS_IMPLEMENTATION_PLAN.md`. |
