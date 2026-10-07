// The federal baseline: EPA programs that apply everywhere, plus the EPA
// Multi-Sector General Permit (MSGP) stormwater practices as a REFERENCE
// baseline.
//
// IMPORTANT: the MSGP legally applies only where EPA is the permitting authority
// (a few states, territories and tribal lands). Everywhere else the state's own
// permit governs: California and Texas replace this stormwater content with their
// own (see ca.ts, tx.ts), and any other state sees this under a banner saying it
// is a reference, not that state's rule.
//
// STATUS: DRAFT. Not yet confirmed against current regulatory text by a Certified
// Safety Professional. Items marked `verify` are specific claims written from
// recollection of the rule; they are marked so the reviewer knows exactly what to
// check. Where a permit or regulation leaves the deadline to the permit itself
// (Title V certifications, SPCC reviews), the item is in the legal register, not
// the calendar, rather than carrying an invented date.

import type { JurisdictionPack } from '../content'
import { federalGuides } from './guides'
import { cite, passFail, photoItem, signatureItem, textItem } from './helpers'

const MSGP_VERIFY =
  'The 2021 MSGP expired 2026-02-28. Confirm which EPA MSGP (or administrative continuance) is in effect, and that this part number still matches it.'

const MSGP_3_1 = [cite('EPA 2021 MSGP Part 3.1 (routine facility inspections)', MSGP_VERIFY)]
const MSGP_3_2 = [cite('EPA 2021 MSGP Part 3.2 (quarterly visual assessment)', MSGP_VERIFY)]
const CWA = cite('Clean Water Act §402(p); 40 CFR 122.26', undefined, 'Industrial stormwater discharges')

const NSWD =
  'Discharges other than stormwater are generally prohibited unless an allowable non-stormwater discharge; flow from an outfall in dry weather is the usual sign.'

