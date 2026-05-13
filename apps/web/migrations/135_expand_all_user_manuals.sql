-- Migration 135: publish comprehensive step-by-step user manuals.
--
-- The original seed file guarantees every top-level module has a row, while
-- earlier migrations filled only the first high-traffic manuals. This migration
-- replaces the remaining placeholders and refreshes the existing manuals with
-- consistent, field-ready guidance. Updates are intentional: the manuals table
-- has version history, so prior bodies remain auditable through the changelog.

begin;

with manual_updates(module_id, title, summary, body_md) as (
  values
  (
    'loto',
    'LOTO',
    'Lockout/Tagout procedures, placards, sign-ons, equipment review, and inspector-ready evidence.',
    $manual$
## Overview

The LOTO module manages hazardous-energy control records: equipment, placards, isolation steps, sign-ons, review status, and inspector evidence. It supports a practical lockout/tagout program, but it does not replace the judgment of an authorized or qualified person.

Use it when equipment must be isolated before service, maintenance, cleaning, setup, jam clearing, or troubleshooting.

## Who Uses It

- Authorized workers read the active procedure, apply locks and tags, verify zero energy, and sign on.
- Supervisors review draft procedures, monitor sign-ons, and correct incomplete records.
- Safety leads keep the equipment inventory, procedure quality, and inspector exports current.
- External reviewers use tokenized review links when they need read-only access.

## Before You Start

- Confirm the worker is trained and authorized for the task.
- Confirm the equipment record matches the physical asset, ID plate, department, and location.
- Confirm every energy source is represented: electrical, pneumatic, hydraulic, gas, mechanical, gravity, thermal, chemical, or stored energy.
- Confirm the written procedure is active, not a draft.

## Add Or Update Equipment

1. Open LOTO.
2. Select Add equipment, or open an existing equipment record.
3. Enter the equipment ID, name, department, location, and descriptive notes.
4. Add or revise each isolation step.
5. For each step, identify the energy source, isolation device, lock point, verification method, and return-to-service note.
6. Attach photos when they make the lock point easier to identify.
7. Save the draft.
8. Have a qualified reviewer verify the procedure in the field.
9. Promote the procedure to active only after the field check is complete.

## Perform A Lockout

1. Scan the placard QR code or open the equipment record.
2. Read the entire active procedure before touching the equipment.
3. Notify affected employees according to the site program.
4. Shut down the equipment using the normal stop method.
5. Apply each listed isolation step in order.
6. Apply personal locks and tags at every required isolation point.
7. Release or restrain stored energy.
8. Verify zero energy using the listed verification method.
9. Sign on in Soteria after zero energy is verified.
10. Complete the work.
11. Clear tools, guards, and workers from the area.
12. Sign off and restore energy according to the return-to-service sequence.

## Review And Approve Drafts

1. Filter the LOTO list to draft or needs review.
2. Open the procedure and compare each step to the physical equipment.
3. Check for missing stored energy, unclear lock points, and vague verification methods.
4. Edit the procedure or return it to the author with notes.
5. Approve only when the field procedure is complete enough for another authorized worker to follow.

## Good Records Look Like

- Each energy source has a separate step.
- Lock points are physically findable without guessing.
- Verification is specific, not "try it."
- Photos show the actual isolation point, not only the equipment exterior.
- Sign-on records identify who locked out, when, and for which equipment.

## Troubleshooting

If the QR code opens the wrong equipment, remove the placard and reprint it from the correct equipment record. If a procedure is missing an energy source, stop work, correct the draft, and route it for review. If workers cannot sign on, confirm the procedure is active and the user has the right role.

## Related Modules

- JHA for task-level hazards that remain after isolation.
- Risk Assessment for program-level hazardous-energy risks.
- Incidents for near-misses or failures tied to LOTO work.
- Compliance Bundles for inspector-ready exports.
$manual$
  ),
  (
    'my-safety-readiness',
    'My Safety Readiness',
    'Worker profile, readiness status, training due dates, equipment badges, shift assignment, and personal action list.',
    $manual$
## Overview

My Safety Readiness is the worker-facing page for answering one question: "Am I ready to work safely today?" It gathers profile status, training due dates, certifications, assigned equipment, STRIKE lessons, readiness alerts, and leaderboard standing into one place.

## Who Uses It

- Workers check their own readiness before starting a shift.
- Crew leads confirm whether a worker can perform a high-risk task.
- Trainers use gaps to decide who needs refresher training.
- Supervisors use readiness alerts before assigning work.

## Daily Worker Check

1. Open My Safety Readiness at the start of the shift.
2. Confirm the active tenant, department, and shift are correct.
3. Review the readiness status at the top of the page.
4. Complete any STRIKE lesson marked required before work.
5. Review training items due soon or expired.
6. Check equipment badges before operating PIT, lifts, or other controlled equipment.
7. Open any assigned action, such as a missed sign-off or pending acknowledgement.
8. Tell the supervisor if the page shows blocked or not ready.

## Update Your Profile

1. Open the profile section.
2. Review name, contact details, department, job title, and employee ID.
3. Add missing details if your role allows self-service edits.
4. Save and confirm the updated profile appears on the readiness page.
5. Ask an admin to correct locked fields such as role, tenant, or employment status.

## Read Training Status

1. Find the training section.
2. Look for expired, due soon, and current indicators.
3. Open an expired record to see the required course or credential.
4. Complete the assigned lesson or notify a trainer if the record is wrong.
5. Recheck readiness after the trainer updates the record.

## Equipment Badge Check

1. Open the equipment or authorization section.
2. Confirm the equipment family you plan to use is listed.
3. Confirm the badge is current and not restricted.
4. If a badge is missing, do not operate the equipment until a supervisor confirms authorization.

## Good Habits

- Check readiness before accepting a high-risk assignment.
- Keep contact details current so alerts reach the right person.
- Treat blocked status as a stop-work signal, not a suggestion.
- Report incorrect records quickly; stale training data can block valid work.

## Troubleshooting

If training appears expired even after completion, ask the trainer to check the training record date and expiration rule. If the wrong department appears, contact an admin to update your worker profile. If the page will not load, sign out and back in, then verify you are in the correct tenant.

## Related Modules

- Training Records for official certification records.
- STRIKE for microlearning and task-readiness lessons.
- Equipment Readiness for scan-to-inspect workflows.
- Notifications for reminders and readiness alerts.
$manual$
  ),
  (
    'equipment-readiness',
    'Equipment Readiness',
    'Pre-use inspections, QR scan entry, photo evidence, defects, repairs, return-to-service, and reminders.',
    $manual$
## Overview

Equipment Readiness manages pre-use inspections for PIT, lifts, pallet equipment, and other mobile equipment. It connects a physical unit to a QR label, the right checklist, operator readiness, inspection evidence, defect workflow, and return-to-service approval.

## Who Uses It

- Operators scan equipment, complete inspections, add photos, and submit findings.
- Supervisors review failed checks and decide whether equipment can be used.
- Maintenance documents repair notes and return-to-service evidence.
- Safety leads configure equipment families, checklists, reminders, and STRIKE gates.

## Operator Pre-Use Inspection

1. Open Equipment Readiness and choose Scan, or scan the equipment QR label.
2. Confirm the equipment ID, family, department, and location.
3. Complete any STRIKE lesson shown as required before inspection.
4. Capture a full-view photo of the equipment.
5. Enter shift, location, hour meter, odometer, or battery reading if requested.
6. Answer every checklist item as pass, fail, or not applicable.
7. Add notes for abnormal conditions.
8. Attach photos for leaks, broken parts, missing labels, worn forks, damaged tires, cracked platforms, or unsafe controls.
9. Submit the inspection.
10. Do not use equipment marked out of service or blocked.

## Supervisor Defect Review

1. Open Equipment Readiness and choose Defects.
2. Filter to open, critical, out of service, or in repair.
3. Open the defect and review the failed checklist item, notes, and photos.
4. Acknowledge the defect so the operator knows it is being handled.
5. Assign maintenance or document the site decision.
6. Keep the equipment out of service when a critical condition remains open.
7. Add repair notes and repair evidence before release.
8. Return to service only when all blocking defects on that equipment are resolved.

## Configure Checklists

1. Open Equipment Readiness Configuration.
2. Review each equipment family used by the tenant.
3. Create or edit checklist templates for the family.
4. Mark critical items that should remove equipment from service.
5. Mark photo-required items when evidence is needed.
6. Publish the checklist after comparing it with the manufacturer manual and site procedure.

## QR Label Workflow

1. Open QR Labels.
2. Select the equipment records that need labels.
3. Print labels for the environment.
4. Place labels where operators naturally inspect the equipment.
5. Avoid pinch points, traffic lanes, line-of-fire areas, and elevated hazards.
6. Replace damaged or unreadable labels immediately.

## Troubleshooting

If a scan says equipment not found, confirm the worker is in the correct tenant and the label belongs to an active record. If the checklist is empty, publish a checklist template for that equipment family. If a repaired unit still shows blocked, check for another open critical defect on the same unit.

## Related Modules

- STRIKE for refresher lessons before equipment use.
- Training Records for formal operator qualifications.
- Incidents for equipment-related events.
- My Safety Readiness for worker-level badges and restrictions.
$manual$
  ),
  (
    'risk-assessment',
    'Risk Assessment',
    'ISO 45001-style risk register, 5x5 scoring, controls, residual risk, heat map review, and audit exports.',
    $manual$
## Overview

Risk Assessment is the program-level hazard register. It tracks hazards, affected departments, inherent risk, controls, residual risk, owners, review dates, and evidence of decision-making.

## Who Uses It

- Safety leads maintain the register and approve scoring.
- Department owners document hazards and controls in their areas.
- Supervisors review overdue or high-risk items.
- Auditors use exports to verify the risk-management process.

## Create A Risk

1. Open Risk Assessment.
2. Select New Risk.
3. Enter a specific title that names the activity and hazard.
4. Select department, location, owner, and hazard category.
5. Describe the credible harm in plain language.
6. Score inherent likelihood and consequence before controls.
7. Add existing controls in hierarchy order: elimination, substitution, engineering, administrative, and PPE.
8. Score residual likelihood and consequence after controls.
9. Add evidence, notes, and review due date.
10. Save and route for review.

## Review The Heat Map

1. Open the heat map.
2. Filter by department, owner, status, or category.
3. Click a cell to inspect risks with the same residual score.
4. Prioritize red and high-amber cells first.
5. Look for risks with PPE-only controls or overdue reviews.
6. Export the current view when preparing for an audit or safety committee meeting.

## Update Controls

1. Open the risk detail page.
2. Add the proposed control and select its hierarchy level.
3. Assign an owner and due date for implementation.
4. Save the action.
5. After the control is implemented, attach evidence.
6. Re-score residual risk and record the reason for the change.

## Good Records Look Like

- The hazard is specific enough that another person can picture the task.
- Inherent and residual scores are both present.
- Controls are real, current, and assigned to owners.
- High-risk items have review dates that match the site cadence.
- Evidence supports major score changes.

## Troubleshooting

If every risk scores the same, calibrate the scoring matrix with supervisors before continuing. If a risk has no owner, assign one before approval. If an incident occurs without a related risk, add a new risk or link the incident to an existing one during investigation.

## Related Modules

- JHA for task-level analysis.
- Incidents for events that reveal risk-register gaps.
- Compliance Bundles for risk-register exports.
- Insights for trend detection.
$manual$
  ),
  (
    'confined-spaces',
    'Confined Spaces',
    'Permit-required confined space registry, hazard review, permit issue, atmospheric testing, sign-on, and closeout.',
    $manual$
## Overview

Confined Spaces manages the space registry and permit workflow for permit-required confined spaces. It helps teams document hazards, issue permits, record atmospheric tests, track entrants, and close the record after work is complete.

## Who Uses It

- Entry supervisors issue, validate, suspend, and close permits.
- Entrants review hazards and sign in and out.
- Attendants monitor entry status and communication checks.
- Safety leads maintain the space registry and audit closed permits.

## Add A Space

1. Open Confined Spaces.
2. Select Add Space.
3. Enter the space name, location, department, access points, normal contents, and description.
4. Identify hazards such as hazardous atmosphere, engulfment, configuration, mechanical energy, heat, chemicals, or fall exposure.
5. Classify the space as permit-required or non-permit according to the site program.
6. Add required PPE, rescue requirements, and entry notes.
7. Attach photos or diagrams if they help workers identify the space.
8. Save and print the QR placard if field scanning is used.

## Issue A Permit

1. Open the space record or scan the placard.
2. Select Issue Permit.
3. Confirm scope of work, date, shift, supervisor, attendant, and entrants.
4. Review hazards and controls pulled from the space record.
5. Record initial atmospheric readings for oxygen, LEL, carbon monoxide, hydrogen sulfide, or site-specific gases.
6. Confirm readings are within acceptable range before entry.
7. Document ventilation, isolation, rescue plan, communication method, and PPE.
8. Issue the permit.

## During Entry

1. Entrants sign on before entering.
2. Attendant monitors entrants and communication checks.
3. Record atmospheric re-tests at the required cadence.
4. Suspend the permit if readings go out of range, scope changes, or conditions become unsafe.
5. Evacuate the space when the permit is suspended.
6. Resume only after conditions are corrected and authorized by the entry supervisor.

## Close A Permit

1. Confirm every entrant has signed out.
2. Confirm tools and materials are removed or controlled.
3. Add final atmospheric readings if required.
4. Document deviations, lessons learned, or follow-up work.
5. Close the permit.

## Troubleshooting

If the permit blocks sign-on, check atmospheric readings, missing roles, expired permit time, and required fields. If a space is misclassified, stop issuing permits until the registry record is corrected and reviewed.

## Related Modules

- LOTO for isolation before entry.
- Hot Work when welding or cutting occurs inside a space.
- JHA for the task performed inside the space.
- Incidents for confined-space events and deviations.
$manual$
  ),
  (
    'hot-work',
    'Hot Work',
    'Hot-work permits, fire-watch assignments, pre-work controls, active monitoring, closeout, and audit trail.',
    $manual$
## Overview

Hot Work manages permits for welding, cutting, brazing, grinding, torch work, and other ignition-producing tasks. The module keeps the pre-work inspection, authorization, fire watch, atmospheric or area controls, and closeout evidence in one record.

## Who Uses It

- Requesters create permit requests for planned hot work.
- Permit authorizers inspect the area and approve or deny the work.
- Fire-watch personnel sign on, monitor the area, and complete post-work checks.
- Safety leads audit permits, trends, and overdue closeouts.

## Request A Permit

1. Open Hot Work.
2. Select New Permit.
3. Enter location, department, work description, contractor or employee crew, and planned start and end time.
4. Identify the hot-work type and equipment used.
5. Add nearby hazards such as combustible materials, dust, flammable liquids, wall penetrations, or adjacent confined spaces.
6. Attach photos when the work area needs context.
7. Submit the request.

## Authorize The Work

1. Open the permit request.
2. Inspect the work area before approval.
3. Confirm combustibles are moved, shielded, wetted, or otherwise controlled.
4. Confirm fire extinguishers, blankets, ventilation, gas checks, and barriers are available as needed.
5. Assign the fire-watch person and required watch duration.
6. Approve the permit only for the defined location, scope, and time window.

## Fire Watch Workflow

1. Fire watch signs on before work begins.
2. Monitor the work area and adjacent areas during the task.
3. Stop work if sparks, smoke, odors, or uncontrolled combustibles appear.
4. Continue post-work watch for the permit duration.
5. Complete the final area check.
6. Sign off after the area is clear.

## Close The Permit

1. Confirm hot work is complete.
2. Confirm fire watch is complete.
3. Add closeout notes and photos if conditions changed.
4. Mark the permit closed.

## Troubleshooting

If the permit cannot be approved, check missing fire watch, expired time window, incomplete area checklist, or missing authorization role. If the work scope changes, cancel or close the existing permit and create a new one.

## Related Modules

- Confined Spaces for hot work inside tanks, vessels, pits, or other spaces.
- JHA for task-specific hazards.
- Incidents for fire, smoke, burn, or near-miss reports.
- Compliance Bundles for permit exports.
$manual$
  ),
  (
    'incidents',
    'Incidents',
    'Incident intake, investigation, OSHA recordability support, corrective actions, lessons learned, and trend review.',
    $manual$
## Overview

Incidents captures injuries, illnesses, near-misses, property damage, environmental releases, and other safety events. It helps teams report quickly, investigate consistently, track corrective actions, and prepare recordkeeping evidence.

## Who Uses It

- Workers report events from the floor.
- Supervisors triage reports and protect the scene when needed.
- Investigators document facts, causes, and corrective actions.
- Safety leads review recordability, publish lessons learned, and read trends.

## Report An Incident

1. Open Incidents and select Report Incident.
2. Choose the event type.
3. Enter the date, time, location, department, and people involved.
4. Describe what happened in factual language.
5. Add photos or files when available.
6. Identify equipment, chemicals, JHAs, or permits related to the event.
7. Submit the report.
8. Notify a supervisor immediately for serious injury, emergency, spill, fire, or uncontrolled hazard.

## Triage A New Report

1. Open the incident detail page.
2. Confirm the event type and severity.
3. Add immediate actions taken to stabilize the situation.
4. Assign an investigator.
5. Decide whether the event needs OSHA recordability review.
6. Set corrective action owners and due dates for urgent controls.

## Investigate

1. Interview involved people and witnesses.
2. Review photos, permits, equipment records, training, and JHAs.
3. Document direct causes and contributing factors.
4. Use a structured method such as 5 Whys when helpful.
5. Create corrective actions that address causes, not only symptoms.
6. Attach evidence of completion.
7. Close the investigation after review.

## OSHA Recordkeeping Support

1. Open the recordability section.
2. Answer the work-relatedness and outcome questions.
3. Review the recommendation and reasoning.
4. A safety lead makes the final decision.
5. Export logs when preparing required records.

## Troubleshooting

If a report was filed under the wrong type, reclassify it with a note. If corrective actions are overdue, update ownership or due date only with a documented reason. If a serious event has no linked risk or JHA, create the missing link before closing.

## Related Modules

- Risk Assessment for program-level hazards revealed by incidents.
- JHA for task-level revisions after events.
- Training Records for competency review.
- Reports Scorecard for leading and lagging indicators.
$manual$
  ),
  (
    'near-miss',
    'Near-miss',
    'Legacy near-miss intake and follow-up workflow for hazards that did not result in injury or damage.',
    $manual$
## Overview

Near-miss reporting captures events that could have caused injury, illness, damage, or release but did not. This is a legacy focused workflow while the unified Incidents module becomes the primary intake path.

## Who Uses It

- Workers submit near-misses quickly from the floor.
- Supervisors review reports and remove immediate hazards.
- Safety leads trend repeated hazards and migrate serious items into Incidents or Risk Assessment.

## Submit A Near-Miss

1. Open Near-miss Reporting.
2. Select New Report.
3. Enter location, department, date, and time.
4. Describe what almost happened.
5. Identify the potential consequence, such as struck-by, fall, chemical exposure, fire, or equipment damage.
6. Add photos if they show the hazard.
7. Submit the report.

## Review A Near-Miss

1. Open the report.
2. Confirm the hazard is controlled or assign an immediate action.
3. Identify whether the event belongs in Incidents for full investigation.
4. Add root-cause notes if the event is repeated or high potential.
5. Assign corrective actions with owners and dates.
6. Close after actions are complete.

## Convert Or Escalate

1. Open the near-miss detail.
2. Review severity and recurrence.
3. Create or link an Incident record if formal investigation is needed.
4. Link a Risk Assessment item when the hazard is systemic.
5. Link a JHA when the task procedure needs revision.

## Good Records Look Like

- The report explains the potential harm, not only what was seen.
- Photos show the condition before correction when safe to capture.
- Corrective actions address the underlying hazard.
- Repeat near-misses are escalated to a risk or incident review.

## Troubleshooting

If workers are unsure whether to use Near-miss or Incidents, use Incidents for anything requiring investigation, recordability review, injury, illness, spill, damage, or high-potential event. Use Near-miss for quick hazard learning when no event occurred.

## Related Modules

- Incidents for formal investigation.
- Risk Assessment for systemic hazards.
- JHA for task-level control updates.
- Toolbox Talks for sharing lessons learned.
$manual$
  ),
  (
    'jha',
    'JHA',
    'Job Hazard Analysis library for task steps, hazards, controls, PPE, review, sign-on, and revision history.',
    $manual$
## Overview

JHA manages task-level hazard analysis. A good JHA breaks a job into observable steps, identifies hazards at each step, lists controls in practical language, and gives workers a versioned record to review before doing the task.

## Who Uses It

- Workers read and sign the active JHA before the task.
- Crew leads draft and revise JHAs for their work.
- Safety leads approve JHAs and monitor stale sign-offs.
- Investigators use JHAs when reviewing task-related incidents.

## Create A JHA

1. Open JHA.
2. Select New JHA.
3. Enter a specific task title, department, location, and owner.
4. Break the task into sequential steps.
5. For each step, list hazards that could reasonably occur.
6. Add controls in hierarchy order.
7. Identify required PPE.
8. Attach photos or references if they help the worker understand the task.
9. Save the draft.
10. Route it to a safety lead for review.

## Worker Review And Sign-On

1. Open the active JHA from the task list, QR code, or assistant.
2. Read every step before starting work.
3. Confirm controls and PPE are present in the work area.
4. Stop and ask a supervisor if the task or environment differs from the JHA.
5. Sign on after review.

## Revise A JHA

1. Open the active JHA.
2. Select Revise.
3. Update steps, hazards, controls, PPE, and attachments.
4. Add a change note explaining why the revision is needed.
5. Submit for approval.
6. After publishing, workers sign the new version before the next use.

## Good Records Look Like

- Steps are specific and observable.
- Hazards match the actual work, tools, materials, and environment.
- Controls are more than PPE whenever practical.
- The JHA is reviewed after incidents, process changes, or equipment changes.

## Troubleshooting

If a JHA is too generic, split it into narrower tasks. If workers repeatedly flag it as out of date, assign the owner to revise it before the task continues. If a JHA has no sign-ons, confirm the crew knows where to find it and whether a QR label is needed.

## Related Modules

- Risk Assessment for program-level hazards.
- LOTO for energy-isolation procedures.
- Incidents for events tied to task steps.
- Toolbox Talks for short briefings using JHA content.
$manual$
  ),
  (
    'toolbox-talks',
    'Toolbox Talks',
    'Daily or weekly safety briefings with topic selection, crew delivery, sign-in roster, and attendance history.',
    $manual$
## Overview

Toolbox Talks helps supervisors deliver short, focused safety briefings and capture attendance. Talks can be generated, edited, delivered, signed, and reviewed as part of the site safety communication program.

## Who Uses It

- Supervisors and foremen deliver talks to crews.
- Workers sign in after participating.
- Safety leads review topic coverage and attendance.
- Admins configure industry focus and delivery expectations.

## Deliver A Talk

1. Open Toolbox Talks.
2. Choose the talk for today or select a topic from the list.
3. Review the content before the crew arrives.
4. Edit the talk if a site-specific event or hazard needs to be included.
5. Deliver the talk in plain language.
6. Ask workers to discuss how the topic applies to today's work.
7. Open the sign-in roster.
8. Have each attending worker sign in.
9. Close the roster when the talk is complete.

## Create Or Edit A Talk

1. Open the talk draft.
2. Confirm the title, topic, regulation references, and audience.
3. Keep the talk short enough for a pre-shift meeting.
4. Add site-specific examples, recent near-misses, or photos when useful.
5. Save the revised talk.
6. Deliver the saved version to the crew.

## Review Attendance

1. Open the roster or history view.
2. Filter by date, department, crew, or worker.
3. Look for missed talks or repeated absence.
4. Follow up with supervisors when attendance is incomplete.
5. Export records for audit or safety committee review.

## Good Talks Look Like

- One clear hazard or behavior per talk.
- Specific examples from the site.
- Worker discussion, not only reading.
- Attendance captured the same day.
- Follow-up topics created from incidents, JHAs, and seasonal hazards.

## Troubleshooting

If a worker is missing from the roster, check the Workers admin page and department assignment. If the talk is too generic, edit it before delivery. If attendance is missing, reopen the talk history and add a correction note according to site policy.

## Related Modules

- Incidents for lessons learned.
- JHA for task-specific briefings.
- Training Records for formal courses that are not toolbox talks.
- Notifications for reminders.
$manual$
  ),
  (
    'strike',
    'STRIKE',
    'Microlearning lessons, quizzes, assignments, due dates, readiness gates, and completion tracking for high-risk work.',
    $manual$
## Overview

STRIKE delivers short lessons and checks for task readiness. It is designed for quick refreshers before high-risk work, not as a replacement for formal training where regulations require a full course, evaluation, or certification.

## Who Uses It

- Workers complete lessons and quizzes.
- Supervisors assign refreshers before specific tasks.
- Safety leads build lesson content and monitor completion.
- Admins connect STRIKE requirements to equipment, permits, or readiness workflows.

## Complete An Assigned Lesson

1. Open STRIKE or follow the readiness alert.
2. Select the assigned lesson.
3. Read or watch the lesson content.
4. Complete the quiz or acknowledgement.
5. Review any missed questions.
6. Submit completion.
7. Return to the blocked task or readiness page and refresh status.

## Assign A Lesson

1. Open STRIKE.
2. Select the lesson or create a new one.
3. Choose the audience: worker, department, role, equipment family, or task group.
4. Set due date and expiration.
5. Mark whether completion is required before work.
6. Publish the assignment.
7. Monitor completion from the assignment dashboard.

## Create Lesson Content

1. Choose a narrow learning objective.
2. Keep the lesson focused on one task, hazard, or behavior.
3. Add images, examples, and short questions where useful.
4. Write quiz questions that test decisions, not memorization.
5. Preview the lesson as a worker.
6. Publish only after reviewing for accuracy.

## Good STRIKE Programs Look Like

- Lessons are short enough to complete before work.
- Assignments map to real task risk.
- Expiration dates match the hazard and site policy.
- Formal training requirements stay in Training Records.
- Completion gates are used for high-risk tasks, not every routine activity.

## Troubleshooting

If a worker remains blocked after completing a lesson, check the assignment version, expiration rule, and tenant context. If completion is missing, confirm the worker submitted the final screen rather than only opening the lesson.

## Related Modules

- My Safety Readiness for personal completion status.
- Equipment Readiness for pre-use inspection gates.
- Training Records for formal certifications.
- Admin AI Usage when generated content is used.
$manual$
  ),
  (
    'safety-boards',
    'Safety Boards',
    'Threaded safety discussions, announcements, follow-up ownership, and searchable team communication.',
    $manual$
## Overview

Safety Boards provide an internal forum for safety discussion. Use boards for announcements, questions, improvement ideas, shift handoff notes, and follow-up threads that should stay visible beyond a chat message.

## Who Uses It

- Workers ask questions and share observations.
- Supervisors respond and assign follow-up.
- Safety leads post announcements and monitor themes.
- Admins moderate categories and access.

## Create A Thread

1. Open Safety Boards.
2. Choose the appropriate board or category.
3. Select New Thread.
4. Write a clear title.
5. Describe the question, hazard, idea, or announcement.
6. Add photos or links when useful.
7. Tag the department, topic, or module if available.
8. Post the thread.

## Respond To A Thread

1. Open the thread.
2. Read the full context before replying.
3. Answer with facts, next steps, or a decision.
4. Assign an owner when follow-up work is needed.
5. Mark resolved only when the question or action is complete.

## Moderation

1. Review new threads regularly.
2. Move threads to the correct category when needed.
3. Hide inappropriate or off-topic content according to site policy.
4. Convert safety-critical reports into Incidents, Near-miss, or Risk Assessment records.
5. Keep the original thread linked for context.

## Good Board Habits

- Use boards for discussion, not emergency reporting.
- Give threads specific titles.
- Link to the record of truth when a thread creates an action.
- Close the loop publicly so workers see that concerns are handled.

## Troubleshooting

If a serious hazard is posted on a board, create the right operational record immediately. If workers cannot see a board, check role, tenant, and board visibility settings.

## Related Modules

- Incidents for formal events.
- Near-miss for quick hazard reports.
- Risk Assessment for systemic issues.
- Notifications for thread updates.
$manual$
  ),
  (
    'bbs',
    'Behavior-Based Safety',
    'BBS observations, QR reporting, coaching follow-up, participation tracking, and scorecard review.',
    $manual$
## Overview

Behavior-Based Safety captures observations of safe behaviors, unsafe acts, and unsafe conditions. The goal is coaching and trend learning, not blame. QR entry makes it easy to report observations from the floor.

## Who Uses It

- Workers submit observations.
- Supervisors coach and close follow-up items.
- Safety leads review participation, repeat behaviors, and location trends.
- Admins manage QR locations and scoring configuration.

## Submit An Observation

1. Open BBS or scan a location QR code.
2. Choose safe behavior, unsafe act, or unsafe condition.
3. Select location and department.
4. Describe what was observed.
5. Identify the behavior category.
6. Add a photo only if it is safe and appropriate.
7. Choose whether follow-up is required.
8. Submit the observation.

## Coach And Close

1. Open the observation.
2. Review the description and photo.
3. Speak with the worker or crew if coaching is needed.
4. Record the coaching note or corrective action.
5. Assign an owner and due date for any physical condition.
6. Close after the action is complete.

## Manage QR Codes

1. Open BBS QR Codes.
2. Create a QR code for a department, line, area, or work cell.
3. Print and post it where observations naturally happen.
4. Replace damaged labels.
5. Retire QR codes for locations that no longer exist.

## Read The Scorecard

1. Open BBS Scorecard.
2. Review participation by department and shift.
3. Compare safe behavior recognition with unsafe observations.
4. Look for repeated locations or behavior categories.
5. Use trends to choose coaching topics and toolbox talks.

## Troubleshooting

If observations are punitive or vague, retrain observers on coaching language. If participation is low, post QR codes in easier locations and ask supervisors to demonstrate one observation during huddle.

## Related Modules

- Toolbox Talks for coaching topics.
- Incidents for events that go beyond observation.
- Risk Assessment for repeat systemic hazards.
- Reports Scorecard for tenant-wide indicators.
$manual$
  ),
  (
    'chemicals',
    'Chemical Management',
    'Chemical inventory, SDS storage, GHS labels, AI-assisted SDS review, approvals, restricted lists, MAQ, and Tier II reporting.',
    $manual$
## Overview

Chemical Management stores product records, SDS revisions, GHS details, container inventory, storage locations, approvals, restricted chemical rules, and reporting support. It is the operational home for HazCom information in Soteria.

## Who Uses It

- Workers search or scan chemicals to read hazards and PPE.
- Safety leads review SDS records and GHS fields.
- Stockroom or receiving users add containers and location changes.
- Admins manage restricted chemicals, approvals, MAQ caps, and reports.

## Add A Chemical

1. Open Chemicals and select Add Chemical.
2. Enter product name, manufacturer, product code, and common aliases.
3. Upload the SDS file.
4. Review AI-parsed fields such as signal word, pictograms, hazards, PPE, storage, transport, and CAS details.
5. Correct any field that does not match the SDS.
6. Approve the SDS review.
7. Save the product record.

## Add Inventory

1. Open the chemical record.
2. Select Add Container or Add Inventory.
3. Enter quantity, unit, lot if known, and storage location.
4. Check compatibility warnings and MAQ warnings.
5. Save the container.
6. Print or apply labels if required by site procedure.

## Review SDS Drift

1. Open SDS Drift Log.
2. Review chemicals flagged for newer manufacturer SDS revisions.
3. Upload the newer SDS when confirmed.
4. Review the parsed changes.
5. Approve the new revision.
6. Archive the old revision automatically through the record history.

## Approval Queue

1. Open Approval Queue.
2. Review the requested chemical, location, quantity, and reason.
3. Check restricted list and storage compatibility.
4. Approve with conditions or reject with a note.
5. Notify the requester of the decision.

## Troubleshooting

If parsing is wrong, edit the parsed fields before approval. If a barcode scan fails, search by product name or manufacturer and update the barcode field. If a location exceeds MAQ, reduce quantity or move containers according to the site fire-code plan.

## Related Modules

- JHA for chemical-handling tasks.
- Incidents for spills and exposures.
- Compliance Bundles for SDS and reporting evidence.
- Risk Assessment for chemical program hazards.
$manual$
  ),
  (
    'reports-scorecard',
    'EHS Scorecard',
    'Leading and lagging EHS indicators with drill-downs across incidents, permits, inspections, readiness, and corrective actions.',
    $manual$
## Overview

The EHS Scorecard turns operational records into indicators. It combines lagging results such as recordables with leading activity such as inspections, permit discipline, corrective action closure, BBS participation, and training readiness.

## Who Uses It

- Safety leaders review performance and priorities.
- Executives read tenant-wide direction without opening every module.
- Supervisors drill into their department.
- Auditors use exports to verify monitoring and follow-up.

## Read The Scorecard

1. Open EHS Scorecard.
2. Select the date range.
3. Filter by department, site, or module when needed.
4. Review the top indicators first.
5. Compare current period with prior period.
6. Click any metric to drill into source records.
7. Assign follow-up actions for negative trends.
8. Export a snapshot for meetings or audits.

## Common Indicators

- Incident rates and severity.
- Near-miss volume and closure.
- Corrective action completion and aging.
- Permit activity and overdue closeouts.
- Equipment inspection completion and defect aging.
- Training readiness and overdue certifications.
- BBS participation and repeat observation themes.

## Meeting Workflow

1. Open the scorecard before the safety meeting.
2. Set the reporting period.
3. Drill into red or declining indicators.
4. Capture decisions as corrective actions in the source module.
5. Export the scorecard after actions are assigned.
6. Revisit the same indicators at the next meeting.

## Troubleshooting

If a metric looks wrong, drill into source records before changing assumptions. Check date range, tenant, department filter, and unpublished or draft records. If a source module has missing data, fix the record at the source rather than editing the scorecard.

## Related Modules

- Incidents for lagging indicators.
- Equipment Readiness for inspection metrics.
- BBS for participation metrics.
- Insights for automated trend detection.
$manual$
  ),
  (
    'reports-insights',
    'Insights',
    'Automated trend detection, hot spots, anomaly review, supervisor mix, and recommended investigation paths.',
    $manual$
## Overview

Insights looks across modules for patterns that are easy to miss in daily work. It highlights hot spots, unusual changes, repeated failures, aging actions, and relationships between departments, supervisors, shifts, and risk areas.

## Who Uses It

- Safety leads decide where to investigate next.
- Supervisors see trends in their area.
- Executives review emerging risk.
- Analysts validate patterns before they become action plans.

## Review Insights

1. Open Insights.
2. Select the reporting range.
3. Review high-priority cards first.
4. Open the card to see evidence, source records, and filters.
5. Decide whether the insight is actionable, expected, or noise.
6. Create follow-up in the source module when action is needed.
7. Dismiss with a reason when no action is needed.

## Validate A Trend

1. Check the source record count.
2. Compare with prior periods.
3. Filter by department, shift, supervisor, or location.
4. Review several source records manually.
5. Ask whether the trend reflects real risk or a data-entry change.
6. Record the conclusion.

## Good Insight Habits

- Treat insights as prompts for investigation, not automatic conclusions.
- Link actions to source records.
- Watch for small sample sizes.
- Revisit dismissed insights if they repeat.
- Share confirmed trends through toolbox talks or safety meetings.

## Troubleshooting

If an insight is stale, check whether source records have updated and whether the date range is correct. If a card appears misleading, inspect the underlying records and document why it was dismissed.

## Related Modules

- EHS Scorecard for metric summaries.
- Incidents for event trends.
- Equipment Readiness for inspection and defect trends.
- Training Records for readiness gaps.
$manual$
  ),
  (
    'reports-compliance-bundle',
    'Compliance bundle',
    'Inspector-ready export packages with permits, logs, manuals, training, SDS, and supporting evidence.',
    $manual$
## Overview

Compliance Bundles package records for audits, inspections, customer requests, or management review. A bundle should be scoped to a purpose and date range so the recipient receives evidence without unrelated noise.

## Who Uses It

- Safety leads prepare audit packages.
- Admins generate customer or inspector exports.
- Supervisors gather records for department reviews.
- External reviewers receive read-only evidence.

## Create A Bundle

1. Open Compliance Bundles.
2. Select New Bundle.
3. Choose the purpose, such as OSHA inspection, internal audit, customer request, or management review.
4. Set the date range.
5. Choose modules to include.
6. Filter by department, site, equipment, space, or chemical if needed.
7. Preview the record count.
8. Generate the bundle.
9. Download or share through the approved route.

## What To Include

- Incident logs and investigations.
- OSHA forms or recordkeeping summaries when applicable.
- Permits and sign-ons.
- LOTO procedures and review history.
- Training records and certifications.
- SDS and chemical inventory.
- Equipment inspection and defect evidence.
- Manual versions or changelog excerpts when requested.

## Quality Check Before Sharing

1. Open the preview.
2. Confirm the date range and filters.
3. Confirm private or unrelated records are excluded.
4. Verify required attachments render.
5. Add a cover note explaining the scope.
6. Save the final export.

## Troubleshooting

If a record is missing, confirm it is inside the date range and belongs to the selected tenant or department. If a PDF is too large, narrow the scope or split by module. If an attachment fails, open the source record and verify the file exists.

## Related Modules

- Inspector View for tokenized read-only access.
- Training Records for certification evidence.
- Chemical Management for SDS exports.
- Incidents for OSHA-related records.
$manual$
  ),
  (
    'reports-inspector',
    'Inspector view',
    'Tokenized read-only access for auditors, inspectors, customers, and outside reviewers.',
    $manual$
## Overview

Inspector View creates time-limited read-only links for people who need evidence but should not have a normal user account. Use it for auditors, inspectors, customer reviewers, or outside consultants.

## Who Uses It

- Admins create and revoke links.
- Safety leads choose what evidence is visible.
- Inspectors or reviewers open the tokenized link.
- Superadmins audit access history.

## Create An Inspector Link

1. Open Inspector View.
2. Select New Link.
3. Enter reviewer name, organization, and purpose.
4. Choose visible modules and date range.
5. Set expiration.
6. Add a note describing the scope.
7. Generate the link.
8. Send it through the approved communication channel.

## Review Access

1. Open the inspector link detail.
2. Confirm expiration and visible records.
3. Review access timestamps if available.
4. Revoke the link when the review is complete or scope changes.

## Good Access Control

- Use the narrowest useful date range.
- Do not share normal user credentials with inspectors.
- Revoke links after the inspection.
- Create a new link when scope changes.
- Avoid including unrelated employee information unless required.

## Troubleshooting

If the reviewer cannot open the link, check expiration and whether the token was copied fully. If a record is missing, check module selection, date range, and permissions. If the wrong records are visible, revoke the link and issue a corrected one.

## Related Modules

- Compliance Bundles for downloadable packages.
- LOTO for procedure review.
- Incidents for investigations and logs.
- Admin Configuration for tenant-level access policy.
$manual$
  ),
  (
    'admin-loto-devices',
    'LOTO devices',
    'Lock and tag inventory, ownership, checkout status, condition review, and audit trail.',
    $manual$
## Overview

LOTO Devices manages the physical inventory of locks, tags, hasps, group lock boxes, and related lockout equipment. The purpose is to know what exists, who has it, and whether it is ready for use.

## Who Uses It

- Admins maintain the device inventory.
- Authorized workers check out assigned devices.
- Supervisors review missing, damaged, or overdue devices.
- Safety leads audit lock-control practices.

## Add A Device

1. Open Admin and select LOTO Devices.
2. Select Add Device.
3. Choose device type.
4. Enter serial number, label, color, owner, and storage location.
5. Add condition notes.
6. Save the device.
7. Apply or print any physical label required by site policy.

## Check Out Or Assign

1. Open the device record.
2. Confirm the device is available and in good condition.
3. Assign it to a worker, kit, department, or lock box.
4. Record checkout date and notes.
5. Save the assignment.

## Inspect Device Inventory

1. Filter devices by status, owner, department, or condition.
2. Review damaged, missing, retired, or overdue items.
3. Update condition notes after physical inspection.
4. Retire devices that should not be used.
5. Export inventory for audit when needed.

## Troubleshooting

If a lock appears assigned to the wrong worker, update the assignment with a note rather than deleting history. If a serial number is duplicated, inspect the physical labels and correct the record that is wrong.

## Related Modules

- LOTO for procedures and sign-ons.
- Workers for authorized-person assignments.
- Training Records for lockout qualification evidence.
- Data Hygiene Log for inventory corrections.
$manual$
  ),
  (
    'admin-workers',
    'Workers',
    'Worker roster, roles, departments, profile status, invite alignment, training readiness, and access control.',
    $manual$
## Overview

Workers is the admin surface for people in a tenant. It connects profile data, tenant membership, role, department, training readiness, and operational identity.

## Who Uses It

- Admins invite, edit, deactivate, and assign workers.
- Supervisors review department rosters.
- Trainers connect records to the correct worker.
- Superadmins audit tenant membership issues.

## Add Or Invite A Worker

1. Open Admin and select Workers.
2. Select Add Worker or Invite User.
3. Enter name, email, employee ID, department, role, and job title.
4. Choose whether the person needs app access or only a worker record.
5. Send the invite when app access is required.
6. Confirm the worker appears in the roster.
7. After acceptance, verify profile and membership alignment.

## Edit A Worker

1. Open the worker detail page.
2. Update department, job title, supervisor, contact information, or status.
3. Review role changes carefully because they affect permissions.
4. Save with a reason when the change is sensitive.
5. Confirm the change appears in readiness and module filters.

## Deactivate A Worker

1. Open the worker detail page.
2. Review open actions, training, assignments, and device ownership.
3. Transfer or close responsibilities.
4. Set status to inactive.
5. Revoke app access if appropriate.
6. Keep historical records intact.

## Troubleshooting

If a user can sign in but does not appear in Workers, check tenant membership and profile linkage. If a worker appears twice, merge or deactivate the duplicate according to the data hygiene process. If role changes do not take effect, ask the user to sign out and back in.

## Related Modules

- Training Records for certifications.
- My Safety Readiness for worker self-service status.
- LOTO Devices for assigned lock inventory.
- Admin Configuration for tenant defaults.
$manual$
  ),
  (
    'admin-configuration',
    'Configuration',
    'Tenant settings for modules, branding, defaults, URLs, policy choices, and operational guardrails.',
    $manual$
## Overview

Configuration controls tenant-level settings. Changes here can affect navigation, branding, defaults, integrations, and module behavior, so treat this area as an admin-only control panel.

## Who Uses It

- Tenant admins manage day-to-day settings.
- Superadmins configure platform-level defaults.
- Safety leads request settings that reflect the written program.
- IT or integration owners verify URLs and hooks.

## Review Tenant Settings

1. Open Admin and select Configuration.
2. Review tenant name, branding, enabled modules, departments, and defaults.
3. Check work-order URL templates and external references.
4. Confirm feature toggles match the customer contract and rollout plan.
5. Save only intentional changes.

## Change Module Availability

1. Review who currently uses the module.
2. Export or preserve records if disabling a module.
3. Toggle the module setting.
4. Save the change.
5. Test navigation as a normal user.
6. Notify affected teams.

## Update Defaults

1. Identify the default value to change.
2. Confirm the site policy supports the new value.
3. Update the field.
4. Save and test a new record in the affected module.
5. Document the reason for important changes.

## Troubleshooting

If a module disappears, check tenant module settings and the global feature registry. If links open the wrong external system, verify URL templates and placeholders. If branding looks stale, refresh the app and confirm the uploaded asset path.

## Related Modules

- Webhooks for integration endpoints.
- Notifications for alert behavior.
- Workers for role and department data.
- AI Usage for tenant budget settings.
$manual$
  ),
  (
    'admin-webhooks',
    'Webhooks',
    'Outbound integration events, endpoint setup, signing secrets, delivery history, retries, and failure review.',
    $manual$
## Overview

Webhooks send Soteria events to external systems. Use them to notify work-order tools, BI pipelines, data warehouses, or customer middleware when important records change.

## Who Uses It

- Admins create and manage endpoints.
- IT or integration owners receive and validate payloads.
- Developers troubleshoot delivery failures.
- Superadmins review platform-level delivery health.

## Create A Webhook

1. Open Admin and select Webhooks.
2. Select New Webhook.
3. Enter endpoint URL.
4. Choose event types to send.
5. Add a signing secret if required.
6. Save the webhook.
7. Trigger a test event.
8. Confirm the receiving system validates and processes the payload.

## Monitor Deliveries

1. Open the webhook detail page.
2. Review recent deliveries.
3. Check status code, latency, and response body.
4. Retry failed deliveries when the receiver is fixed.
5. Disable endpoints that repeatedly fail and are no longer used.

## Good Integration Practice

- Use HTTPS endpoints only.
- Rotate secrets when staff or vendors change.
- Make receivers idempotent because retries can happen.
- Store the event ID to prevent duplicate processing.
- Return a 2xx response only after the payload is accepted.

## Troubleshooting

If deliveries fail, check DNS, TLS, firewall rules, authentication, signing-secret mismatch, and receiver timeouts. If duplicates appear, make the receiver idempotent before enabling retries.

## Related Modules

- Configuration for tenant-level integration settings.
- Compliance Bundles for export workflows.
- Incidents and permits for event payloads.
- Data Hygiene Log for integration-related corrections.
$manual$
  ),
  (
    'admin-training',
    'Training records',
    'Certification records, expiration tracking, course evidence, worker readiness, and audit exports.',
    $manual$
## Overview

Training Records stores formal training, certifications, evaluation dates, expiration dates, attachments, and worker readiness evidence. Use it for official records that need audit trail and expiration control.

## Who Uses It

- Trainers create and update records.
- Admins import rosters and correct worker links.
- Workers see status through My Safety Readiness.
- Supervisors check qualifications before assigning tasks.

## Add A Training Record

1. Open Admin and select Training Records.
2. Select Add Record.
3. Choose the worker.
4. Select training type or certification.
5. Enter completion date, expiration date, trainer, and provider.
6. Attach certificate or evaluation evidence.
7. Save the record.
8. Confirm the worker readiness page reflects the new status.

## Import Training Records

1. Download the import template.
2. Fill worker identifiers, course names, dates, and expiration rules.
3. Upload the CSV.
4. Review validation errors.
5. Correct unmatched workers or invalid dates.
6. Commit the import.
7. Spot-check several worker profiles.

## Review Expiring Training

1. Filter records to due soon or expired.
2. Group by department or supervisor.
3. Assign refresher training.
4. Update completion records after training.
5. Export the list for the safety meeting if needed.

## Troubleshooting

If a worker still appears expired, check duplicate worker records, expiration date, and course mapping. If an import fails, fix the CSV rather than editing many individual records after a bad import.

## Related Modules

- My Safety Readiness for worker-facing status.
- STRIKE for microlearning that is not a formal certificate.
- Equipment Readiness for operator readiness checks.
- Workers for roster identity.
$manual$
  ),
  (
    'admin-ai-usage',
    'AI usage',
    'Tenant AI invocation history, budget tracking, model spend, surface breakdown, and audit review.',
    $manual$
## Overview

AI Usage shows how the tenant uses AI-assisted features. It tracks invocation counts, cost estimates, model usage, calling surfaces, budget caps, and audit details so admins can manage value and spend.

## Who Uses It

- Tenant admins monitor usage and budget.
- Superadmins investigate abnormal cost or abuse.
- Product owners compare AI feature adoption.
- Finance or operations teams review spend.

## Review Usage

1. Open Admin and select AI Usage.
2. Set the date range.
3. Review total invocations, estimated cost, and budget status.
4. Break down by module or surface.
5. Inspect high-volume users or unusual spikes.
6. Export the report if needed.

## Investigate A Spike

1. Filter to the day or hour where usage jumped.
2. Review calling surface, model, and user.
3. Open related records when available.
4. Decide whether the spike is expected, training-related, automation-related, or abnormal.
5. Adjust budget caps or permissions if needed.

## Manage Budget Expectations

1. Review current monthly trend.
2. Compare spend with active modules and rollout stage.
3. Set or revise budget cap according to tenant policy.
4. Notify admins before major cap changes.
5. Monitor again after the change.

## Troubleshooting

If usage appears missing, check whether the feature records invocations yet and whether the selected date range is correct. If costs look high, inspect model selection and repeated retries from the source module.

## Related Modules

- STRIKE, LOTO, Chemicals, and Confined Spaces for AI-assisted authoring or parsing.
- Configuration for tenant controls.
- Data Hygiene Log for audit of corrections.
- Support for suspected usage bugs.
$manual$
  ),
  (
    'admin-hygiene-log',
    'Data hygiene log',
    'Audit trail for tenant data cleanup, corrections, merges, decommissions, and administrative repair work.',
    $manual$
## Overview

The Data Hygiene Log records cleanup work that changes operational data outside the normal workflow. Use it to preserve context for merges, renames, decommissions, foreign-key repairs, duplicate cleanup, and other administrative corrections.

## Who Uses It

- Admins document corrections they perform.
- Superadmins review sensitive cleanup actions.
- Support uses entries to understand what changed.
- Auditors verify that data repairs were controlled.

## Add A Hygiene Entry

1. Open Admin and select Data Hygiene Log.
2. Select New Entry.
3. Choose the affected module and record type.
4. Describe the problem.
5. Describe the correction made.
6. Link affected records when possible.
7. Add before-and-after values for important fields.
8. Save the entry.

## When To Use It

- Merging duplicate workers.
- Renaming departments or equipment after import errors.
- Decommissioning records that should not be deleted.
- Repairing broken relationships.
- Correcting tenant-scoped data after support review.

## Good Entries Look Like

- Specific enough that a future admin understands the issue.
- Linked to affected records.
- Clear about who requested the change.
- Clear about what changed and why.
- No secrets or unnecessary personal details.

## Troubleshooting

If you need to change data but cannot explain why, stop and ask for clarification before editing. If a correction affects many records, create a summary entry and attach the export or ticket reference used for validation.

## Related Modules

- Workers for roster merges.
- LOTO and Equipment Readiness for decommissioning corrections.
- Webhooks for integration cleanup.
- Support for bug-related data fixes.
$manual$
  ),
  (
    'settings-notifications',
    'Notifications',
    'Web Push setup, per-user preferences, alert categories, testing, troubleshooting, and quiet-hours expectations.',
    $manual$
## Overview

Notifications controls how users receive alerts for permits, tests, readiness, assignments, threads, corrective actions, and other time-sensitive events. It includes browser push setup and per-user preferences.

## Who Uses It

- Workers subscribe to alerts they need for assigned work.
- Supervisors receive operational reminders.
- Safety leads monitor overdue or critical alerts.
- Admins help troubleshoot browser or device settings.

## Enable Browser Notifications

1. Open Settings and select Notifications.
2. Choose Enable Push.
3. Accept the browser permission prompt.
4. Send a test notification.
5. Confirm the test appears on the device.
6. Review category toggles and keep required safety alerts enabled.

## Set Preferences

1. Open notification settings.
2. Review each alert category.
3. Turn on alerts needed for your role.
4. Turn off optional categories that create noise.
5. Save changes.
6. Revisit preferences after role or department changes.

## Test And Troubleshoot

1. Send a test notification from the settings page.
2. If it does not arrive, check browser permission.
3. Check operating-system notification settings.
4. Confirm you are signed in to the right tenant.
5. Re-enable push if the browser subscription expired.
6. Try another browser if the device blocks service workers.

## Good Notification Habits

- Keep critical safety alerts enabled.
- Avoid broad admin alerts unless you own the follow-up.
- Use quiet hours only when site policy allows delayed alerts.
- Keep contact and role information current.

## Related Modules

- Confined Spaces and Hot Work for permit alerts.
- Equipment Readiness for missed inspections and defects.
- STRIKE for assignment reminders.
- Safety Boards for thread updates.
$manual$
  )
)
insert into public.manuals (module_id, title, summary, body_md, published_at)
select module_id, title, summary, body_md, now()
from manual_updates
on conflict (module_id) do update set
  title        = excluded.title,
  summary      = excluded.summary,
  body_md      = excluded.body_md,
  published_at = coalesce(public.manuals.published_at, now()),
  updated_at   = now();

notify pgrst, 'reload schema';

commit;
