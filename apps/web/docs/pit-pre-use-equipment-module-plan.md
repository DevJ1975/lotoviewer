# PIT And Mobile Equipment Pre-Use Module Plan

## Product Goal

Build a field-first pre-use equipment module for powered industrial trucks, aerial lifts, pallet lifters, and other site mobile equipment. The module should make required checks fast enough for operators to actually use, while giving supervisors measurable leading indicators, repair accountability, STRIKE refresher hooks, photo evidence, QR launch, and audit-ready OSHA support.

Working name: **Equipment Readiness**.

Primary promise: scan the equipment, prove the equipment and operator are ready, record defects with photos, route issues to the right owner, and prevent unsafe equipment from quietly going back into service.

## Regulatory Baseline

This module should be configured as an employer compliance support tool, not as legal advice or an automatic compliance certification.

OSHA PIT baseline:

- Powered industrial trucks must be examined before being placed in service. OSHA requires at least daily examination, and round-the-clock operations need checks after each shift.
- If the examination shows a condition adversely affecting safe operation, the truck must not be placed in service.
- Defects must be reported and corrected.
- Powered industrial trucks not in safe operating condition must be removed from service, with repairs made by authorized personnel.
- Operators must be trained and evaluated before operating PITs. Refresher training is triggered by unsafe operation, incident/near miss, evaluation deficiency, assignment to a different truck type, or changed workplace conditions.
- Operator performance evaluation is required at least once every three years.

Aerial lift baseline:

- Only trained and authorized workers should operate aerial lifts.
- Training should include hazards, correct operation, inspections, manufacturer requirements, and demonstrations of skill/knowledge.
- Before each work shift, conduct a pre-start inspection of the lift and components.
- Defective aerial lifts should be removed from service/tagged out until repaired by a qualified person.
- Work area hazards must be inspected and corrected before and during operation.

Source references:

- OSHA PIT pre-operation eTool: https://www.osha.gov/etools/powered-industrial-trucks/operating-forklift/pre-operation
- OSHA PIT standard 29 CFR 1910.178: https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178
- OSHA sample PIT checklists: https://www.osha.gov/training/library/powered-industrial-trucks/checklist
- NIOSH daily PIT inspection guide covering forklift, narrow-aisle reach truck, walkie pallet lift, and tow tractor/tug: https://www.cdc.gov/niosh/docs/wp-solutions/2022-100/default.html
- OSHA aerial lift eTool: https://www.osha.gov/etools/scaffolding/aerial-lifts

## Equipment Coverage

Start with configurable equipment families rather than one generic inspection.

PIT families:

- Counterbalance sit-down forklift: electric, LPG, gasoline, diesel.
- Stand-up counterbalance.
- Narrow aisle reach truck.
- Order picker.
- Turret truck / very narrow aisle truck.
- Walkie pallet jack / walkie pallet lift.
- Rider pallet jack.
- Tow tractor / tug.
- Rough-terrain forklift.
- Attachments: clamp, rotator, fork extension, side shifter, personnel platform where allowed by site procedure.

Aerial lift families:

- Scissor lift.
- Vertical mast / single-person lift.
- Articulating boom.
- Telescopic boom.
- Bucket truck / vehicle-mounted elevating platform.

Other configurable site equipment:

- Manual pallet lifter where the customer wants condition checks.
- Powered pallet lifter not classified separately from PIT by the tenant.
- Yard hostler or tug if the site wants the same field-readiness workflow.

## Competitor Baseline

Competitors commonly offer:

- QR or barcode asset launch, reducing wrong-asset entries.
- Mobile checklist completion and e-signature.
- Missed inspection reminders.
- Fault alerts and corrective-action/work-order routing.
- Photo capture for defects and walkarounds.
- Dashboards for completed, missed, and flagged inspections.
- Some AI photo review or note/photo mismatch detection.

Observed examples:

- Lumiform positions forklift inspections around QR-triggered digital checklists, signatures, overdue/fault alerts, and a live dashboard: https://lumiformapp.com/app-uses/forklift-inspection-app
- SafetyCulture supports QR/barcode scanning inside inspections to capture asset IDs and readings: https://help.safetyculture.com/en-US/001713/
- Whip Around has missed-inspection and exception reminders: https://help.whiparound.com/en/articles/2880325-reminders-module-overview
- Whip Around AI Inspections Pro reviews uploaded photos, checks for visible defects, and compares notes with images: https://help.whiparound.com/en/articles/12146921-ai-inspections-pro

## Step Better Than Competitors

