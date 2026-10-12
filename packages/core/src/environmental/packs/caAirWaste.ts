// California's changes to the federal air, wastewater, hazardous waste and
// manifest content (federalAirWaste.ts). Kept apart from ca.ts for readability;
// ca.ts spreads these into the California pack.
//
// STATUS: DRAFT. Everything California-specific here was written from
// recollection of the rule and carries a `verify` note.

import type { ChecklistItemDef, LegalRequirementDef, Overlay } from '../content'
import { cite, passFail } from './helpers'

const AIR_PERMITTED = ['registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] as const

const ATCM_VERIFY =
  'California\'s airborne toxic control measure for stationary diesel engines sets its own limit on hours for maintenance and testing (recalled as 50 a year; some districts allow fewer). Confirm the limit that applies to each engine in its district permit.'

/**
 * California's tighter engine-hours limit replaces the federal 100, on the same question.
 * The fail-safe direction: a site under California's lower limit is asked about it, and a
 * site that is under the lower number is under the federal one too.
 */
export const caEngineLogItems: Overlay<ChecklistItemDef> = {
  patch: [
    {
      id: 'air-eng.testing-hours',
      fields: {
        numeric: { max: 50, unit: 'hours' },
        citations: [cite('17 CCR §93115 (airborne toxic control measure for stationary compression ignition engines)', ATCM_VERIFY)],
        guidance: 'Real emergencies do not count toward this limit, so keep them separate. California\'s engine rule limits maintenance and testing hours below the federal 100, and your district permit may set fewer.',
      },
    },
  ],
}

export const caManifestItems: Overlay<ChecklistItemDef> = {
  add: [
    passFail('mf-ps.ca-dtsc', 'The paperwork', 'California: the state\'s extra manifest steps are in hand: the copy that goes to DTSC and any manifest fee, on the schedule DTSC sets.', {
      cite: [cite('22 CCR Division 4.5, Chapter 12 (generator standards); DTSC manifest instructions', 'California requires a copy of each paper manifest to go to DTSC within a set number of days after shipment (30 is the figure recalled). Confirm the current rule and whether e-Manifest submission satisfies it.')],
      failCreatesAction: true, clauseRef: '9.1.1', placeAfter: 'mf-ps.signed',
    }),
  ],
}

export const caAirWasteLegal: LegalRequirementDef[] = [
  {
    id: 'lr-ca-hw-manifest', program: 'manifest', title: 'California manifest requirements',
    citation: '22 CCR Division 4.5, Chapter 12; Cal. Health & Safety Code §25160', authority: 'California DTSC',
    summary: 'California generators use the federal Uniform Hazardous Waste Manifest, keep copies for three years, follow up on a missing signed copy on the federal schedule, and meet California\'s own copy and fee requirements. California does not use the federal exemption for very small generators, so they follow the small quantity schedule.',
    applicabilityNote: 'Applies to every California generator that ships hazardous waste off site.',
    sourceUrl: 'https://dtsc.ca.gov/hazardous-waste/', reviewFrequency: 'annual',
    verify: 'Confirm the copy-to-DTSC step, the fee, the retention period and the treatment of very small generators against 22 CCR Division 4.5.',
  },
  {
    id: 'lr-ca-hw-fees', program: 'hazardous_waste', title: 'Hazardous waste generator fees',
    citation: 'Cal. Health & Safety Code, Div. 20, Ch. 6.5 (fees); administered with the California Department of Tax and Fee Administration', authority: 'California DTSC; CDTFA',
    summary: 'California generators pay an annual fee based on the hazardous waste they generate, billed to the EPA ID holder, and may pay other fees tied to disposal. The bill and its due date come from the state, not from a fixed calendar date.',
    applicabilityNote: 'Applies to California generators with an EPA ID number.',
    reviewFrequency: 'annual',
    verify: 'Confirm which fees apply, who bills them and the due dates, and whether small or very small generators are exempt.',
  },
  {
    id: 'lr-ca-universal-waste', program: 'hazardous_waste', title: 'California universal waste',
    citation: '22 CCR Division 4.5, Chapter 23 (§66273.1 et seq.)', authority: 'California DTSC',
    summary: 'California treats more items as universal waste than the federal list (for example electronic devices, aerosol cans and some mercury-containing items), with a one-year holding limit, labels and handler duties.',
    applicabilityNote: 'Applies to California sites that generate these wastes.',
    reviewFrequency: 'annual',
    verify: 'Confirm the current category list, the holding limit and the labeling words against Chapter 23.',
  },
  {
    id: 'lr-ca-cupa', program: 'hazardous_waste', title: 'Unified Program and CERS reporting',
    citation: 'Cal. Health & Safety Code, Div. 20, Ch. 6.11; California Environmental Reporting System (CERS)', authority: 'CalEPA; local CUPA',
    summary: 'A local agency (the CUPA) inspects hazardous waste generators and hazardous materials businesses under one program. Businesses submit their facility information, hazardous materials inventory and hazardous waste details electronically through CERS and keep them current.',
    applicabilityNote: 'Applies to California businesses that generate hazardous waste or handle hazardous materials above the thresholds.',
    sourceUrl: 'https://cersapps.calepa.ca.gov/', reviewFrequency: 'annual',
    verify: 'Identify your CUPA and confirm what it expects in CERS and by when.',
  },
  {
    id: 'lr-ca-engine-atcm', program: 'air', title: 'Stationary diesel engines: California airborne toxic control measure',
    citation: '17 CCR §93115', authority: 'California Air Resources Board; local air district',
    summary: 'California limits the hours emergency standby diesel engines may run for maintenance and testing, sets fuel and emission requirements, and relies on the air district permit to enforce them. It is stricter than the federal engine rule.',
    applicabilityNote: 'Applies to stationary compression ignition (diesel) engines, including emergency generators and fire pumps.',
    reviewFrequency: 'annual',
    appliesWhen: { airPermitType: [...AIR_PERMITTED] },
    verify: ATCM_VERIFY,
  },
  {
    id: 'lr-ca-wdr', program: 'wastewater', title: 'Waste discharge requirements for discharges to land',
    citation: 'Cal. Water Code §13260 and Porter-Cologne Water Quality Control Act', authority: 'California Regional Water Quality Control Boards',
    summary: 'Wastewater that is applied to land, evaporated, or sent to a septic system rather than to a sewer or a surface water can still need waste discharge requirements from the Regional Water Board, with monitoring and reporting.',
    applicabilityNote: 'Applies to zero-discharge and septic wastewater arrangements. Sewer dischargers follow their POTW instead.',
    reviewFrequency: 'annual',
    appliesWhen: { wastewaterDischarge: ['zero_discharge', 'septic'] },
    verify: 'Confirm whether this site\'s arrangement needs waste discharge requirements, and from which Regional Board.',
  },
]
