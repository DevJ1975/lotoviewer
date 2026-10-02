# OH&S (ISO 45001) module: reserved

No OH&S feature is built yet. This folder reserves the place for it, as the
EMS plan asks. The section below is copied verbatim from
[EMS_IMPLEMENTATION_PLAN.md](../ems/EMS_IMPLEMENTATION_PLAN.md). How it was
adapted to this repo is recorded in
[ADR 0001](../ems/adr/0001-build-on-the-existing-environmental-module.md). In short:

- **Domain code:** shared rules live in `packages/core/src/managementSystem.ts`, not `packages/ms-domain`.
  The OH&S seam is `packages/core/src/ohsPlaceholder.ts` (`Discipline`, `NotImplementedError`).
- **Tiles:** dashboard tiles go through `packages/core/src/managementSystemTiles.ts`.
- **Deferred:** the `ohsms_module` flag and the OH&S placeholder page are deferred to Phase 8,
  when there is something to switch on.
- **Start from what exists:** several `ohs_*` placeholders already have partial equivalents
  (`risks`, `jhas`, `risk_controls`, `loto_contractor_companies`, `iso45001_clause_evidence`).
  See [00-repo-map.md](../ems/00-repo-map.md), section 10. Phase 8 should start from those.

OH&S architecture decisions go in [adr/](./adr/).

---

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