SoteriaField should not just be "forms with QR codes." The advantage should be an equipment readiness engine connected to training, risk, maintenance, LOTO, incidents, and audit evidence.

Differentiators:

- **Readiness gate, not just inspection log:** before submission, calculate equipment ready/not ready, operator authorized/not authorized, STRIKE current/overdue, and work-area hazards open/controlled.
- **OSHA-triggered refresher logic:** if a user reports an unsafe operation event, defect-related near miss, evaluation gap, new equipment type, or changed work condition, generate a STRIKE refresher assignment and reminder.
- **Equipment status control:** a failed critical item automatically moves equipment to `out_of_service_pending_review`; supervisors can release only after repair evidence and authorized review.
- **Damage timeline:** equipment profile shows current canonical photo, historical damage photos, defect recurrence, repair proof, and "same damage repeatedly reported" detection.
- **Training-aware QR:** scanning a forklift QR can show "complete 3-minute STRIKE refresher before operating" when training is expired or when the user is assigned a new equipment type.
- **Inspection quality scoring:** measure rushed inspections, repeated all-OK submissions, skipped photo angles, and defects closed without repair evidence.
- **Audit bundle in one click:** export equipment inspections, failed items, photos, out-of-service intervals, repairs, training readiness, STRIKE completions, and operator attestations for a date range.
- **Low-friction offline capture:** let operators complete scan-launched checks offline, store timestamp/device/user/equipment context, and sync with conflict handling.
- **AI as a reviewer, not approver:** AI can flag image/answer mismatch, possible leaks/damage, missing equipment in photo, or unreadable hour meter; it cannot certify readiness or return equipment to service.

## Core User Workflows

### 1. QR Pre-Use Inspection

1. Operator scans equipment QR.
2. App resolves tenant, site, equipment ID, equipment family, checklist version, active shift window, and operator identity.
3. App shows readiness header:
   - Equipment status.
   - Last inspection and last defect.
   - Operator authorization for this equipment family.
   - Required STRIKE refresher status.
4. Operator captures required photos:
   - Equipment full view.
   - Identification plate / asset tag where practical.
   - Hour meter / battery meter / odometer where applicable.
   - Any damage, leak, tire/fork/platform issue, or unsafe condition.
5. Operator completes family-specific visual checks with key off.
6. Operator completes operational checks where safe and applicable.
7. Failed critical items require photo, note, severity, and "remove from service" acknowledgement.
8. Submit with signature/attestation.
9. System emits events, updates equipment readiness, creates defect/action, and sends notifications.

### 2. Defect And Removal From Service

- Critical failure immediately marks equipment `out_of_service_pending_review`.
- App shows printable/QR-linked red tag state.
- Supervisor/maintenance gets alert with photos and checklist context.
- Repair workflow captures mechanic notes, parts/labor optional, repair photos, and return-to-service approval.
- Return to service requires a repair completion record plus a passing reinspection or supervisor override with reason.

### 3. STRIKE Refresher From Equipment

- Each equipment family can require STRIKE modules by role, site, equipment type, or hazard.
- QR launch checks whether the worker has a current completion for the exact required module version.
- If expired or missing, show a short "before operating" refresher path.
- Reminders go to the user before expiration and to supervisors when a required operator has overdue training.
- Triggered refreshers:
  - Failed critical inspection item caused by misuse or unsafe condition.
  - Near miss/incident involving equipment.
  - Observed unsafe operation.
  - Operator assigned to a different PIT/lift type.
  - Site/equipment condition changed, such as new attachment, new aisle/ramp, battery charging process, or overhead hazard.
  - Three-year PIT performance evaluation coming due.

### 4. Supervisor Dashboard

Views:

- Today by site/shift: completed, missed, failed, out of service, released.
- Fleet readiness board: equipment available, limited use, out of service, overdue inspection, overdue repair.
- Operator readiness: authorized, expiring, expired, blocked by refresher.
- Defect recurrence: same equipment, same component, repeated failures.
- Inspection quality: median duration, all-OK streaks, missing photo compliance, late submissions.
- Audit/export: date range, site, equipment family, operator, status.

## Checklist Architecture

Use versioned checklist templates with required, critical, conditional, and photo-required rules.

Common PIT visual checks:

- Fluids where applicable: oil, coolant/water, hydraulic fluid, brake fluid.
- Leaks, cracks, visible defects, hydraulic hoses, mast chains.
- Tires/wheels, cuts, gouges, inflation where applicable.
- Forks, heel, retaining pins, backrest, guards.
- Seat belt / restraint, operator compartment, manual, decals/nameplate.
- Horn, lights, backup alarm, safety devices.
- Battery, cables, connectors, electrolyte, battery restraint for electric trucks.
- LPG tank mounting, relief valve orientation, hoses/connectors, dents/cracks/leaks for LPG.
- Engine oil/coolant/air filter/belts/hoses/radiator/hood latch for internal combustion trucks.

