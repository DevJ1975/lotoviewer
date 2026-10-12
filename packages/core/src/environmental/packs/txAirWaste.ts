// Texas's changes to the federal air, wastewater, hazardous waste and manifest
// content (federalAirWaste.ts). Kept apart from tx.ts for readability; tx.ts
// spreads these into the Texas pack.
//
// STATUS: DRAFT. Everything Texas-specific here was written from recollection of
// 30 TAC and carries a `verify` note. Texas also regulates "Class 1"
// non-hazardous industrial waste with controls close to hazardous waste, which
// the federal content does not mention.

import type { ChecklistItemDef, LegalRequirementDef, Overlay } from '../content'
import { cite, passFail } from './helpers'

const AIR_PERMITTED = ['registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] as const

export const txManifestItems: Overlay<ChecklistItemDef> = {
  add: [
    passFail('mf-ps.tx-waste-code', 'The paperwork', 'Texas: each waste line shows its Texas waste code next to the EPA waste codes, and the waste is classified (hazardous or Class 1) as the registration says.', {
      cite: [cite('30 TAC §335.10 and Subchapter R (§§335.501-335.521)', 'Texas waste codes are recalled as eight characters: a four-digit sequence number, a three-digit form code and a one-character classification (H, 1, 2 or 3). Confirm the format and what the manifest must show.')],
      failCreatesAction: true, critical: true, clauseRef: '8.1', placeAfter: 'mf-ps.description',
    }),
    passFail('mf-ps.tx-registration', 'The paperwork', 'Texas: the generator\'s TCEQ registration (solid waste registration) number is current and matches the shipment record.', {
      cite: [cite('30 TAC §335.6', 'Confirm how the registration number is used on the manifest and when the registration must be updated.')],
      failCreatesAction: true, clauseRef: '8.1', placeAfter: 'mf-ps.ids',
    }),
  ],
}

export const txAirWasteLegal: LegalRequirementDef[] = [
  {
    id: 'lr-tx-air-permits', program: 'air', title: 'Texas air permits: new source review and permits by rule',
    citation: '30 TAC Chapter 116 (permits for new construction or modification); Chapter 106 (permits by rule)', authority: 'Texas Commission on Environmental Quality (TCEQ)',
    summary: 'In Texas, new or changed air sources generally need authorization before construction: a case-by-case permit, a standard permit or a permit by rule. A site runs within the terms of whichever applies and keeps its records.',
    applicabilityNote: 'Applies to sites with a Texas air authorization. Which one each unit relies on is the thing to write down.',
    reviewFrequency: 'annual',
    appliesWhen: { airPermitType: [...AIR_PERMITTED] },
    verify: 'Confirm the authorization each emission unit relies on and the records each one requires.',
  },
  {
    id: 'lr-tx-title-v', program: 'air', title: 'Texas federal operating permits (Title V)',
    citation: '30 TAC Chapter 122', authority: 'Texas Commission on Environmental Quality (TCEQ)',
    summary: 'Major sources hold a federal operating permit and report deviations and certify compliance on the dates in the permit.',
    applicabilityNote: 'Applies to major sources. The dates are set in the permit.',
    reviewFrequency: 'annual',
    appliesWhen: { airPermitType: ['title_v'] },
    verify: 'Confirm the deviation reporting and compliance certification schedule in the permit.',
  },
  {
    id: 'lr-tx-manifest', program: 'manifest', title: 'Texas manifest and shipping requirements',
    citation: '30 TAC §335.10', authority: 'Texas Commission on Environmental Quality (TCEQ)',
    summary: 'Texas shippers use the manifest for hazardous waste and also for Class 1 non-hazardous industrial waste, show the Texas waste code, keep copies, and follow up on a missing signed copy.',
    applicabilityNote: 'Applies to Texas generators that ship hazardous waste or Class 1 industrial waste off site.',
    reviewFrequency: 'annual',
    verify: 'Confirm that Class 1 non-hazardous waste needs a manifest, the retention period and the follow-up schedule.',
  },
  {
    id: 'lr-tx-waste-classification', program: 'hazardous_waste', title: 'Texas waste classification and waste codes',
    citation: '30 TAC §§335.501-335.521 (Subchapter R)', authority: 'Texas Commission on Environmental Quality (TCEQ)',
    summary: 'Texas generators classify each waste as hazardous or Class 1, 2 or 3 non-hazardous, document the basis, and assign a Texas waste code. Class 1 non-hazardous waste is managed with controls close to hazardous waste.',
    applicabilityNote: 'Applies to every Texas generator of industrial solid waste.',
    reviewFrequency: 'annual',
    verify: 'Confirm the classes, the waste code format and the documentation the rule requires.',
  },
  {
    id: 'lr-tx-registration', program: 'hazardous_waste', title: 'TCEQ notification and registration',
    citation: '30 TAC §335.6', authority: 'Texas Commission on Environmental Quality (TCEQ)',
    summary: 'Texas generators notify TCEQ of their waste activities and keep their registration current, updating it when the wastes or the site change.',
    applicabilityNote: 'Applies to Texas generators of industrial solid waste or hazardous waste.',
    reviewFrequency: 'annual',
    verify: 'Confirm when a registration must be updated and the number used on shipping papers.',
  },
  {
    id: 'lr-tx-pretreatment', program: 'wastewater', title: 'Texas pretreatment program',
    citation: '30 TAC Chapter 315', authority: 'Texas Commission on Environmental Quality (TCEQ); local POTW',
    summary: 'Industrial users that send wastewater to a Texas POTW follow the pretreatment rules and the city\'s sewer use ordinance and permit, which set the local limits.',
    applicabilityNote: 'Applies to indirect dischargers in Texas.',
    reviewFrequency: 'annual',
    appliesWhen: { wastewaterDischarge: ['potw_indirect'] },
    verify: 'Confirm the chapter number and get the POTW\'s ordinance and your permit.',
  },
  {
    id: 'lr-tx-tpdes-individual', program: 'wastewater', title: 'TPDES individual permits',
    citation: '30 TAC Chapters 305 and 319', authority: 'Texas Commission on Environmental Quality (TCEQ)',
    summary: 'A Texas site that discharges wastewater to surface water holds a TPDES permit, samples at the frequency in it, and files discharge monitoring reports on the dates in the permit.',
    applicabilityNote: 'Applies to direct dischargers.',
    reviewFrequency: 'annual',
    appliesWhen: { wastewaterDischarge: ['npdes_direct'] },
    verify: 'Confirm the chapter numbers and the reporting terms in your permit.',
  },
]
