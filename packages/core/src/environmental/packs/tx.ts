// Texas: the TCEQ's TPDES Multi-Sector General Permit (TXR050000) replaces the
// EPA MSGP for stormwater, and TCEQ rules (30 TAC) sit on top of the federal
// hazardous waste and air programs.
//
// STATUS: DRAFT. Every Texas-specific claim is from recollection and is marked
// `verify`. The 2021 TXR050000 issuance was due to expire around August 2026:
// confirm what is in effect before relying on any of this.

import type { JurisdictionPack } from '../content'
import { federalPack } from './federal'
import { txStormwaterGuide } from './guides'
import { cite, rebase } from './helpers'

const TXR_VERIFY =
  'TPDES MSGP TXR050000 (issued 2021) was due to expire about August 2026. Confirm which permit is in effect and that the part number below matches it. Item wording is derived from the federal baseline: confirm it against the Texas permit text.'
const TXR = (part: string, title?: string) => cite(`TPDES MSGP TXR050000 ${part}`, TXR_VERIFY, title)

const fed = (id: string) => {
  const t = federalPack.checklists?.add?.find(x => x.id === id)
  if (!t) throw new Error(`federal pack has no checklist '${id}'`)
  return t
}

const INSPECTION = [TXR('Part III (inspections and SWP3)')]
const VISUAL = [TXR('Part III (quarterly visual monitoring)')]

export const txPack: JurisdictionPack = {
  meta: {
    jurisdiction: 'TX', version: '0.1.0', draftedOn: '2026-10-07', lastVerified: null,
    status: 'draft', reviewer: null,
    notes: 'Texas delta over the federal baseline. Stormwater follows TPDES MSGP TXR050000, not the EPA MSGP.',
  },

  checklists: {
    replace: [
      rebase(fed('sw-routine-inspection'), {
        name: 'Routine facility inspection (TPDES MSGP)',
        citations: INSPECTION, itemCitations: INSPECTION,
      }),
      rebase(fed('sw-quarterly-visual'), {
        name: 'Quarterly visual monitoring (TPDES MSGP)',
        description: 'Look at a sample of stormwater discharge from each outfall each quarter and record what you see. This is observation, not lab analysis.',
        citations: VISUAL, itemCitations: VISUAL,
      }),
      rebase(fed('of-inspection'), {
        citations: INSPECTION, itemCitations: INSPECTION,
      }),
    ],
  },

  obligations: {
    remove: [
      { id: 'sw-fed-annual-report', reason: 'The EPA NeT annual report belongs to the EPA MSGP. Texas reporting duties come from the permit itself and TCEQ\'s STEERS system; confirm them in TXR050000.' },
    ],
    patch: [
      { id: 'sw-fed-swppp-review', fields: {
        title: 'Review and update the SWP3', citations: [TXR('Part III (SWP3)')],
        description: 'Review the stormwater pollution prevention plan (SWP3) at least once a year and whenever the site, its activities or its controls change. This repeats a year from the day it is set up.',
      } },
      { id: 'sw-fed-routine-inspection', fields: { citations: INSPECTION } },
      { id: 'sw-fed-quarterly-visual', fields: { citations: VISUAL } },
    ],
    add: [
      {
        id: 'tx-annual-waste-summary', program: 'hazardous_waste', title: 'Submit the Annual Waste Summary (TCEQ)',
        description: 'Texas generators of industrial solid waste and hazardous waste summarize the previous calendar year\'s waste to TCEQ through STEERS.',
        cadence: 'annual', anchor: { kind: 'annual', month: 3, day: 1 }, leadDays: 45,
        citations: [cite('30 TAC §335.9', 'Confirm the due date, who must file, and whether small generators are exempt.')],
        appliesWhen: { generatorCategory: ['lqg', 'sqg'] }, legalId: 'lr-tx-30tac335',
      },
      {
        id: 'tx-emissions-inventory', program: 'air', title: 'Submit the air emissions inventory (TCEQ)',
        description: 'Sites with state air permits report the previous year\'s emissions to TCEQ each year.',
        cadence: 'annual', anchor: { kind: 'annual', month: 3, day: 31 }, leadDays: 45,
        citations: [cite('30 TAC §101.10', 'Confirm the due date, the reporting threshold, and whether permit-by-rule sites must file.')],
        appliesWhen: { airPermitType: ['minor_permit', 'synthetic_minor', 'title_v'] }, legalId: 'lr-tx-ei',
      },
    ],
  },

  legal: {
    add: [
      {
        id: 'lr-tx-msgp', program: 'stormwater', title: 'TPDES Multi-Sector General Permit (stormwater)',
        citation: 'TPDES MSGP TXR050000; 30 TAC Chapter 205', authority: 'Texas Commission on Environmental Quality (TCEQ)',
        summary: 'Texas\'s general permit for industrial stormwater: a stormwater pollution prevention plan (SWP3), routine inspections, quarterly visual monitoring, benchmark monitoring for some sectors, and electronic notices through STEERS. It replaces the EPA MSGP in Texas.',
        applicabilityNote: 'Applies to facilities covered under TXR050000. Coverage numbers look like TXR05xxxx.',
        sourceUrl: 'https://www.tceq.texas.gov/permitting/stormwater/industrial', reviewFrequency: 'annual',
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit', 'no_exposure'] },
        verify: TXR_VERIFY,
      },
      {
        id: 'lr-tx-30tac335', program: 'hazardous_waste', title: 'Texas industrial solid waste and hazardous waste rules',
        citation: '30 TAC Chapter 335', authority: 'Texas Commission on Environmental Quality (TCEQ)',
        summary: 'Texas generators register with TCEQ (a Notice of Registration and an assigned waste code for each waste stream), classify waste, ship it with the manifest, and file an Annual Waste Summary. The state\'s waste codes and several duties differ from the federal ones.',
        applicabilityNote: 'Applies to every Texas generator of industrial solid waste or hazardous waste.',
        sourceUrl: 'https://www.tceq.texas.gov/permitting/waste_permits/ihw_permits', reviewFrequency: 'annual',
        verify: 'Confirm the Notice of Registration, the waste-code format, the Annual Waste Summary rules and the manifest rules (including Class 1 non-hazardous waste) against 30 TAC Chapter 335.',
      },
      {
        id: 'lr-tx-ei', program: 'air', title: 'Texas air emissions inventory',
        citation: '30 TAC §101.10', authority: 'Texas Commission on Environmental Quality (TCEQ)',
        summary: 'Sites that meet the reporting thresholds submit an emissions inventory each year, generally by March 31.',
        applicabilityNote: 'Depends on the site\'s emissions and permit type.',
        reviewFrequency: 'annual',
        appliesWhen: { airPermitType: ['registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] },
        verify: 'Confirm the thresholds and which permit types must file.',
      },
      {
        id: 'lr-tx-pbr', program: 'air', title: 'Texas air permits by rule',
        citation: '30 TAC Chapter 106', authority: 'Texas Commission on Environmental Quality (TCEQ)',
        summary: 'Many small sources operate under a permit by rule if they meet its conditions, keeping the records it requires on site, instead of holding a case-by-case permit.',
        applicabilityNote: 'Applies where the source qualifies for a permit by rule; each rule sets its own records.',
        reviewFrequency: 'annual',
        appliesWhen: { airPermitType: ['registration_or_pbr'] },
        verify: 'Identify each permit by rule the site relies on and confirm its conditions and records.',
      },
    ],
  },

  guides: { replace: [txStormwaterGuide] },
}