Common PIT operational checks:

- Brakes, parking brake, steering.
- Forward/reverse drive control.
- Hoist/lower/tilt/attachment controls.
- Horn, lights, backup alarm.
- Hour meter.
- Unusual noise/vibration.

Aerial lift checks:

- Operating and emergency controls.
- Safety devices and guardrails/gates.
- Personal fall protection anchors and required PPE prompt.
- Tires/wheels, outriggers/stabilizers where applicable.
- Hydraulic, pneumatic, fuel, electrical systems.
- Pins, fasteners, structural damage, platform condition.
- Decals, capacity plate, manual.
- Battery/fuel level and charging/fueling hazards.
- Work-area hazard check: drop-offs, holes, slopes, debris, overhead obstructions, power lines, traffic, weather/wind, floor/load capacity.

Response types:

- Pass / fail / not applicable.
- Numeric readings: hour meter, battery percent, tire pressure, fuel level.
- Photo required.
- Comment required.
- Severity: monitor, repair soon, critical.
- Action: continue, limited use, remove from service.

## Data Model Sketch

New tables:

- `equipment_assets`
  - Extend or map current equipment records to include `equipment_family`, `power_source`, `site_id`, `department_id`, `asset_tag`, `serial_number`, `manufacturer`, `model`, `year`, `capacity`, `attachments`, `status`, `canonical_photo_path`, `qr_token_id`.
- `equipment_checklist_templates`
  - Tenant/global scope, equipment family, version, status, effective dates, OSHA basis notes, created/approved metadata.
- `equipment_checklist_items`
  - Section, prompt, response type, required flag, critical flag, photo rule, conditional logic, sort order.
- `equipment_inspections`
  - Tenant, equipment, checklist version, operator, shift, started/submitted timestamps, duration, location/device metadata, readiness result, signature path/hash, offline sync state.
- `equipment_inspection_responses`
  - Inspection, item, response, numeric value, pass/fail/na, notes, severity, action decision.
- `equipment_evidence`
  - Source record, source table/type, storage path, media kind, caption, component, AI review status, uploaded_by, captured_at.
- `equipment_defects`
  - Equipment, inspection, component, severity, status, out-of-service flag, description, first_seen, last_seen, assigned_to, due_at.
- `equipment_repairs`
  - Defect, repair status, mechanic/authorized person, repair notes, parts/labor optional, repair photos, completed_at, return_to_service_by, return_to_service_at.
- `equipment_operator_authorizations`
  - User, equipment family/type, site, authorization source, trainer/evaluator, issue date, expiration/evaluation due, status.
- `equipment_readiness_checks`
  - Append-only evaluated snapshot tying operator, equipment, inspection, STRIKE requirements, defects, and final readiness state.
- `equipment_missed_inspection_rules`
  - Site/equipment/shift schedule, grace period, escalation recipients.

Reuse/link existing concepts:

- STRIKE tables for module requirements, completions, attempts, recurring assignment cron, and QR launch cards.
- Existing QR token routing migrations as the base for equipment QR routing.
- Existing storage tenant-scoping patterns for equipment photos.
- Existing incident actions/CAPA initially; later adapt to cross-module `safety_actions` when that shared action layer exists.
- Existing audit/event design direction from `competitive-ehs-saas-design-spec.md`.

Storage path convention:

- `equipment-evidence/{tenant_id}/{equipment_id}/inspections/{inspection_id}/{timestamp}-{kind}.jpg`
- `equipment-evidence/{tenant_id}/{equipment_id}/defects/{defect_id}/{timestamp}-{kind}.jpg`
- `equipment-evidence/{tenant_id}/{equipment_id}/repairs/{repair_id}/{timestamp}-{kind}.jpg`

## Measurable Activity And KPIs

Worker/operator metrics:

- Inspections completed by user, site, shift, equipment family.
- Median inspection time by checklist type.
- Late/missed inspection rate.
- Photo-complete rate.
- STRIKE refresher completion before operation.
- Operator readiness rate.

Equipment metrics:

- Fleet readiness percent.
- Equipment out-of-service hours.
- Critical defect count and recurrence.
- Mean time from defect report to supervisor acknowledgement.
- Mean time to repair.
- Return-to-service reinspection pass rate.
- Repeated failure by component.

Safety/compliance metrics:

