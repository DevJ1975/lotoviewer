// California: the State Water Board's Industrial General Permit replaces the EPA
// MSGP for stormwater, and the State's hazardous waste, hazardous materials and
// air-district programs sit on top of the federal ones.
//
// STATUS: DRAFT. Every California-specific claim below was written from
// recollection of the rule and is marked `verify`: confirm each against current
// text before this is shown to a client. Section numbers of the IGP in
// particular must be checked against the permit as amended.

import type { JurisdictionPack } from '../content'
import { federalPack } from './federal'
import { caStormwaterGuide } from './guides'
import { cite, passFail, photoItem, rebase, signatureItem, textItem } from './helpers'

const IGP_VERIFY =
  'Confirm the section number and wording against the Industrial General Permit as amended by Orders 2015-0122-DWQ and 2018-0028-DWQ.'
const IGP = (section: string, title?: string) =>
  cite(`IGP Order 2014-0057-DWQ ${section}`, IGP_VERIFY, title)

const fed = (id: string) => {
  const t = federalPack.checklists?.add?.find(x => x.id === id)
  if (!t) throw new Error(`federal pack has no checklist '${id}'`)
  return t
}

const MVO = [IGP('§XI.A.1 (monthly visual observations)')]
const QSE = [IGP('§XI.B (sampling and analysis)')]
const OUTFALL_CITES = [IGP('§XI.A (visual observations)'), IGP('§III / §IV (non-stormwater discharges)')]

