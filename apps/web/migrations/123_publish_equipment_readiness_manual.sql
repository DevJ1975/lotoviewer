-- Migration 123: publish the Equipment Readiness user manual.
--
-- Replaces the placeholder seed manual with a field-ready guide for PIT,
-- aerial lift, pallet lifter, and mobile-equipment pre-use inspections.
-- The upsert makes this safe for environments where seed_module_manuals.sql
-- has not been run yet.

begin;

insert into public.manuals (module_id, title, summary, body_md, published_at)
values (
  'equipment-readiness',
  'Equipment Readiness',
  'PIT, aerial lift, pallet lifter, and mobile equipment pre-use inspections with QR scans, photo evidence, STRIKE gates, defects, repairs, and reminders.',
  $manual$
## Overview

Equipment Readiness is SoteriaField's pre-use inspection and return-to-service workflow for powered industrial trucks (PIT), aerial lifts, pallet lifters, and other mobile equipment. The module helps operators prove that a unit was checked before use, that required training was current, that visible damage was photographed, and that unsafe findings were removed from service until repair evidence was recorded.

Compliance frame: OSHA requires employers to train and evaluate powered industrial truck operators under **29 CFR 1910.178(l)** and to remove unsafe industrial trucks from service until restored to safe operating condition under **29 CFR 1910.178(p) and 1910.178(q)**. Aerial lift and mobile elevated work platform programs may also involve OSHA construction and general-industry standards such as **29 CFR 1926.453**, **29 CFR 1910.67**, manufacturer instructions, and state/local rules. SoteriaField is an evidence and workflow tool. Your competent or qualified person remains responsible for the site program, equipment-specific checklist, and final return-to-service decision.

## Who Uses It

- **Operators** scan the equipment QR code, complete the pre-use checklist, attach full-view and damage photos, attest to the inspection, and submit before operating.
- **Supervisors** review failed inspections, acknowledge defects, start repair, and return equipment to service only when supporting repair evidence is present.
- **Safety leads** configure checklist templates, equipment families, STRIKE refresher requirements, reminder rules, and audit exports.
- **Maintenance** uses the defects view to triage out-of-service items, document repair notes, and upload repair photos.
- **Trainers** use STRIKE links to require short refresher lessons before higher-risk equipment is used.

## Equipment Covered

The module supports these default equipment families:

- Electric forklifts.
- Internal-combustion or LPG forklifts.
- Reach trucks.
- Order pickers.
- Powered pallet jacks and powered pallet lifters.
- Manual pallet lifters.
- Scissor lifts.
- Boom lifts.
- Tow tractors.
- Rough-terrain forklifts.
- General mobile equipment.

Each family can use a global starter checklist or a tenant-specific checklist. The starter checklists are intentionally conservative and should be reviewed against the manufacturer manual, attachments, operating environment, and your written program.

## Core Concepts

### QR Resolve

Each equipment record can have a QR token. Scanning the QR resolves the exact equipment record in the active tenant and loads the correct checklist, open defects, latest inspection, operator authorization, and STRIKE readiness status.

### Checklist Template

A checklist template defines the inspection questions for an equipment family. Checklist items can be required, critical, and photo-required. A critical failed item removes the equipment from service pending review.

### Evidence

Evidence is stored with the inspection or defect. At minimum, operators should capture a current full-view equipment photo. Damage, hour meter, defect, and repair evidence can also be attached.

### Defect

A failed inspection item creates a defect. Critical defects are marked out-of-service. Defects remain open until a supervisor or authorized maintenance reviewer documents repair and returns the equipment to service.

### STRIKE Gate

STRIKE requirements can block or warn before an operator starts an inspection. For example, a forklift refresher lesson can be required before an electric forklift pre-use check is allowed to proceed.

### Reminder Rule

Reminder rules identify equipment that should have been inspected before a shift or within a grace period. The reminder cron creates alerts for missed inspections without relying on a supervisor to manually audit the list.

## Daily Operator Workflow

1. Open **Equipment Readiness → Scan** or scan the equipment QR label.
2. Confirm the equipment ID, description, department, and equipment family.
3. If STRIKE says training is blocked, complete the linked refresher lesson first.
4. Capture a current full-view photo of the equipment.
5. Enter shift, location, hour meter, odometer, or battery reading where applicable.
6. Complete each checklist item as pass, fail, or not applicable.
7. Add notes for any abnormal condition.
8. Upload a damage photo for any failed or questionable item.
9. Confirm the operator attestation and submit.
10. Do not operate equipment that SoteriaField marks out-of-service or blocked.

Good inspection notes are factual: where the issue is, what was observed, and whether the equipment was removed from service. Avoid vague notes such as "bad" or "looks wrong" when a specific condition can be described.

## What To Photograph

### Required Full-View Photo

Capture the whole piece of equipment in its current condition. The photo should show the unit, identifier when possible, and enough surrounding context to prove the inspection happened in the field.

### Damage Photos

Take close-up photos of damage, leaks, worn forks, missing guards, damaged tires, broken lights, unreadable data plates, cracked platforms, compromised rails, leaking fuel or hydraulic components, exposed wiring, or any condition that supports a failed checklist item.

### Repair Photos

When returning equipment to service, attach evidence that shows the repair or corrected condition. Examples include replaced tire, repaired fork, cleaned leak area after repair, restored guardrail, readable replacement label, or completed maintenance work order photo.

## Inspection Results

### Ready

All required and critical checks pass or are legitimately not applicable. The equipment can be used if the operator is authorized and local site rules allow it.

### Limited Use

One or more non-critical findings require monitoring or repair soon, but the equipment is not automatically blocked. Supervisors should review these findings and decide whether restrictions are needed.

### Out Of Service Pending Review

At least one critical item failed, or the operator selected remove-from-service. The equipment should not be used until an authorized reviewer resolves the defect and returns it to service.

## Defect Review Workflow

1. Open **Equipment Readiness → Defects**.
2. Filter by open, acknowledged, in repair, or out-of-service.
3. Open the defect and review the failed item, operator notes, photos, equipment status, and inspection time.
4. Acknowledge the defect if it needs triage.
5. Start repair when maintenance takes ownership.
6. Add repair notes and repair evidence before returning the equipment to service.
7. Confirm there are no other open out-of-service defects on the same equipment.
8. Return to service only when the equipment is safe and your site procedure allows release.

SoteriaField prevents one defect closure from releasing equipment if another open out-of-service defect still exists on the same unit.

## Supervisor Dashboard Habits

Use the dashboard at the start of each shift:

- Check equipment due or overdue for inspection.
- Review open critical defects before work begins.
- Confirm repair evidence exists before returning units to service.
- Watch for rushed inspections, missing photos, repeated failures, and repeated late inspections.
- Follow up on STRIKE readiness gaps before assigning operators.

The module is designed to make pre-use inspection a measurable activity. Track completion rate, inspection duration, missed inspection count, defect aging, repeat defect rate, and return-to-service cycle time.

## QR Label Workflow

1. Open **Equipment Readiness → QR Labels**.
2. Select the equipment records that need labels.
3. Print labels sized for the equipment and environment.
4. Place labels where operators naturally approach the equipment before use.
5. Protect labels from abrasion, washdown, grease, and sunlight where possible.
6. Replace labels that are unreadable, damaged, painted over, or no longer associated with the correct equipment record.

Do not place the QR label where scanning would put the worker in a line of fire, pinch point, traffic path, elevated fall exposure, or other hazard.

## Configuration Workflow

### Checklist Setup

Safety leads should review the starter checklist for each equipment family. Add site-specific checks for attachments, dock plates, battery rooms, charging areas, freezer conditions, rough terrain, overhead obstructions, fall protection, special fuels, or manufacturer-specific requirements.

### STRIKE Refresher Setup

Create short STRIKE lessons for topics that operators forget or supervisors repeatedly correct. Good candidates include forklift stability triangle, seatbelt expectations, propane cylinder exchange, battery charging, scissor lift pothole protection, boom lift tie-off, pedestrian interaction, and pallet jack travel direction.

Tie the STRIKE requirement to the equipment family or to a specific equipment record. Mark it required-before-start when it must block the inspection until current.

### Reminder Rule Setup

Configure reminder rules around the way work actually starts:

- Equipment family or specific equipment.
- Department or work area.
- Shift label.
- Grace period in minutes.
- Notification recipients.

Use a short grace period for high-use PITs and a longer grace period for occasional equipment. Avoid sending reminders to broad groups unless the team has agreed who owns the follow-up.

## OSHA-Oriented Program Notes

SoteriaField does not decide whether your written program complies with every rule. It gives you records that help support the program:

- A dated pre-use inspection record.
- Operator identity and attestation.
- Equipment identity and QR traceability.
- Checklist version used at the time.
- Full-view and damage photos.
- Failed item details.
- Out-of-service status.
- Repair notes and repair evidence.
- Return-to-service timestamp and reviewer.
- Training readiness check through STRIKE.
- Missed-inspection reminder history.

For PIT programs, make sure your site procedure covers operator training, evaluation, refresher triggers, safe operating rules, equipment-specific limitations, attachments, battery or fuel handling, defect reporting, and removal from service. For aerial lifts, make sure the checklist also accounts for manufacturer instructions, fall protection, platform gates, guardrails, emergency lowering, work-area hazards, ground conditions, overhead hazards, and weather/wind limitations.

## Common Equipment-Specific Checks

### Electric Forklift

- Battery condition, connector, restraint, and cable condition.
- Forks, mast, chains, rollers, carriage, backrest, and data plate.
- Tires, brakes, steering, horn, lights, backup alarm, and seatbelt.
- Leaks, damaged guards, overhead guard, and unsafe modifications.

### LPG or Internal-Combustion Forklift

- Fuel cylinder or tank condition and securement.
- Hoses, fittings, leaks, valve orientation, and fuel odor.
- Engine, exhaust, fluids, tires, forks, mast, controls, and brakes.
- Proper ventilation and carbon-monoxide considerations where applicable.

### Reach Truck or Order Picker

- Mast, reach carriage, forks, chains, rollers, and side-shift.
- Platform, gates, harness/lanyard anchorage, and lift controls for order pickers.
- Aisle clearance, rack condition, floor condition, overhead obstructions, and travel path.

### Powered Pallet Jack or Lifter

- Tiller, throttle, lift/lower controls, belly button, horn, wheels, and battery.
- Fork condition, load wheels, steer wheels, and hydraulic leaks.
- Travel path, ramps, dock plates, load stability, and pedestrian interaction.

### Manual Pallet Lifter

- Handle, pump, release lever, forks, wheels, and load-rating markings.
- Hydraulic leaks, damaged frame, bent forks, and uneven rolling.
- Load size and route condition before movement.

### Scissor Lift

- Platform gate, guardrails, pothole protection, controls, emergency lowering, and alarms.
- Tires, leaks, labels, battery/fuel, ground controls, and manual.
- Work area: holes, slopes, drop-offs, floor capacity, traffic, overhead hazards, and wind.

### Boom Lift

- Boom sections, platform, gate, controls, emergency lowering, anchor points, and labels.
- Tires, outriggers/stabilizers where equipped, leaks, alarms, and ground controls.
- Work area: power lines, ground conditions, slopes, overhead hazards, traffic, and wind.

## Troubleshooting

### The QR Scan Says Equipment Not Found

Confirm the worker is in the correct active tenant, the QR label belongs to the current equipment record, and the equipment has not been decommissioned or recreated with a new token.

### The Checklist Has No Items

Ask a safety lead to check whether a published checklist template exists for the equipment family. If starter templates were created before the seed repair, run the Equipment Readiness seed repair migration.

### STRIKE Blocks The Inspection

Open the linked STRIKE lesson, complete the refresher, and return to the scan. If the worker completed training but still appears blocked, confirm the requirement version and expiration settings.

### Photo Upload Fails

Check network connection, file size, camera permissions, and whether the worker is operating under the correct tenant. Try one photo at a time if the connection is weak.

### Equipment Was Repaired But Still Shows Out Of Service

Open defects for the equipment and confirm every out-of-service defect has been returned to service. One unresolved critical defect keeps the unit blocked.

## FAQ

**Does this replace the paper checklist?**
It can, if your site accepts electronic records and the checklist content matches your written program. Keep your policy clear about electronic signatures, photo evidence, retention, and supervisor review.

**Can an operator submit a failed inspection?**
Yes. Failed inspections are important records. The operator should submit the finding, attach evidence, and remove the equipment from service when the condition is unsafe.

**Can a supervisor override a critical defect?**
Only through the defect workflow with notes and, where appropriate, repair evidence. The system is designed to preserve the audit trail rather than silently clearing unsafe findings.

**How often should equipment be inspected?**
Follow your written program, manufacturer instructions, and applicable regulations. Many PIT and lift programs require inspection before use each shift. Use reminder rules to make that expectation visible.

**What makes this better than a generic checklist app?**
The module ties QR identity, checklist version, equipment family, operator readiness, STRIKE refresher lessons, photo evidence, defect lifecycle, repair release, reminders, and audit exports into one record. That is the difference between checking boxes and proving equipment readiness.

## Related Modules

- **STRIKE**: short refresher lessons and readiness gates before high-risk work.
- **Training records**: formal operator training and expiration records.
- **LOTO**: equipment identity and hazardous-energy procedures for maintenance work.
- **Incidents**: link equipment defects or failures to incident investigations.
- **My Safety Readiness**: workers can see their own training, equipment badges, and restrictions.
$manual$,
  now()
)
on conflict (module_id) do update set
  title        = excluded.title,
  summary      = excluded.summary,
  body_md      = excluded.body_md,
  published_at = coalesce(public.manuals.published_at, now()),
  updated_at   = now()
where public.manuals.body_md like '%**Edit me.**%'
   or public.manuals.body_md = ''
   or public.manuals.published_at is null;

notify pgrst, 'reload schema';

commit;
