// Federal air, wastewater, hazardous waste program and manifest content, kept
// apart from federal.ts so each file stays readable. federal.ts spreads these
// into the federal pack.
//
// Two scope decisions worth knowing:
//  * The weekly walks of satellite and central accumulation areas are NOT
//    checklists here. The hazardous waste module already runs them (areas,
//    cadence, photos, overdue tracking), and a second record of the same walk
//    would disagree with the first. They are made jurisdiction-aware there
//    (hazardousWasteStateChecks.ts) and shown read-only in the environmental
//    views.
//  * Where a permit sets the deadline (Title V certifications, NPDES discharge
//    monitoring reports), the item is in the legal register, not the calendar,
//    rather than carrying an invented date.
//
// STATUS: DRAFT. Specifics written from recollection of the rule carry a
// `verify` note so the reviewing Certified Safety Professional knows what to
// check.

import type { ChecklistTemplateDef, GuideDef, LegalRequirementDef, ObligationDef } from '../content'
import { cite, numericItem, passFail, photoItem, signatureItem, textItem } from './helpers'

const AIR_PERMITTED = ['registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] as const

// Items cite the plain form; each template carries the annotated one once, so the
// reviewer sees one note to clear instead of the same note on every question.
const PERMIT_TERMS = cite('Site air permit or registration terms and conditions')
const PERMIT_TERMS_TO_MAP = cite(
  'Site air permit or registration terms and conditions',
  'Add the permit condition number to each question once the conditions are mapped to this checklist.',
)
const TITLE_V_RECORDS = cite(
  '40 CFR 70.6(a)(3) (Title V monitoring and records)',
  'Applies to Title V sources only. Confirm the record-retention period (the rule says five years) and that your permit repeats it.',
)

// ── Air ─────────────────────────────────────────────────────────────────────

const ENGINE_HOURS_VERIFY =
  'Confirm the 100-hour annual limit for maintenance checks and readiness testing, and whether your permit or state rule sets a lower one.'
const ENGINE_HOURS = cite('40 CFR 63.6640(f)', ENGINE_HOURS_VERIFY)
const ENGINE_HOURS_PLAIN = cite('40 CFR 63.6640(f)')

const airPermitWalkthrough: ChecklistTemplateDef = {
  id: 'air-permit-walkthrough', program: 'air', name: 'Air permit compliance walkthrough',
  description: 'A walk of the permitted emission units and their controls, with a check of the records the permit requires. Do it as often as your permit\'s monitoring terms say; a quarter is the most a record should go without one.',
  subjectType: 'facility', cadence: 'quarterly',
  appliesWhen: { airPermitType: [...AIR_PERMITTED] },
  citations: [PERMIT_TERMS_TO_MAP, TITLE_V_RECORDS],
  items: [
    passFail('air-pw.permit-on-hand', 'Before you start', 'The current permit (or registration) and its conditions are on site, and the operators who need them know where they are.', {
      cite: [PERMIT_TERMS], clauseRef: '9.1.1',
    }),
    passFail('air-pw.units-match', 'Emission units', 'Every emission unit that is running is listed in the permit, and nothing has been added, moved or modified without the authorization the permit or rules require.', {
      cite: [PERMIT_TERMS, cite('Clean Air Act §110(a)(2)(C); 40 CFR 51.160', 'Confirm the authorization your state or air district requires before construction or modification, including for like-for-like replacements.')],
      failCreatesAction: true, critical: true, clauseRef: '6.1.3',
      guidance: 'New boilers, ovens, fryers, generators and process lines are the usual surprises. If something changed, stop and ask before running it.',
    }),
    passFail('air-pw.within-limits', 'Emission units', 'Production, throughput, fuel use and operating hours stayed within the permit limits for the period (check the logs, not memory).', {
      cite: [PERMIT_TERMS], failCreatesAction: true, critical: true, clauseRef: '6.1.3',
    }),
    passFail('air-pw.controls', 'Controls and monitoring', 'Control devices are operating, and the parameters the permit requires (pressure drop, temperature, flow, pH and the like) were read and are in range.', {
      cite: [PERMIT_TERMS], failCreatesAction: true, critical: true, clauseRef: '9.1.1',
    }),
    passFail('air-pw.monitors', 'Controls and monitoring', 'Gauges, meters and any continuous monitors are working and were calibrated on the schedule the permit sets.', {
      cite: [PERMIT_TERMS], failCreatesAction: true, clauseRef: '9.1.1',
    }),
    passFail('air-pw.visible', 'Controls and monitoring', 'No visible emissions from stacks or vents beyond what the permit allows, and no dust or odor leaving the property.', {
      cite: [PERMIT_TERMS, cite('40 CFR Part 60, Appendix A, Method 9', 'The opacity limit and method come from the permit or the rule that covers each unit.')],
      failCreatesAction: true, critical: true, clauseRef: '9.1.1',
      guidance: 'Look at stacks, vents, baghouse exhaust and material handling. Reading opacity as a number takes an observer certified in the method; a plain "I can see a plume" is still worth recording.',
    }),
    passFail('air-pw.maintenance', 'Maintenance', 'Required maintenance (filter changes, burner tune-ups, inspections) was done on schedule.', {
      cite: [PERMIT_TERMS], failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('air-pw.records', 'Records', 'Required records (monitoring, maintenance, operating logs, fuel records) are complete for the period, and older ones are kept as long as the permit requires.', {
      cite: [PERMIT_TERMS, cite('40 CFR 70.6(a)(3)(ii)(B)')], failCreatesAction: true, clauseRef: '9.1.1',
    }),
    passFail('air-pw.deviations', 'Records', 'Every deviation, malfunction or exceedance since the last walkthrough was logged, reported as the permit requires, and has a corrective action.', {
      cite: [PERMIT_TERMS, cite('40 CFR 70.6(a)(3)(iii)(B)', 'Title V sources: confirm the deviation reporting rule and the timing your permit sets.')],
      failCreatesAction: true, critical: true, clauseRef: '9.1.1',
    }),
    textItem('air-pw.notes', 'Wrap-up', 'Anything else worth recording: changes planned, complaints, agency visits. Write "none" if none.', {
      cite: [PERMIT_TERMS], required: true,
    }),
    photoItem('air-pw.photo', 'Wrap-up', 'Photo of anything you flagged (or of a control device gauge).', { cite: [PERMIT_TERMS], required: false }),
    signatureItem('air-pw.sign', 'Wrap-up', 'Inspector signature.', { cite: [PERMIT_TERMS], required: true }),
  ],
}

const airEngineLog: ChecklistTemplateDef = {
  id: 'air-engine-log', program: 'air', name: 'Emergency engine hours and maintenance',
  description: 'Record how many hours each emergency generator or fire-pump engine has run, why, and whether its maintenance is current.',
  subjectType: 'facility', cadence: 'quarterly',
  appliesWhen: { airPermitType: [...AIR_PERMITTED] },
  citations: [ENGINE_HOURS, PERMIT_TERMS],
  items: [
    passFail('air-eng.hour-meter', 'Hours', 'Each engine has a working hour meter, and its reading was recorded and agrees with the run log.', {
      cite: [cite('40 CFR 63.6625(f)', 'Confirm the non-resettable hour meter requirement for emergency engines.'), cite('40 CFR 63.6655(f)', 'Confirm the record of hours and the reason for each run.')],
      failCreatesAction: true, clauseRef: '9.1.1',
    }),
    numericItem('air-eng.testing-hours', 'Hours', 'Most hours any one engine has run this calendar year for maintenance checks and readiness testing.', {
      cite: [ENGINE_HOURS], numeric: { max: 100, unit: 'hours' }, failCreatesAction: true, critical: true, clauseRef: '6.1.3',
      guidance: 'Real emergencies do not count toward this limit, so keep them separate. Your permit or state rule may set a lower limit than 100 hours (California\'s engine rule does).',
    }),
    passFail('air-eng.other-use', 'Hours', 'No engine ran for any other non-emergency reason (peak shaving, backup for a planned outage, utility programs) unless the rule and the permit allow it.', {
      cite: [cite('40 CFR 63.6640(f)', 'The demand-response allowance was vacated by a federal court in 2015. Confirm what the rule allows today before relying on any non-emergency use.')],
      failCreatesAction: true, critical: true, clauseRef: '6.1.3',
    }),
    passFail('air-eng.emergency-log', 'Hours', 'Every emergency run is logged with the date, the hours and what the emergency was.', {
      cite: [cite('40 CFR 63.6655(f)', 'Confirm that the record must say what kind of emergency it was.')],
      failCreatesAction: true, clauseRef: '9.1.1',
    }),
    passFail('air-eng.maintenance', 'Maintenance', 'Oil and filter changes, hoses and belts, and spark plug or air cleaner inspections (as they apply to each engine) were done at the intervals the rule or the manufacturer sets.', {
      cite: [cite('40 CFR 63.6603 and Table 2d', 'Confirm the maintenance list and intervals for each engine\'s size, age and type.')],
      failCreatesAction: true, clauseRef: '8.1',
    }),
    textItem('air-eng.notes', 'Wrap-up', 'Hour-meter readings by engine, and anything unusual. Write "none" if none.', { cite: [ENGINE_HOURS], required: true }),
    signatureItem('air-eng.sign', 'Wrap-up', 'Signature.', { cite: [ENGINE_HOURS], required: true }),
  ],
}

// ── Wastewater ──────────────────────────────────────────────────────────────

const PRETREATMENT_PH = cite('40 CFR 403.5(b)(2)', 'Confirm; your POTW\'s local limits or your discharge permit may set a tighter range.')
const BYPASS = cite('40 CFR 403.17', 'Confirm the bypass rules for this user category.')
const SEWER_RULES = cite('Local sewer use ordinance or discharge permit')
const SEWER_RULES_TO_MAP = cite('Local sewer use ordinance or discharge permit', 'Cite the specific ordinance sections and permit conditions once they are mapped to this checklist.')

const wastewaterRounds: ChecklistTemplateDef = {
  id: 'ww-treatment-rounds', program: 'wastewater', name: 'Wastewater treatment system rounds',
  description: 'Check the on-site equipment that treats or controls wastewater before it leaves: pH adjustment, oil/water separators, grease interceptors, pumps, alarms and the chemicals that feed them.',
  subjectType: 'facility', cadence: 'monthly',
  appliesWhen: { wastewaterDischarge: ['potw_indirect', 'npdes_direct'] },
  citations: [SEWER_RULES_TO_MAP, PRETREATMENT_PH],
  items: [
    numericItem('ww-tr.ph', 'Discharge', 'pH of the discharge at the compliance point.', {
      cite: [PRETREATMENT_PH], numeric: { min: 5, unit: 'pH' }, failCreatesAction: true, critical: true, clauseRef: '6.1.3',
      guidance: 'The federal floor is 5.0. Your permit or sewer ordinance sets the full range (often 6 to 9, sometimes wider), so compare the reading with your own limits as well.',
    }),
    passFail('ww-tr.ph-probe', 'Discharge', 'pH probes were calibrated on the procedure\'s schedule and the calibration is logged.', {
      cite: [SEWER_RULES], failCreatesAction: true, clauseRef: '9.1.1',
    }),
    passFail('ww-tr.flow', 'Discharge', 'The flow meter or totalizer is working and today\'s reading was recorded.', {
      cite: [SEWER_RULES], failCreatesAction: true, clauseRef: '9.1.1',
    }),
    passFail('ww-tr.separator', 'Separators and interceptors', 'Oil/water separators, grease interceptors and sumps are not overloaded: the oil layer and the solids are below the cleanout level.', {
      cite: [SEWER_RULES], failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('ww-tr.chemicals', 'Treatment chemicals', 'Treatment chemical storage and feed areas have intact secondary containment and labels, and nothing is leaking.', {
      cite: [SEWER_RULES], failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('ww-tr.alarms', 'Treatment chemicals', 'Alarms, high-level switches and interlocks work (test them, or confirm the last test is on record).', {
      cite: [SEWER_RULES], failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('ww-tr.bypass', 'Bypass and solids', 'No treatment unit was bypassed, and no untreated process wastewater reached the sewer or an outfall.', {
      cite: [BYPASS], failCreatesAction: true, critical: true, clauseRef: '6.1.3',
    }),
    passFail('ww-tr.sludge', 'Bypass and solids', 'Sludge, solids and spent filters were removed and handled under a current waste determination, not rinsed to a drain.', {
      cite: [cite('40 CFR 262.11', 'Confirm that solids from wastewater treatment need a waste determination at this site.')],
      failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('ww-tr.log', 'Records', 'The operating log (readings, chemical additions, maintenance) is up to date.', {
      cite: [SEWER_RULES], failCreatesAction: false, clauseRef: '9.1.1',
    }),
    textItem('ww-tr.notes', 'Wrap-up', 'Anything unusual this period: batches, cleanouts, upsets, odors. Write "none" if none.', { cite: [SEWER_RULES], required: true }),
    photoItem('ww-tr.photo', 'Wrap-up', 'Photo of anything you flagged.', { cite: [SEWER_RULES], required: false }),
    signatureItem('ww-tr.sign', 'Wrap-up', 'Signature.', { cite: [SEWER_RULES], required: true }),
  ],
}

// ── Hazardous waste program and manifests ───────────────────────────────────

const GENERATOR = cite('40 CFR Part 262', 'Confirm the cited subsection against the current text; the generator rules were reorganized in 2016.')
const MANIFEST_RULE = cite('40 CFR 262.20-262.27', 'Confirm the subsection numbers against the current text.')

const hazardousWasteProgramReview: ChecklistTemplateDef = {
  id: 'hw-program-review', program: 'hazardous_waste', name: 'Hazardous waste program review',
  description: 'Once a year, step back from the weekly area walks and check the program itself: generator status, IDs, waste determinations, training, emergency readiness, shipping records.',
  subjectType: 'facility', cadence: 'annual',
  appliesWhen: { generatorCategory: ['lqg', 'sqg'] },
  citations: [GENERATOR],
  items: [
    passFail('hw-pr.category', 'Status and notification', 'Generator category was re-checked against the busiest month of the past year, and the hazardous waste module shows the right one.', {
      cite: [cite('40 CFR 262.13', 'Confirm: category is decided from the quantity generated in each calendar month, and a month above a threshold moves the site up for that month.')],
      failCreatesAction: true, clauseRef: '6.1.3',
      guidance: 'Large, small and very small quantity generators have different time limits, inspection duties and reporting. A one-time cleanout can change the category for that month.',
    }),
    passFail('hw-pr.epa-id', 'Status and notification', 'The EPA ID number is active, and the site details on file (name, address, contact) are current.', {
      cite: [cite('40 CFR 262.18')], failCreatesAction: true, clauseRef: '6.1.3',
    }),
    passFail('hw-pr.renotify', 'Status and notification', 'The required re-notification (EPA Form 8700-12) is filed on time. Large and small quantity generators re-notify every four years.', {
      cite: [cite('40 CFR 262.18(d)', 'Confirm the cycle and the next due date (the rule set September 1, 2021 and every fourth year after).')],
      failCreatesAction: true, clauseRef: '6.1.3',
    }),
    passFail('hw-pr.determinations', 'Waste determination', 'Every waste has a documented hazardous waste determination, reviewed when a process or raw material changes, and the records are kept at least three years.', {
      cite: [cite('40 CFR 262.11', 'Confirm the record-retention wording.')], failCreatesAction: true, critical: true, clauseRef: '6.1.3',
    }),
    passFail('hw-pr.training-lqg', 'Training and emergencies', 'Large quantity generator: personnel who handle hazardous waste have documented training for their jobs, and an annual review of it.', {
      cite: [cite('40 CFR 262.17(a)(7)', 'Confirm the training and annual-review wording.')],
      appliesWhen: { generatorCategory: ['lqg'] }, failCreatesAction: true, critical: true,
    }),
    passFail('hw-pr.training-sqg', 'Training and emergencies', 'Small quantity generator: employees are thoroughly familiar with proper waste handling and emergency procedures for their jobs.', {
      cite: [cite('40 CFR 262.16(b)(9)', 'Confirm the subsection that sets the small quantity generator training and emergency duties.')],
      appliesWhen: { generatorCategory: ['sqg'] }, failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('hw-pr.contingency-lqg', 'Training and emergencies', 'Large quantity generator: the contingency plan is current, copies went to local police, fire, hospitals and emergency response contractors, and an emergency coordinator is named.', {
      cite: [cite('40 CFR Part 262 Subpart M', 'Confirm the subpart and section numbers (262.250-262.265).')],
      appliesWhen: { generatorCategory: ['lqg'] }, failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('hw-pr.emergency-sqg', 'Training and emergencies', 'Small quantity generator: emergency information is posted by the phone (coordinator, fire department number, spill procedures).', {
      cite: [cite('40 CFR 262.16(b)(9)', 'Confirm the subsection that sets the small quantity generator emergency-information duties.')],
      appliesWhen: { generatorCategory: ['sqg'] }, failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('hw-pr.area-walks', 'Accumulation areas', 'The weekly walks of the central and satellite accumulation areas are recorded in the hazardous waste module, and none is overdue.', {
      cite: [cite('40 CFR 262.17(a)(1)(v)', 'Confirm; the weekly inspection duty is for large quantity generators, and small quantity generators have their own container-condition duties.')],
      failCreatesAction: true, clauseRef: '9.1.1',
    }),
    passFail('hw-pr.shipping-records', 'Shipping and records', 'Signed manifest copies are on file for every shipment in the last three years, and every missing return copy was followed up.', {
      cite: [cite('40 CFR 262.40(a)'), cite('40 CFR 262.42', 'Confirm the 35, 45 and 60 day steps.')],
      failCreatesAction: true, critical: true, clauseRef: '9.1.1',
    }),
    passFail('hw-pr.ldr', 'Shipping and records', 'A land disposal restriction notice or certification is on file for each restricted waste shipped.', {
      cite: [cite('40 CFR 268.7(a)')], failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('hw-pr.facilities', 'Shipping and records', 'Each disposal facility and transporter used is permitted or registered for the waste, and the approvals are current.', {
      cite: [cite('40 CFR 262.20(b); 262.12(c)', 'Confirm the generator\'s duty to use a permitted facility and a transporter with an EPA ID.')],
      failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('hw-pr.other-streams', 'Other waste streams', 'Universal waste (lamps, batteries, mercury equipment) and used oil are managed under their own rules, kept out of the hazardous waste containers, and universal waste is not held past one year.', {
      cite: [cite('40 CFR 273.15; 279.22', 'Confirm; states add universal waste categories and may change the time limit.')],
      failCreatesAction: true, clauseRef: '8.1',
    }),
    textItem('hw-pr.actions', 'Wrap-up', 'Corrective actions needed, who owns each and by when. Write "none" if none.', { cite: [GENERATOR], required: true }),
    signatureItem('hw-pr.sign', 'Wrap-up', 'Reviewer signature.', { cite: [GENERATOR], required: true }),
  ],
}

const manifestPreShipment: ChecklistTemplateDef = {
  id: 'manifest-pre-shipment', program: 'manifest', name: 'Pre-shipment check (hazardous waste)',
  description: 'Run through this before the transporter signs. It checks the waste, the packaging and the manifest paperwork. Start it from the Checklists page for each shipment.',
  subjectType: 'facility', cadence: 'once',
  appliesWhen: { generatorCategory: ['lqg', 'sqg'] },
  citations: [MANIFEST_RULE],
  items: [
    passFail('mf-ps.determination', 'The waste', 'Each waste in the load has a current hazardous waste determination, and the waste codes on the manifest match it.', {
      cite: [cite('40 CFR 262.11; 262.20(a)')], failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.containers', 'Packaging and marking', 'Containers are closed, in good condition, not leaking, and compatible with what is in them.', {
      cite: [cite('40 CFR 262.30; 49 CFR 173.24', 'Confirm the packaging citations.')], failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.labels', 'Packaging and marking', 'Each container carries the hazardous waste marking: the required words, the generator\'s name and address, the EPA ID, the manifest tracking number and the waste codes.', {
      cite: [cite('40 CFR 262.32(b)', 'Confirm the full marking list in the text now in effect.')],
      failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.dot-marking', 'Packaging and marking', 'DOT marking and labels (proper shipping name, UN/NA number, hazard class labels) are on each package, and the placards for the vehicle are in hand.', {
      cite: [cite('49 CFR Part 172 Subparts D-F', 'Confirm; the carrier usually supplies placards but the generator is responsible for correct marking and labeling.')],
      failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.ldr', 'The paperwork', 'For the first shipment of a restricted waste, or after a change, the land disposal restriction notice is attached for the disposal facility.', {
      cite: [cite('40 CFR 268.7(a)')], failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.ids', 'The paperwork', 'The generator, transporter and disposal facility EPA ID numbers are right, and the transporter and the facility are registered for this waste.', {
      cite: [cite('40 CFR 262.12(c); 262.20(b)')], failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.description', 'The paperwork', 'The DOT description (proper shipping name, hazard class, UN/NA number, packing group), quantities, units and container counts match what is on the dock.', {
      cite: [cite('40 CFR 262.20(a); 49 CFR 172.202')], failCreatesAction: true, critical: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.emergency-phone', 'The paperwork', 'A 24-hour emergency response phone number is on the manifest, and the person who answers has the information or the safety data sheets.', {
      cite: [cite('49 CFR 172.604')], failCreatesAction: true, clauseRef: '8.1',
    }),
    passFail('mf-ps.signed', 'The paperwork', 'The generator\'s authorized representative signed and dated the manifest before the transporter, and the generator\'s copy was kept.', {
      cite: [cite('40 CFR 262.23', 'Confirm the copy-distribution rule.')], failCreatesAction: true, critical: true, clauseRef: '9.1.1',
    }),
    textItem('mf-ps.tracking', 'The clock starts', 'Manifest tracking number and the date the transporter accepted the waste.', {
      cite: [cite('40 CFR 262.42', 'The return-copy clock counts from the date the waste was accepted. Confirm.')],
      required: true, clauseRef: '9.1.1',
      guidance: 'Record the shipment in the hazardous waste module too. It starts the 35, 45 and 60 day return-copy clocks for you.',
    }),
    photoItem('mf-ps.photo', 'The clock starts', 'Photo of the loaded shipment and the signed manifest.', { cite: [MANIFEST_RULE], required: false }),
    signatureItem('mf-ps.sign', 'The clock starts', 'Signature.', { cite: [MANIFEST_RULE], required: true }),
  ],
}

export const federalAirWasteChecklists: ChecklistTemplateDef[] = [
  airPermitWalkthrough, airEngineLog, wastewaterRounds, hazardousWasteProgramReview, manifestPreShipment,
]

// ── Deadlines ───────────────────────────────────────────────────────────────

export const federalAirWasteObligations: ObligationDef[] = [
  {
    id: 'air-fed-walkthrough', program: 'air', title: 'Air permit compliance walkthrough (quarterly)',
    description: 'Walk the permitted units and controls and check the permit\'s records at least once each quarter, or as often as the permit\'s monitoring terms require.',
    cadence: 'quarterly', anchor: { kind: 'period_end', period: 'quarter' }, leadDays: 14,
    citations: [PERMIT_TERMS],
    appliesWhen: { airPermitType: [...AIR_PERMITTED] },
    checklistTemplateId: 'air-permit-walkthrough', legalId: 'lr-fed-air-permits',
  },
  {
    id: 'air-fed-engine-log', program: 'air', title: 'Emergency engine hours and maintenance (quarterly)',
    description: 'Record each emergency engine\'s hours and check its maintenance once each quarter.',
    cadence: 'quarterly', anchor: { kind: 'period_end', period: 'quarter' }, leadDays: 14,
    citations: [ENGINE_HOURS_PLAIN],
    appliesWhen: { airPermitType: [...AIR_PERMITTED] },
    checklistTemplateId: 'air-engine-log', legalId: 'lr-fed-neshap-engines',
  },
  {
    id: 'ww-fed-treatment-rounds', program: 'wastewater', title: 'Wastewater treatment system rounds (monthly)',
    description: 'Check the pH, separators, chemical areas, alarms and flow records once each month.',
    cadence: 'monthly', anchor: { kind: 'period_end', period: 'month' }, leadDays: 7,
    citations: [SEWER_RULES],
    appliesWhen: { wastewaterDischarge: ['potw_indirect', 'npdes_direct'] },
    checklistTemplateId: 'ww-treatment-rounds',
  },
  {
    id: 'hw-fed-program-review', program: 'hazardous_waste', title: 'Hazardous waste program review (annual)',
    description: 'Review generator status, IDs, waste determinations, training, emergency readiness and shipping records once a year. This repeats a year from the day it is set up.',
    cadence: 'annual', anchor: { kind: 'rolling' }, leadDays: 30,
    citations: [GENERATOR],
    appliesWhen: { generatorCategory: ['lqg', 'sqg'] },
    checklistTemplateId: 'hw-program-review', legalId: 'lr-fed-rcra-generator',
  },
  {
    id: 'hw-fed-biennial-report', program: 'hazardous_waste', title: 'Submit the Biennial Hazardous Waste Report',
    description: 'Large quantity generators report the previous odd-numbered year\'s activity by March 1 of each even-numbered year. Many states ask for an annual report instead; if yours does, the state\'s deadline governs.',
    cadence: 'biennial', anchor: { kind: 'annual', month: 3, day: 1, yearParity: 'even' }, leadDays: 60,
    citations: [cite('40 CFR 262.41', 'Confirm the due date and reporting year, and the state\'s own schedule.')],
    appliesWhen: { generatorCategory: ['lqg'] },
    legalId: 'lr-fed-rcra-biennial',
  },
  {
    id: 'hw-fed-training-review', program: 'hazardous_waste', title: 'Annual review of hazardous waste training',
    description: 'Large quantity generators review the training of personnel who handle hazardous waste once a year and keep the record. This repeats a year from the day it is set up.',
    cadence: 'annual', anchor: { kind: 'rolling' }, leadDays: 30,
    citations: [cite('40 CFR 262.17(a)(7)', 'Confirm the annual-review wording.')],
    appliesWhen: { generatorCategory: ['lqg'] },
    legalId: 'lr-fed-rcra-training',
  },
  {
    id: 'epcra-fed-tier2', program: 'epcra', title: 'Submit the Tier II chemical inventory',
    description: 'Report last year\'s hazardous chemical inventory to the state, the local emergency planning committee and the fire department by March 1.',
    cadence: 'annual', anchor: { kind: 'annual', month: 3, day: 1 }, leadDays: 45,
    citations: [cite('EPCRA §312; 40 CFR 370.40', 'Confirm the due date and your state\'s submission system and fees.')],
    appliesWhen: { tier2: true },
    legalId: 'lr-fed-epcra-tier2',
  },
  {
    id: 'spcc-fed-plan-review', program: 'spcc', title: 'Review the SPCC plan (every five years)',
    description: 'Review the oil spill prevention plan at least every five years and amend it if the site changed. This repeats five years from the day it is set up, so set the date to the last review.',
    cadence: 'quinquennial', anchor: { kind: 'rolling' }, leadDays: 120,
    citations: [cite('40 CFR 112.5(b)', 'Confirm the five-year interval.')],
    appliesWhen: { spcc: true },
    legalId: 'lr-fed-spcc',
  },
  {
    id: 'spcc-fed-annual-briefing', program: 'spcc', title: 'Hold the annual oil spill prevention briefing',
    description: 'Brief the people who handle oil on how to prevent discharges, once a year, and keep a record. This repeats a year from the day it is set up.',
    cadence: 'annual', anchor: { kind: 'rolling' }, leadDays: 30,
    citations: [cite('40 CFR 112.7(f)(3)')],
    appliesWhen: { spcc: true },
    legalId: 'lr-fed-spcc',
  },
]

// ── Legal register ──────────────────────────────────────────────────────────

export const federalAirWasteLegal: LegalRequirementDef[] = [
  {
    id: 'lr-fed-air-permits', program: 'air', title: 'Air permits and preconstruction authorization',
    citation: 'Clean Air Act §110 and Title I; 40 CFR Parts 51, 52 and 70', authority: 'US EPA (administered by states and air districts)',
    summary: 'A source operates under the permit, registration or permit-by-rule its state or air district issued, within its limits, with the monitoring and records it requires. New or changed equipment generally needs authorization before it is built or run.',
    applicabilityNote: 'Applies to sites with an air permit or registration. The details live in the permit and in your state or district rules.',
    sourceUrl: 'https://www.epa.gov/clean-air-act-overview', reviewFrequency: 'annual',
    appliesWhen: { airPermitType: [...AIR_PERMITTED] },
    verify: 'Confirm the state or district preconstruction rules that apply to modifications and replacements.',
  },
  {
    id: 'lr-fed-npdes-individual', program: 'wastewater', title: 'NPDES permit conditions, monitoring and reporting',
    citation: '40 CFR 122.41', authority: 'US EPA (administered by states)',
    summary: 'A site that discharges wastewater to a water of the United States follows its permit: sampling at the stated frequency, discharge monitoring reports on the dates in the permit, and prompt reports of noncompliance that could endanger health or the environment.',
    applicabilityNote: 'Applies to direct dischargers. Report dates and limits are in your permit, not in this register.',
    sourceUrl: 'https://www.ecfr.gov/current/title-40/section-122.41', reviewFrequency: 'annual',
    appliesWhen: { wastewaterDischarge: ['npdes_direct'] },
    verify: 'Confirm the monitoring, reporting and 24-hour notice conditions in 122.41(j), (l) and your permit.',
  },
  {
    id: 'lr-fed-rcra-training', program: 'hazardous_waste', title: 'Hazardous waste personnel training',
    citation: '40 CFR 262.17(a)(7) (large quantity); 262.16(b)(9) (small quantity)', authority: 'US EPA (RCRA)',
    summary: 'People who handle hazardous waste are trained for their jobs. Large quantity generators document the training and review it every year; small quantity generators make sure employees are thoroughly familiar with handling and emergency procedures.',
    applicabilityNote: 'Applies to large and small quantity generators.',
    sourceUrl: 'https://www.ecfr.gov/current/title-40/part-262', reviewFrequency: 'annual',
    appliesWhen: { generatorCategory: ['lqg', 'sqg'] },
    verify: 'Confirm the subsection numbers and the annual-review wording.',
  },
  {
    id: 'lr-fed-rcra-notification', program: 'hazardous_waste', title: 'EPA ID number and re-notification',
    citation: '40 CFR 262.18', authority: 'US EPA (RCRA)',
    summary: 'A generator has an EPA ID number before it ships waste, keeps its site information current, and large and small quantity generators re-notify every four years.',
    applicabilityNote: 'Applies to every generator that ships hazardous waste. Re-notification applies to large and small quantity generators.',
    sourceUrl: 'https://www.ecfr.gov/current/title-40/section-262.18', reviewFrequency: 'annual',
    verify: 'Confirm the re-notification cycle and the next due date, and whether the state uses its own form or portal.',
  },
  {
    id: 'lr-fed-rcra-ldr', program: 'hazardous_waste', title: 'Land disposal restrictions: notices and certifications',
    citation: '40 CFR 268.7', authority: 'US EPA (RCRA)',
    summary: 'A generator tells the disposal facility, in writing, which treatment standards a restricted waste must meet. The notice goes with the first shipment and again when the waste or the process changes, and a copy is kept.',
    applicabilityNote: 'Applies to generators of waste with land disposal restrictions; most listed and characteristic wastes have them.',
    sourceUrl: 'https://www.ecfr.gov/current/title-40/section-268.7', reviewFrequency: 'annual',
    verify: 'Confirm what must be re-sent and the record-retention period.',
  },
  {
    id: 'lr-fed-rcra-emergency', program: 'hazardous_waste', title: 'Emergency preparedness for hazardous waste',
    citation: '40 CFR Part 262 Subpart M (large quantity); 262.16(b)(9) (small quantity)', authority: 'US EPA (RCRA)',
    summary: 'Large quantity generators keep a contingency plan, give it to local responders and name an emergency coordinator. Small quantity generators post emergency information by the phone and name an emergency coordinator.',
    applicabilityNote: 'Applies to large and small quantity generators.',
    sourceUrl: 'https://www.ecfr.gov/current/title-40/part-262/subpart-M', reviewFrequency: 'annual',
    appliesWhen: { generatorCategory: ['lqg', 'sqg'] },
    verify: 'Confirm the section numbers (262.250-262.265) and what a small quantity generator must post.',
  },
  {
    id: 'lr-fed-universal-waste', program: 'hazardous_waste', title: 'Universal waste (batteries, lamps, mercury equipment, pesticides)',
    citation: '40 CFR Part 273', authority: 'US EPA (RCRA)',
    summary: 'Common wastes like batteries, fluorescent lamps and mercury-containing equipment can be handled under simpler rules: labeled, kept closed, held no longer than one year, and sent to a universal waste handler or recycler.',
    applicabilityNote: 'Applies to sites that generate these wastes. States add categories and may shorten the time limit.',
    sourceUrl: 'https://www.ecfr.gov/current/title-40/part-273', reviewFrequency: 'annual',
    verify: 'Confirm the categories and the one-year limit, and the state\'s additions.',
  },
  {
    id: 'lr-fed-used-oil', program: 'hazardous_waste', title: 'Used oil management',
    citation: '40 CFR Part 279', authority: 'US EPA (RCRA)',
    summary: 'Used oil is kept in containers marked "Used Oil" that are in good condition, is not mixed with hazardous waste, and goes to a transporter or recycler with an EPA ID. Spills are cleaned up.',
    applicabilityNote: 'Applies to sites that generate used oil.',
    sourceUrl: 'https://www.ecfr.gov/current/title-40/part-279', reviewFrequency: 'annual',
    verify: 'Confirm; used oil mixed with hazardous waste or tested above the rebuttable-presumption levels is regulated differently.',
  },
  {
    id: 'lr-fed-dot-hazmat', program: 'manifest', title: 'Shipping hazardous materials: DOT rules',
    citation: '49 CFR Parts 171-180 (marking, labeling, placarding, shipping papers, training)', authority: 'US DOT (PHMSA)',
    summary: 'Anyone who prepares hazardous waste for transport follows DOT\'s packaging, marking, labeling and shipping-paper rules, and employees who do that work are trained and retrained on a set schedule.',
    applicabilityNote: 'Applies to every hazardous waste shipment off site.',
    sourceUrl: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-C', reviewFrequency: 'annual',
    verify: 'Confirm the hazmat employee training interval (every three years) and who counts as a hazmat employee.',
  },
]

// ── How-to guides ───────────────────────────────────────────────────────────

export const federalAirWasteGuides: GuideDef[] = [
  {
    id: 'guide-air', program: 'air', title: 'Air permits: what to keep an eye on',
    pageKeys: ['checklists', 'checklist-run'],
    quickSteps: [
      'Open the air permit walkthrough and answer each question from the permit and the logs, not from memory.',
      'Anything outside a permit limit, or any equipment that changed, is a finding: fail the question and say what you saw.',
      'Do the emergency engine log each quarter and keep hours for testing and real emergencies apart.',
    ],
    sections: [
      {
        id: 'permit-basics', title: 'What an air permit asks of you',
        paragraphs: [
          'An air permit or registration lists the equipment you may run, the limits on it (hours, throughput, fuel, emissions), how you must monitor it and which records you must keep.',
          'Most trouble comes from three places: equipment that changed without authorization, limits that were passed without anyone noticing, and records that are missing when an inspector asks.',
        ],
        bullets: [
          'Map each permit condition to a question once, then the checklist does the remembering for you.',
          'Log deviations when they happen. Reporting late is a bigger problem than the deviation.',
          'Keep records as long as the permit says, and at least five years for a Title V permit.',
        ],
        citations: [PERMIT_TERMS, cite('40 CFR 70.6(a)(3)(ii)(B)')],
      },
      {
        id: 'engines', title: 'Emergency generators and fire pumps',
        paragraphs: [
          'Emergency engines may run for real emergencies without a limit, but only for a set number of hours a year for maintenance checks and readiness testing. Every hour needs a record of why it ran.',
        ],
        bullets: [
          'Read the hour meter at every test and write the reading in the log.',
          'Do not run an emergency engine for peak shaving or to cover a planned outage unless the rule and your permit allow it.',
          'Your state or district may set a lower limit than the federal 100 hours.',
        ],
        citations: [ENGINE_HOURS_PLAIN],
      },
    ],
  },
  {
    id: 'guide-wastewater-rounds', program: 'wastewater', title: 'Wastewater rounds and sewer discharge',
    pageKeys: ['checklists', 'checklist-run'],
    quickSteps: [
      'Check pH, separators, chemical areas, alarms and flow readings on the rounds checklist each month.',
      'A pH under 5.0, an untreated bypass or a dead alarm is a critical finding: fail it and call your supervisor.',
      'Keep the operating log current. Sampling results go in the monitoring page, not only on paper.',
    ],
    sections: [
      {
        id: 'rounds', title: 'What good rounds look like',
        paragraphs: [
          'The point of the rounds is to catch the quiet failures: a probe that drifted, a separator that filled, an alarm that no longer sounds. Each takes minutes to find and days to explain to an agency after a violation.',
        ],
        bullets: [
          'Compare the pH reading with your own permit range, not only the federal floor of 5.0.',
          'Test alarms, or confirm the last test is on record.',
          'Treat solids from separators and filters as a waste that needs a determination.',
        ],
        citations: [cite('40 CFR 403.5(b)(2)'), SEWER_RULES],
      },
    ],
  },
  {
    id: 'guide-hazardous-waste-manifests', program: 'manifest', title: 'Hazardous waste shipments and manifests',
    pageKeys: ['checklists', 'checklist-run'],
    quickSteps: [
      'Run the pre-shipment check before the transporter signs.',
      'Record the shipment in the hazardous waste module on the day the waste leaves: that starts the return-copy clock.',
      'Chase a missing signed copy at day 35 (large generators) and file an exception report at day 45, or day 60 for small generators.',
    ],
    sections: [
      {
        id: 'clock', title: 'The return-copy clock',
        paragraphs: [
          'After a shipment leaves, the disposal facility sends back a signed copy of the manifest. If it does not come, the generator has to act: follow up, and after a set number of days file an exception report with the regulator.',
          'Large quantity generators follow up at 35 days and file at 45. Small quantity generators file at 60. Some states treat very small generators like small ones.',
        ],
        bullets: [
          'Day zero is the date the transporter accepted the waste.',
          'Keep every manifest and its signed copy for three years.',
          'The hazardous waste module shows each open shipment with its day count.',
        ],
        citations: [cite('40 CFR 262.42', 'Confirm the day counts and the state variations.'), cite('40 CFR 262.40(a)', 'Confirm the three-year retention.')],
      },
    ],
  },
]