export const caPack: JurisdictionPack = {
  meta: {
    jurisdiction: 'CA', version: '0.1.0', draftedOn: '2026-10-07', lastVerified: null,
    status: 'draft', reviewer: null,
    notes: 'California delta over the federal baseline. Stormwater follows the Industrial General Permit, not the EPA MSGP.',
  },

  checklists: {
    remove: [
      { id: 'sw-routine-inspection', reason: 'California\'s Industrial General Permit, not the EPA MSGP, governs; its monthly visual observations and annual evaluation take the place of the MSGP routine inspection.' },
      { id: 'sw-quarterly-visual', reason: 'The Industrial General Permit uses monthly visual observations and sampling at qualifying storm events instead of the MSGP quarterly visual assessment.' },
    ],
    replace: [
      rebase(fed('of-inspection'), {
        cadence: 'monthly',
        description: 'Check one discharge location: its structure, whether anything is flowing in dry weather (a possible unauthorized non-stormwater discharge), and whether the discharge or receiving water looks wrong.',
        citations: OUTFALL_CITES,
        itemCitations: OUTFALL_CITES,
      }),
    ],
    add: [
      {
        id: 'sw-ca-mvo', program: 'stormwater', name: 'Monthly visual observations (California IGP)',
        description: 'Once each calendar month, look at each drainage area: authorized and unauthorized non-stormwater discharges, pollutant sources and the controls that are supposed to contain them.',
        subjectType: 'facility', cadence: 'monthly',
        appliesWhen: { stormwaterCoverage: ['general_permit'] },
        citations: MVO,
        items: [
          passFail('ca-mvo.timing', 'Before you start', 'Done during daylight hours on a day with scheduled facility operations, and not during precipitation.', {
            cite: [IGP('§XI.A.1 (timing)')], failCreatesAction: false, clauseRef: '9.1.1',
            guidance: 'If the month had no day that met these conditions, answer N/A and record why: a missed month needs a reason on file.',
          }),
          passFail('ca-mvo.unauthorized-nswd', 'Non-stormwater discharges', 'No unauthorized non-stormwater discharge was observed.', {
            cite: [IGP('§XI.A.1.a (non-stormwater discharges)'), IGP('§III')], failCreatesAction: true, critical: true, clauseRef: '6.1.3',
            guidance: 'An unauthorized non-stormwater discharge must be eliminated, or authorized, and the cause recorded. Say what it was and where it came from.',
          }),
          passFail('ca-mvo.authorized-nswd', 'Non-stormwater discharges', 'Any authorized non-stormwater discharge observed is one the SWPPP lists, with its controls in place.', {
            cite: [IGP('§XI.A.1.a'), IGP('§IV')], failCreatesAction: true, clauseRef: '6.1.3',
          }),
          passFail('ca-mvo.pollutant-sources', 'Pollutant sources', 'Outdoor industrial activities and materials are controlled; no new unmanaged pollutant source.', {
            cite: [IGP('§XI.A.1.b (pollutant sources)')], failCreatesAction: true, critical: true, clauseRef: '8.1',
          }),
          passFail('ca-mvo.bmps', 'Best management practices', 'The BMPs in the SWPPP are in place and effective; none need repair or replacement.', {
            cite: [IGP('§XI.A.1.c (BMPs)')], failCreatesAction: true, clauseRef: '8.1',
          }),
          textItem('ca-mvo.record', 'Record', 'Date, time and observer, and what you found in each drainage area. Write "no findings" if none.', {
            cite: [IGP('§XI.A.2 (records)')], required: true, clauseRef: '9.1.1',
          }),
          photoItem('ca-mvo.photo', 'Record', 'Photo of anything found, or of the area if none.', { cite: MVO, required: false }),
          signatureItem('ca-mvo.sign', 'Record', 'Observer signature.', { cite: MVO, required: true }),
        ],
      },
      {
        id: 'sw-ca-qse-sampling', program: 'stormwater', name: 'Storm event sampling (California IGP)',
        description: 'Collect and analyze samples from a qualifying storm event. The permit requires four events a year: two in July to December and two in January to June.',
        subjectType: 'outfall', cadence: 'semiannual',
        appliesWhen: { stormwaterCoverage: ['general_permit'] },
        citations: QSE,
        items: [
          passFail('ca-qse.event', 'The storm event', 'The event is a qualifying storm event: it produced a discharge from at least one drainage area, preceded by 48 hours without a discharge.', {
            cite: [IGP('§XI.B.1 (qualifying storm event)')], failCreatesAction: false, clauseRef: '9.1.1',
          }),
          passFail('ca-qse.timing', 'The storm event', 'Samples were collected within four hours of the start of the discharge (or of the start of facility operations, if the event began in the 12 hours before).', {
            cite: [IGP('§XI.B.5 (timing)')], failCreatesAction: false, clauseRef: '9.1.1',
          }),
          passFail('ca-qse.locations', 'Collection', 'A sample was collected from each drainage area at every discharge location (or representative locations the SWPPP approves).', {
            cite: [IGP('§XI.B.4 (locations)')], failCreatesAction: true, clauseRef: '9.1.1',
          }),
          passFail('ca-qse.parameters', 'Analysis', 'Samples were analyzed for pH, total suspended solids and oil and grease, plus the facility-specific parameters its SIC code and activities require.', {
            cite: [IGP('§XI.B.6 and Table 1 (parameters)')], failCreatesAction: true, clauseRef: '9.1.1',
          }),
          passFail('ca-qse.lab', 'Analysis', 'Analysis was done by an accredited laboratory (or the pH field-meter requirements were met).', {
            cite: [IGP('§XI.B.8 (laboratory)')], failCreatesAction: false, clauseRef: '9.1.1',
          }),
          textItem('ca-qse.record', 'Record', 'Date and time of each sample, the last storm before it, and the laboratory report reference.', {
            cite: [IGP('§XI.B.12 (records)')], required: true, clauseRef: '9.1.1',
          }),
          passFail('ca-qse.smarts', 'Reporting', 'All results have been (or will be) uploaded to SMARTS within 30 days of receiving them.', {
            cite: [IGP('§XI.B.11 (reporting)')], failCreatesAction: true, clauseRef: '9.1.1',
          }),
          signatureItem('ca-qse.sign', 'Record', 'Signature.', { cite: QSE, required: true }),
        ],
      },
    ],
  },

  obligations: {
    remove: [
      { id: 'sw-fed-annual-report', reason: 'California facilities report through SMARTS under the Industrial General Permit, not through EPA NeT under the MSGP.' },
      { id: 'sw-fed-swppp-review', reason: 'The Industrial General Permit\'s annual comprehensive facility compliance evaluation covers the SWPPP review.' },
      { id: 'sw-fed-routine-inspection', reason: 'Replaced by the monthly visual observations.' },
      { id: 'sw-fed-quarterly-visual', reason: 'Replaced by the monthly visual observations and sampling at qualifying storm events.' },
    ],
    add: [
      {
        id: 'sw-ca-mvo', program: 'stormwater', title: 'Monthly visual observations',
        description: 'Complete the monthly visual observation checklist once each calendar month.',
        cadence: 'monthly', anchor: { kind: 'period_end', period: 'month' }, leadDays: 7,
        citations: MVO, appliesWhen: { stormwaterCoverage: ['general_permit'] }, checklistTemplateId: 'sw-ca-mvo', legalId: 'lr-ca-igp',
      },
      {
        id: 'sw-ca-qse', program: 'stormwater', title: 'Collect storm event samples (two this half-year)',
        description: 'Collect samples from two qualifying storm events in each half of the reporting year (July to December and January to June). A storm may not come when you want it: watch the forecast and keep sampling supplies ready.',
        cadence: 'semiannual', anchor: { kind: 'period_end', period: 'half' }, leadDays: 60,
        citations: QSE, appliesWhen: { stormwaterCoverage: ['general_permit'] }, checklistTemplateId: 'sw-ca-qse-sampling', legalId: 'lr-ca-igp',
      },
      {
        id: 'sw-ca-ace', program: 'stormwater', title: 'Annual comprehensive facility compliance evaluation',
        description: 'Evaluate the whole facility against the permit once each reporting year, and revise the SWPPP as needed. It feeds the annual report.',
        cadence: 'annual', anchor: { kind: 'annual', month: 6, day: 30 }, leadDays: 60,
        citations: [IGP('§XV (annual evaluation)')], appliesWhen: { stormwaterCoverage: ['general_permit'] }, legalId: 'lr-ca-igp',
      },
      {
        id: 'sw-ca-annual-report', program: 'stormwater', title: 'Submit the Industrial General Permit annual report (SMARTS)',
        description: 'Submit the annual report for the reporting year that ended June 30, with the compliance evaluation and any exceedance response actions.',
        cadence: 'annual', anchor: { kind: 'annual', month: 7, day: 15 }, leadDays: 45,
        citations: [IGP('§XVI (annual report)', 'Annual report due July 15')], appliesWhen: { stormwaterCoverage: ['general_permit'] }, legalId: 'lr-ca-igp',
      },
      {
        id: 'ca-hmbp-recertify', program: 'epcra', title: 'Review and recertify the Hazardous Materials Business Plan (CERS)',
        description: 'Businesses with hazardous materials above the state thresholds review, update and electronically recertify the business plan each year through CERS.',
        cadence: 'annual', anchor: { kind: 'annual', month: 3, day: 1 }, leadDays: 45,
        citations: [cite('Cal. Health & Safety Code, Div. 20, Ch. 6.95', 'Confirm the annual due date and the thresholds with your CUPA.')],
        appliesWhen: { tier2: true }, legalId: 'lr-ca-hmbp',
      },
    ],
  },

  legal: {
    add: [
      {
        id: 'lr-ca-igp', program: 'stormwater', title: 'California Industrial General Permit (stormwater)',
        citation: 'State Water Board Order 2014-0057-DWQ (NPDES CAS000001), as amended by Orders 2015-0122-DWQ and 2018-0028-DWQ', authority: 'California State Water Resources Control Board',
        summary: 'California\'s statewide permit for industrial stormwater: a SWPPP, monthly visual observations, sampling at four qualifying storm events a year, an annual evaluation, an annual report in SMARTS by July 15, and a tiered response to numeric action level exceedances.',
        applicabilityNote: 'Applies to facilities covered under the IGP. The EPA MSGP does not apply in California.',
        sourceUrl: 'https://www.waterboards.ca.gov/water_issues/programs/stormwater/industrial.html', reviewFrequency: 'annual',
        appliesWhen: { stormwaterCoverage: ['general_permit', 'individual_permit'] },
        verify: 'Confirm the order numbers, that the 2014 permit is still the one in effect (a reissuance was in process), the July 15 annual report date and each section number cited.',
      },
      {
        id: 'lr-ca-era', program: 'stormwater', title: 'Exceedance response actions (IGP)',
        citation: 'IGP Order 2014-0057-DWQ §XII', authority: 'California State Water Resources Control Board',
        summary: 'When sampling results exceed a numeric action level, the facility enters Level 1 status and evaluates its controls (evaluation by October 1, report by January 1), and a continuing exceedance moves it to Level 2, which needs a Qualified Industrial Stormwater Practitioner.',
        applicabilityNote: 'Applies when annual or instantaneous results exceed the numeric action levels.',
        reviewFrequency: 'annual', appliesWhen: { stormwaterCoverage: ['general_permit'] },
        verify: 'Confirm the Level 1 and Level 2 deadlines and the numeric action levels in the permit as amended.',
      },
      {
        id: 'lr-ca-hw-control', program: 'hazardous_waste', title: 'California hazardous waste control',
        citation: 'Cal. Health & Safety Code, Div. 20, Ch. 6.5; 22 CCR Division 4.5', authority: 'California DTSC; local CUPA',
        summary: 'California adds to the federal generator rules: a state EPA ID, state manifest handling, broader waste definitions, its own container and accumulation requirements, and annual fees. Some federal exemptions do not apply.',
        applicabilityNote: 'Applies to every California generator. Where the state rule is stricter, it governs.',
        sourceUrl: 'https://dtsc.ca.gov/hazardous-waste/', reviewFrequency: 'annual',
        verify: 'Confirm the specific California requirements (satellite accumulation time, labeling, used oil, manifest copies) against 22 CCR Division 4.5 before relying on any in a checklist.',
      },
      {
        id: 'lr-ca-hmbp', program: 'epcra', title: 'Hazardous Materials Business Plan (HMBP)',
        citation: 'Cal. Health & Safety Code, Div. 20, Ch. 6.95', authority: 'California CalEPA; local CUPA',
        summary: 'Businesses that handle hazardous materials above the state thresholds (generally 55 gallons, 500 pounds or 200 cubic feet) submit an inventory, an emergency plan and training information electronically each year through CERS.',
        applicabilityNote: 'Thresholds apply per material. Your CUPA administers it.',
        sourceUrl: 'https://calepa.ca.gov/cupa/', reviewFrequency: 'annual',
        verify: 'Confirm the thresholds, the annual submission date and your local CUPA\'s requirements.',
      },
      {
        id: 'lr-ca-air-district', program: 'air', title: 'Air district permit to operate',
        citation: 'Cal. Health & Safety Code §42300 et seq.; air district rules (for example SCAQMD Rules 201-203)', authority: 'Local air district (for example South Coast AQMD)',
        summary: 'Equipment that emits air contaminants needs a permit from the local air district, kept current and displayed at or near the equipment, with annual fees, records and renewals.',
        applicabilityNote: 'Which district and which rules depend on the facility\'s location and equipment.',
        reviewFrequency: 'annual',
        appliesWhen: { airPermitType: ['registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] },
        verify: 'Identify your air district and confirm the permit-posting, record and renewal rules it sets.',
      },
    ],
  },

  guides: { replace: [caStormwaterGuide] },
}