export const federalPack: JurisdictionPack = {
  meta: {
    jurisdiction: 'federal', version: '0.1.0', draftedOn: '2026-10-07', lastVerified: null,
    status: 'draft', reviewer: null,
    notes: 'Federal baseline. Stormwater content is the EPA MSGP reference baseline; see the header.',
  },

  checklists: {
    add: [
      {
        id: 'sw-routine-inspection', program: 'stormwater', name: 'Routine facility inspection (stormwater)',
        description: 'A walk of the industrial areas: exposed materials, stormwater controls, housekeeping and any non-stormwater discharges.',
        subjectType: 'facility', cadence: 'quarterly',
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit'] },
        citations: [...MSGP_3_1, CWA],
        items: [
          passFail('sw-ri.qualified', 'Before you start', 'Inspector is familiar with the facility, its stormwater controls and its SWPPP.', {
            cite: MSGP_3_1, failCreatesAction: false, clauseRef: '9.1.1',
            guidance: 'The permit asks for qualified personnel. Name them in the SWPPP so an auditor can match them to this record.',
          }),
          passFail('sw-ri.exposed-materials', 'Exposed areas and materials', 'Materials, wastes and products kept outside are covered or contained, with no leaking or open containers.', {
            cite: MSGP_3_1, failCreatesAction: true, critical: true, clauseRef: '8.1',
            guidance: 'Look at loading and unloading areas, waste and dumpster areas, drum storage and anywhere product can be rained on.',
          }),
          passFail('sw-ri.spills', 'Exposed areas and materials', 'No evidence of spills, leaks or staining; residues have been cleaned up.', {
            cite: MSGP_3_1, failCreatesAction: true, critical: true, clauseRef: '8.1',
          }),
          passFail('sw-ri.spill-kits', 'Exposed areas and materials', 'Spill kits are stocked and reachable near fueling, loading and storage areas.', {
            cite: MSGP_3_1, failCreatesAction: true, clauseRef: '8.1',
          }),
          passFail('sw-ri.controls', 'Stormwater controls', 'Structural controls (berms, drain covers, filters, sediment traps, containment) are in place and working.', {
            cite: MSGP_3_1, failCreatesAction: true, clauseRef: '8.1',
          }),
          passFail('sw-ri.inlets', 'Stormwater controls', 'Storm drain inlets and catch basins are free of debris and sediment build-up.', {
            cite: MSGP_3_1, failCreatesAction: true, clauseRef: '8.1',
          }),
          passFail('sw-ri.housekeeping', 'Stormwater controls', 'Housekeeping is adequate: trash, dust and tracked-out material are controlled.', {
            cite: MSGP_3_1, failCreatesAction: true, clauseRef: '8.1',
          }),
          passFail('sw-ri.nswd', 'Non-stormwater discharges', 'No unauthorized non-stormwater discharge observed (wash water, process water, leaks to the storm drain).', {
            cite: [...MSGP_3_1, CWA], failCreatesAction: true, critical: true, clauseRef: '6.1.3', guidance: NSWD,
          }),
          textItem('sw-ri.actions', 'Wrap-up', 'Corrective actions needed, who owns each, and by when. Write "none" if none.', {
            cite: MSGP_3_1, required: true, clauseRef: '9.1.1',
          }),
          photoItem('sw-ri.photo', 'Wrap-up', 'Photo of any issue found (or of the area, if none).', { cite: MSGP_3_1, required: false }),
          signatureItem('sw-ri.sign', 'Wrap-up', 'Inspector signature.', { cite: MSGP_3_1, required: true }),
        ],
      },
      {
        id: 'sw-quarterly-visual', program: 'stormwater', name: 'Quarterly visual assessment of stormwater discharge',
        description: 'Look at a sample of discharge from each outfall and record what you see. This is observation, not lab analysis.',
        subjectType: 'outfall', cadence: 'quarterly',
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit'] },
        citations: [...MSGP_3_2, CWA],
        items: [
          passFail('sw-qva.storm-event', 'Sample conditions', 'The sample is from a discharge caused by a measurable storm event.', {
            cite: MSGP_3_2, clauseRef: '9.1.1', failCreatesAction: false,
            guidance: 'If no qualifying event occurred this quarter, answer N/A and say why in the notes. Do not skip the quarter without a reason on record.',
          }),
          passFail('sw-qva.72h', 'Sample conditions', 'At least 72 hours have passed since the previous measurable storm event.', {
            cite: [cite('EPA 2021 MSGP Part 3.2 / Appendix', 'Confirm the interval the current permit requires between storm events.')],
            clauseRef: '9.1.1', failCreatesAction: false,
          }),
          passFail('sw-qva.timing', 'Sample conditions', 'The sample was collected within the first 30 minutes of discharge (and no later than 1 hour).', {
            cite: [cite('EPA 2021 MSGP Part 3.2', 'Confirm the collection window the current permit requires.')],
            clauseRef: '9.1.1', failCreatesAction: false,
          }),
          passFail('sw-qva.color', 'What you see', 'Color: no unusual color.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.odor', 'What you see', 'Odor: none.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.clarity', 'What you see', 'Clarity: not cloudy or turbid.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.floating', 'What you see', 'Floating solids: none.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.settled', 'What you see', 'Settled solids: none after the sample has stood.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.suspended', 'What you see', 'Suspended solids: none.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.foam', 'What you see', 'Foam: none.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.sheen', 'What you see', 'Oil sheen: none.', { cite: MSGP_3_2, failCreatesAction: true, critical: true, clauseRef: '9.1.1' }),
          passFail('sw-qva.other', 'What you see', 'No other obvious indicator of stormwater pollution.', { cite: MSGP_3_2, failCreatesAction: true, clauseRef: '9.1.1' }),
          textItem('sw-qva.record', 'Record', 'Date and time of the sample, and the date of the last measurable storm before it.', {
            cite: MSGP_3_2, required: true, clauseRef: '9.1.1',
          }),
          photoItem('sw-qva.photo', 'Record', 'Photo of the sample jar against a white background.', { cite: MSGP_3_2, required: false }),
          signatureItem('sw-qva.sign', 'Record', 'Assessor signature.', { cite: MSGP_3_2, required: true }),
        ],
      },
      {
        id: 'of-inspection', program: 'outfall', name: 'Outfall inspection',
        description: 'Check one outfall: its structure, whether anything is flowing in dry weather, and whether the discharge or receiving water looks wrong.',
        subjectType: 'outfall', cadence: 'quarterly',
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit'] },
        citations: [...MSGP_3_1, CWA],
        items: [
          passFail('of.marker', 'The outfall', 'The outfall is identifiable and matches its ID on the site map.', {
            cite: MSGP_3_1, failCreatesAction: false, clauseRef: '9.1.1',
          }),
          passFail('of.structure', 'The outfall', 'Structure is intact: no erosion, cracking, blockage or damage to the pipe, headwall or energy dissipation.', {
            cite: MSGP_3_1, failCreatesAction: true, clauseRef: '8.1',
          }),
          passFail('of.dry-flow', 'What is coming out', 'No flow in dry weather (no measurable rain for at least 72 hours).', {
            cite: [...MSGP_3_1, CWA], failCreatesAction: true, critical: true, clauseRef: '6.1.3',
            guidance: 'Flow in dry weather is a possible non-stormwater discharge. Fail this item, then find the source before it is assumed to be allowable. ' + NSWD,
          }),
          passFail('of.discharge-clean', 'What is coming out', 'No stain, sheen, foam, odor or floating material at or below the outfall.', {
            cite: [...MSGP_3_1, CWA], failCreatesAction: true, critical: true, clauseRef: '8.1',
          }),
          passFail('of.receiving', 'The receiving water', 'No visible impact on the receiving water (discoloration, sheen, dead vegetation).', {
            cite: MSGP_3_1, failCreatesAction: true, critical: true, clauseRef: '8.1',
          }),
          passFail('of.access', 'Sampling', 'The sampling point is accessible and safe to use.', {
            cite: MSGP_3_1, failCreatesAction: true, clauseRef: '9.1.1',
          }),
          textItem('of.last-rain', 'Record', 'Date of the last measurable rainfall.', { cite: MSGP_3_1, required: true, clauseRef: '9.1.1' }),
          photoItem('of.photo', 'Record', 'Photo of the outfall.', { cite: MSGP_3_1, required: true }),
          signatureItem('of.sign', 'Record', 'Inspector signature.', { cite: MSGP_3_1, required: true }),
        ],
      },
      {
        id: 'ww-ciu-prohibited-discharge', program: 'wastewater', name: 'Sewer discharge check (pretreatment)',
        description: 'Confirm nothing prohibited is going to the sewer and that the sampling and slug-control basics are in order.',
        subjectType: 'facility', cadence: 'monthly',
        appliesWhen: { wastewaterDischarge: ['potw_indirect'], pretreatment: ['siu', 'ciu'] },
        citations: [cite('40 CFR 403.5(b)', 'Confirm the prohibited-discharge list, and the local limits set by your POTW, which can be stricter.')],
        items: [
          passFail('ww.ph', 'Discharge', 'Wastewater pH has stayed within your POTW\'s limits (federal floor is 5.0 or above).', {
            cite: [cite('40 CFR 403.5(b)(2)', 'Confirm; local limits may differ.')], failCreatesAction: true, critical: true, clauseRef: '6.1.3',
          }),
          passFail('ww.flash', 'Discharge', 'No ignitable or flammable material (flash point under 140 °F) was sent to the sewer.', {
            cite: [cite('40 CFR 403.5(b)(1)', 'Confirm the threshold in the current rule.')], failCreatesAction: true, critical: true, clauseRef: '6.1.3',
          }),
          passFail('ww.slug', 'Slug control', 'Slug-control measures (containment, valves, procedures) are in place and the spill plan is current.', {
            cite: [cite('40 CFR 403.8(f)(2)(vi); 403.12(f)', 'Confirm applicability to this user category.')], failCreatesAction: true, clauseRef: '8.1',
          }),
          passFail('ww.sampling', 'Monitoring', 'Required sampling for this period was collected on schedule and results are on file.', {
            cite: [cite('40 CFR 403.12(e)', 'Confirm sampling frequency in your discharge permit.')], failCreatesAction: true, clauseRef: '9.1.1',
          }),
          textItem('ww.notes', 'Record', 'Anything unusual this period (batches, cleanouts, upsets). Write "none" if none.', { cite: [cite('40 CFR 403.12(f)')], required: true }),
          signatureItem('ww.sign', 'Record', 'Signature.', { cite: [cite('40 CFR 403.12(l)', 'Confirm signatory requirements.')], required: true }),
        ],
      },
    ],
  },

  obligations: {
    add: [
      {
        id: 'sw-fed-annual-report', program: 'stormwater', title: 'Submit the MSGP annual report',
        description: 'The annual report to EPA for facilities covered by the MSGP, submitted electronically through NeT.',
        cadence: 'annual', anchor: { kind: 'annual', month: 1, day: 30 }, leadDays: 30,
        citations: [cite('EPA 2021 MSGP Part 7 (annual report)', MSGP_VERIFY)],
        appliesWhen: { stormwaterCoverage: ['general_permit'] },
        legalId: 'lr-fed-msgp',
      },
      {
        id: 'sw-fed-swppp-review', program: 'stormwater', title: 'Review and update the SWPPP',
        description: 'Review the stormwater pollution prevention plan at least once a year and whenever the site, its activities or its controls change. This repeats a year from the day it is set up.',
        cadence: 'annual', anchor: { kind: 'rolling' }, leadDays: 30,
        citations: [cite('EPA 2021 MSGP Part 5 (SWPPP)', MSGP_VERIFY)],
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit'] },
      },
      {
        id: 'sw-fed-routine-inspection', program: 'stormwater', title: 'Routine facility inspection (quarterly)',
        description: 'Complete the routine facility inspection checklist at least once each quarter.',
        cadence: 'quarterly', anchor: { kind: 'period_end', period: 'quarter' }, leadDays: 14,
        citations: MSGP_3_1,
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit'] },
        checklistTemplateId: 'sw-routine-inspection',
      },
      {
        id: 'sw-fed-quarterly-visual', program: 'stormwater', title: 'Quarterly visual assessment of discharges',
        description: 'Complete the visual assessment for each outfall once each quarter.',
        cadence: 'quarterly', anchor: { kind: 'period_end', period: 'quarter' }, leadDays: 14,
        citations: MSGP_3_2,
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit'] },
        checklistTemplateId: 'sw-quarterly-visual',
      },
      {
        id: 'ww-fed-ciu-report', program: 'wastewater', title: 'Submit the periodic compliance report to the POTW',
        description: 'Industrial users covered by categorical pretreatment standards report on their discharge twice a year, unless the POTW requires more often.',
        cadence: 'semiannual', anchor: { kind: 'period_end', period: 'half' }, leadDays: 30,
        citations: [cite('40 CFR 403.12(e)', 'Confirm the reporting months and any deadline your POTW sets in your permit.')],
        appliesWhen: { pretreatment: ['ciu'] },
        legalId: 'lr-fed-pretreatment',
      },
    ],
  },

  legal: {
    add: [
      {
        id: 'lr-fed-cwa-stormwater', program: 'stormwater', title: 'Industrial stormwater discharges (NPDES)',
        citation: 'Clean Water Act §402(p); 40 CFR 122.26', authority: 'US EPA',
        summary: 'Stormwater discharges from certain industrial activities need permit coverage, or a no-exposure exclusion, and a plan to keep pollutants out of runoff.',
        applicabilityNote: 'Depends on the facility\'s industrial activity (SIC code) and whether materials are exposed to rain. Food manufacturing is usually a light-industry sector that needs coverage only where there is exposure; otherwise a No Exposure Certification applies.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-122/section-122.26', reviewFrequency: 'annual',
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit', 'no_exposure'] },
        verify: 'Confirm the sector and the light-industry/no-exposure treatment for this facility\'s SIC code.',
      },
      {
        id: 'lr-fed-msgp', program: 'stormwater', title: 'EPA Multi-Sector General Permit (MSGP)',
        citation: 'EPA NPDES Multi-Sector General Permit for Stormwater Discharges Associated with Industrial Activity', authority: 'US EPA',
        summary: 'The general permit most industrial stormwater dischargers use where EPA is the permitting authority: a SWPPP, routine inspections, quarterly visual assessments, monitoring and an annual report.',
        applicabilityNote: 'Applies only where EPA is the permitting authority. California and Texas run their own programs (see their entries).',
        sourceUrl: 'https://www.epa.gov/npdes/stormwater-discharges-industrial-activities', reviewFrequency: 'annual',
        appliesWhen: { stormwaterCoverage: ['general_permit'] },
        verify: MSGP_VERIFY,
      },
      {
        id: 'lr-fed-rcra-generator', program: 'hazardous_waste', title: 'Hazardous waste generator standards',
        citation: '40 CFR Part 262', authority: 'US EPA (RCRA)',
        summary: 'Rules for anyone who generates hazardous waste: waste determination, generator category, EPA ID, accumulation limits and time, container management, inspections, manifests, training, recordkeeping and reporting.',
        applicabilityNote: 'Applies to every generator; how much depends on category (large, small or very small quantity generator).',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-262', reviewFrequency: 'annual',
      },
      {
        id: 'lr-fed-rcra-saa', program: 'hazardous_waste', title: 'Satellite accumulation of hazardous waste',
        citation: '40 CFR 262.15', authority: 'US EPA (RCRA)',
        summary: 'Up to 55 gallons of hazardous waste (or 1 quart of acute) may be kept at or near the point of generation under the operator\'s control; containers must be closed, marked and labeled, and any excess moved to the central area within three consecutive calendar days.',
        applicabilityNote: 'Applies to generators that use satellite accumulation areas.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-262/section-262.15', reviewFrequency: 'annual',
        verify: 'Confirm the container-condition and marking wording in the current text.',
      },
      {
        id: 'lr-fed-rcra-caa', program: 'hazardous_waste', title: 'Central accumulation area: time limits and inspections',
        citation: '40 CFR 262.16(b) (small quantity); 262.17(a) (large quantity)', authority: 'US EPA (RCRA)',
        summary: 'Large quantity generators may accumulate for up to 90 days and small quantity generators for up to 180 days (270 if the disposal facility is 200 miles or more away), with weekly inspections of the accumulation area.',
        applicabilityNote: 'Depends on generator category.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-262/section-262.17', reviewFrequency: 'annual',
        appliesWhen: { generatorCategory: ['lqg', 'sqg'] },
        verify: 'Confirm the weekly-inspection citation for each category.',
      },
      {
        id: 'lr-fed-rcra-manifest', program: 'manifest', title: 'Hazardous waste manifest, return copies and exception reports',
        citation: '40 CFR 262.20-262.27, 262.40, 262.42', authority: 'US EPA (RCRA)',
        summary: 'Waste shipped off site travels on a manifest. A generator that has not received the signed copy back follows up (35 days for large quantity generators) and files an exception report (45 days large, 60 days small), and keeps manifest records for three years.',
        applicabilityNote: 'Applies to generators that ship waste off site; the day counts depend on category.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-262/subpart-B', reviewFrequency: 'annual',
        appliesWhen: { generatorCategory: ['lqg', 'sqg'] },
      },
      {
        id: 'lr-fed-rcra-biennial', program: 'hazardous_waste', title: 'Biennial hazardous waste report (large quantity generators)',
        citation: '40 CFR 262.41', authority: 'US EPA (RCRA)',
        summary: 'Large quantity generators report on the prior odd-numbered year\'s activity by March 1 of each even-numbered year. Many states require an annual report instead.',
        applicabilityNote: 'Large quantity generators. Check whether your state requires annual reporting.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-262/section-262.41', reviewFrequency: 'annual',
        appliesWhen: { generatorCategory: ['lqg'] },
        verify: 'Confirm the due date and reporting year, and the state\'s own schedule.',
      },
      {
        id: 'lr-fed-epcra-tier2', program: 'epcra', title: 'EPCRA Tier II chemical inventory',
        citation: 'EPCRA §312; 40 CFR Part 370', authority: 'US EPA',
        summary: 'Facilities holding hazardous chemicals above threshold quantities report inventories each year to the state emergency response commission, the local emergency planning committee and the fire department by March 1.',
        applicabilityNote: 'Thresholds depend on the chemical (generally 10,000 lb; lower for extremely hazardous substances).',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-370', reviewFrequency: 'annual',
        appliesWhen: { tier2: true },
      },
      {
        id: 'lr-fed-spcc', program: 'spcc', title: 'Oil spill prevention (SPCC)',
        citation: '40 CFR Part 112', authority: 'US EPA',
        summary: 'Facilities that store more than 1,320 gallons of oil above ground (counting containers of 55 gallons or more), or more than 42,000 gallons below ground, and could reach navigable water need a written plan, secondary containment, inspections, annual personnel briefings and a plan review at least every five years.',
        applicabilityNote: 'Applies to the oil storage on site, including fuel, lubricants and hydraulic oil.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-112', reviewFrequency: 'annual',
        appliesWhen: { spcc: true },
        verify: 'Confirm the aggregate-capacity thresholds and review interval in the current text.',
      },
      {
        id: 'lr-fed-title-v', program: 'air', title: 'Title V operating permit program',
        citation: '40 CFR Part 70', authority: 'US EPA (administered by states)',
        summary: 'Major sources of air pollution hold an operating permit and certify their compliance every year, with monitoring reports at least every six months. Dates are set by the permit.',
        applicabilityNote: 'Applies to major sources. Track the specific dates in your permit; they are not fixed by the rule.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-70', reviewFrequency: 'annual',
        appliesWhen: { airPermitType: ['title_v'] },
      },
      {
        id: 'lr-fed-neshap-engines', program: 'air', title: 'Emergency engine limits (NESHAP for stationary engines)',
        citation: '40 CFR Part 63 Subpart ZZZZ', authority: 'US EPA',
        summary: 'Emergency generators and fire-pump engines have limits on hours of use for maintenance and testing, hour-meter and records requirements, and maintenance schedules.',
        applicabilityNote: 'Applies to stationary reciprocating engines at the facility; check each engine\'s size, age and use.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-63/subpart-ZZZZ', reviewFrequency: 'annual',
        appliesWhen: { airPermitType: ['registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] },
        verify: 'Confirm which engines are covered and the current hour limits; the rule has been amended several times.',
      },
      {
        id: 'lr-fed-pretreatment', program: 'wastewater', title: 'General pretreatment standards',
        citation: '40 CFR Part 403', authority: 'US EPA',
        summary: 'Industrial users that send wastewater to a public sewer must not discharge prohibited pollutants (including ignitable material and extreme pH), meet any local limits, and, if regulated, report periodically and control slug discharges.',
        applicabilityNote: 'Applies to indirect dischargers; the strictest limits come from your POTW\'s local limits and your discharge permit.',
        sourceUrl: 'https://www.ecfr.gov/current/title-40/part-403', reviewFrequency: 'annual',
        appliesWhen: { wastewaterDischarge: ['potw_indirect'] },
      },
    ],
  },

  guides: { add: federalGuides },
}