- Pre-use completion before first use by shift.
- Percent of failed critical inspections resulting in out-of-service state.
- Defects closed with repair evidence.
- Expired/evaluation-due operator authorizations.
- Three-year PIT evaluation due/overdue.
- Aerial lift retraining triggers after incident, new hazard, new lift type, or improper operation.
- Audit bundle completeness score.

Adoption/quality metrics:

- QR scan-to-submit conversion.
- Manual asset selection rate; high values may show missing/damaged QR labels.
- All-pass streaks by operator/equipment.
- Inspections under minimum expected duration.
- AI photo mismatch flags confirmed by supervisors.

## Notifications And Reminders

Operator reminders:

- Assigned equipment inspection due at shift start.
- STRIKE refresher expiring soon or required before operation.
- PIT evaluation due within 60/30/7 days.
- Defect follow-up assigned.

Supervisor reminders:

- Equipment missed inspection after grace period.
- Critical defect submitted.
- Equipment out of service over threshold.
- Repair overdue.
- Operator attempted inspection while unauthorized or refresher overdue.
- Repeated defect pattern.

Maintenance reminders:

- Repair assigned.
- Return-to-service inspection needed.
- Preventive maintenance threshold from hour meter or date interval.

## Permissions And Invariants

Roles:

- Worker/operator: perform assigned/authorized inspections, upload photos, report defects, view own readiness.
- Supervisor: view site fleet, acknowledge defects, assign repairs, approve non-critical continued use if tenant policy allows.
- Maintenance/authorized repair: update repair records, upload repair evidence, mark repair complete.
- Safety manager/admin: configure templates, schedules, STRIKE requirements, authorizations, exports, and audit bundles.
- Superadmin: manage global templates and tenant enablement.

Invariants:

- Tenant ID is required on every record.
- Checklist completions bind to checklist template version.
- STRIKE readiness checks bind to module version completions.
- A critical failed item cannot silently resolve itself.
- Out-of-service equipment cannot be marked ready by a normal operator.
- Repair completion and return-to-service approval are separate events.
- AI flags are advisory and auditable.
- Deleted photos should be soft-deleted or retained according to tenant retention policy, not physically lost from regulated evidence without audit.

## MVP Scope

Phase 1:

- Equipment Readiness feature catalog entry and tenant module flag.
- Equipment QR launch to pre-use form.
- Four templates:
  - Electric sit-down/stand-up forklift.
  - Internal combustion/LPG forklift.
  - Walkie/rider pallet jack/lift.
  - Aerial lift/scissor/boom starter.
- Inspection submission with signature, required photos, offline-ready local state if feasible.
- Critical defect flow with automatic out-of-service state.
- Basic supervisor dashboard: today, missed, failed, out of service.
- STRIKE requirement check and link-out to refresher modules.
- Exportable inspection report.

Phase 2:

- Operator authorization matrix by equipment family.
- STRIKE recurring reminders and OSHA trigger-based refresher assignment.
- Maintenance/repair workflow with return-to-service approval.
- Photo AI review for missing equipment, visible damage/leaks, and answer/photo mismatch.
- Inspection quality scoring.
- Multi-language prompts, at least English/Spanish.

Phase 3:

- Preventive maintenance by hour meter/date.
- Cross-module relationships to JHA, LOTO, incidents, near misses, risk, and safety boards.
- Audit bundle builder.
- Analytics for defect recurrence, fleet downtime cost, and weak control patterns.
- Customer template studio with global OSHA starter templates and tenant-specific variants.

## Implementation Notes For This Repo

- Read `node_modules/next/dist/docs/` before changing Next.js APIs because this repo uses a newer Next version with breaking changes.
- Prefer existing Supabase/RLS and tenant-active-header patterns.
- Use existing QR token routing work from migrations `084`, `086`, `087`, and `106` as the launch pattern.
- Use STRIKE as the training/refresher engine rather than creating a parallel training table.
- Store checklist templates as versioned records, not hard-coded UI arrays.
- Keep the mobile workflow primary; web admin dashboard can be denser.
- Add focused tests for tenant isolation, checklist version binding, critical-fail status transitions, and STRIKE readiness calculation.

## Open Product Decisions

- Should "all PITs" be one module flag, or should aerial lifts be separately licensable/configurable?
- Should supervisor override ever allow limited use after a failed non-critical item, and which roles can configure that?
- Do customers need no-login QR inspection for shared devices, or should all inspections require authenticated operators?
- What is the default evidence retention period by tenant and customer vertical?
- Should QR labels include backup human-readable asset IDs and color-coded equipment family?
- Should this module replace or extend the current LOTO `equipment` concept?
