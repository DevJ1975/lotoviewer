// State additions to the hazardous waste module's weekly area checks
// (HAZARDOUS_WASTE_FIELD_CHECKS in hazardousWaste.ts, the federal baseline).
//
// A state adds checks; it never changes a federal check's id, wording or
// criticality, so inspections already on file keep meaning what they meant. The
// ids here must not collide with the federal ones (a test pins that).
//
// STATUS: DRAFT, like the environmental library: every check carries a
// `citation` and a `verify` note saying what a Certified Safety Professional
// must confirm before a site relies on it.
//
// Type-only import: hazardousWaste.ts imports this file's data, so a value
// import back would be a cycle.

import type { HazardousWasteFieldCheck } from './hazardousWaste'

export const HAZARDOUS_WASTE_STATE_CHECKS: Readonly<Record<string, readonly HazardousWasteFieldCheck[]>> = {
  CA: [
    {
      id: 'ca-label-contents',
      label: 'California: the label also shows the composition and physical state, the hazard and the generator\'s name and address',
      detail: 'Beyond "Hazardous Waste" and the start date, California asks for the waste\'s composition and physical state, a statement of its hazardous properties, and the generator\'s name and address.',
      areaTypes: ['satellite_accumulation', 'central_accumulation'],
      critical: true,
      citation: '22 CCR §66262.32 and §66262.17(a)(5)',
      verify: 'Confirm the marking list for accumulation containers (as opposed to containers being shipped) in the current text.',
    },
    {
      id: 'ca-ehw-identified',
      label: 'California: extremely hazardous waste is identified and kept apart from other waste',
      detail: 'Extremely hazardous waste has the lowest accumulation limit, so confirm any container holding it is marked as such, within the acute-equivalent quantity at a satellite area, and not mixed with other waste.',
      areaTypes: ['satellite_accumulation', 'central_accumulation'],
      critical: true,
      citation: '22 CCR §66261.110 and §66262.15',
      verify: 'Confirm the extremely hazardous waste criteria and how the satellite quantity limit applies to it.',
    },
    {
      id: 'ca-uw-category',
      label: 'California: only recognized universal waste categories are here, each container labeled with its category and start date',
      detail: 'California recognizes more universal waste categories than the federal list. Anything outside them belongs with hazardous waste.',
      areaTypes: ['universal_waste'],
      critical: false,
      citation: '22 CCR Division 4.5, Chapter 23',
      verify: 'Confirm the current category list and the labeling words.',
    },
    {
      id: 'ca-used-oil-hauler',
      label: 'California: used oil is labeled "Used Oil", kept separate from hazardous waste, and goes to a registered hauler',
      detail: 'Mixing used oil with solvents or other hazardous waste can turn the whole container into hazardous waste.',
      areaTypes: ['used_oil'],
      critical: false,
      citation: 'Cal. Health & Safety Code, Div. 20, Ch. 6.5, Art. 13',
      verify: 'Confirm the labeling and hauler-registration requirements.',
    },
  ],
  TX: [
    {
      id: 'tx-class-known',
      label: 'Texas: each container\'s waste is classified (hazardous or Class 1) and its Texas waste code is on the container record',
      detail: 'Texas assigns its own waste code to each waste stream and classifies industrial waste. A container with no classification cannot be shipped correctly.',
      areaTypes: ['satellite_accumulation', 'central_accumulation'],
      critical: false,
      citation: '30 TAC Chapter 335, Subchapter R',
      verify: 'Confirm the classes, the waste code format and what the container record must show.',
    },
    {
      id: 'tx-class1-apart',
      label: 'Texas: Class 1 non-hazardous industrial waste is labeled and kept apart from hazardous waste',
      detail: 'Texas manages Class 1 non-hazardous waste with controls close to hazardous waste, including shipping on a manifest.',
      areaTypes: ['central_accumulation'],
      critical: false,
      citation: '30 TAC §335.10 and Subchapter R',
      verify: 'Confirm the labeling, time limit and storage rules for Class 1 waste.',
    },
  ],
}
