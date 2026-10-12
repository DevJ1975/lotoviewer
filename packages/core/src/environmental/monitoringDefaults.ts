// A small catalog of numeric limits an admin may ADOPT for a site: draft starting points, with
// where each came from and what to check, never applied on their own.
//
// STATUS: DRAFT. Every number below was written from recollection of the permit and is marked
// `verify`. They are offered to a person who has the permit in front of them, so that the
// typing is saved and the doubt is not: the verify note travels with the adopted limit and is
// shown wherever it is.
//
// Texas is left out on purpose. The TPDES Multi-Sector General Permit (TXR050000) has its own
// monitoring tables, and no Texas number is invented here. A site whose permit is not listed
// gets no defaults and enters its limits by hand.

import type { JurisdictionCode } from './jurisdiction'
import type { SiteProfile } from './siteProfile'
import type { LimitBasis, LimitKind } from './monitoring'

export interface DefaultLimit {
  /** Stable; adopting a limit with the same key at the same place twice adds nothing. */
  libraryKey:    string
  jurisdiction:  JurisdictionCode
  /** The site profile's stormwater_general_permit this limit belongs to. */
  generalPermit: 'ca_igp' | 'epa_msgp'
  parameter:     string
  unit:          string
  kind:          LimitKind
  value:         number
  basis:         LimitBasis
  citation:      string
  /** Always present: nothing here has been confirmed against the permit in effect. */
  verify:        string
}

const IGP_CITATION = 'IGP Order 2014-0057-DWQ, Table 2 (numeric action levels)'
const IGP_VERIFY =
  'Written from recollection of the IGP. Confirm the value and unit against the permit as amended (Orders 2015-0122-DWQ and 2018-0028-DWQ) and any reissuance.'
  + ' The IGP averages an annual level over the whole facility, so adopt it site-wide.'
const IGP_INSTANTANEOUS_VERIFY =
  `${IGP_VERIFY} Confirm how the permit counts an instantaneous exceedance: this log counts every result past the value, one at a time.`

const MSGP_CITATION = 'EPA 2021 MSGP, benchmark monitoring'
const MSGP_VERIFY =
  'Written from recollection. The 2021 MSGP expired 2026-02-28: confirm which EPA MSGP (or administrative continuance) is in effect, and that its benchmark for this facility\'s sector(s) is this value. Benchmarks are set sector by sector.'
const MSGP_AVERAGE_VERIFY =
  `${MSGP_VERIFY} The MSGP compares an average of the quarterly results, not each sample: this log averages the samples in the reporting year (taken as the calendar year), so confirm the averaging period.`

const caIgp = (row: Pick<DefaultLimit, 'libraryKey' | 'parameter' | 'unit' | 'kind' | 'value'> & { verify?: string }): DefaultLimit => ({
  jurisdiction: 'CA', generalPermit: 'ca_igp', basis: 'numeric_action_level', citation: IGP_CITATION, verify: IGP_VERIFY, ...row,
})

const epaMsgp = (row: Pick<DefaultLimit, 'libraryKey' | 'parameter' | 'unit' | 'kind' | 'value'> & { verify?: string }): DefaultLimit => ({
  jurisdiction: 'federal', generalPermit: 'epa_msgp', basis: 'benchmark', citation: MSGP_CITATION, verify: MSGP_VERIFY, ...row,
})

export const DEFAULT_LIMITS: readonly DefaultLimit[] = [
  caIgp({ libraryKey: 'ca-igp-nal-tss-annual',          parameter: 'TSS',          unit: 'mg/L', kind: 'annual_average',    value: 100 }),
  caIgp({ libraryKey: 'ca-igp-nal-og-annual',           parameter: 'Oil & grease', unit: 'mg/L', kind: 'annual_average',    value: 15 }),
  caIgp({ libraryKey: 'ca-igp-nal-tss-instantaneous',   parameter: 'TSS',          unit: 'mg/L', kind: 'instantaneous_max', value: 400, verify: IGP_INSTANTANEOUS_VERIFY }),
  caIgp({ libraryKey: 'ca-igp-nal-og-instantaneous',    parameter: 'Oil & grease', unit: 'mg/L', kind: 'instantaneous_max', value: 25,  verify: IGP_INSTANTANEOUS_VERIFY }),
  caIgp({ libraryKey: 'ca-igp-nal-ph-instantaneous-min', parameter: 'pH',         unit: 's.u.', kind: 'instantaneous_min', value: 6,   verify: IGP_INSTANTANEOUS_VERIFY }),
  caIgp({ libraryKey: 'ca-igp-nal-ph-instantaneous-max', parameter: 'pH',         unit: 's.u.', kind: 'instantaneous_max', value: 9,   verify: IGP_INSTANTANEOUS_VERIFY }),

  epaMsgp({ libraryKey: 'epa-msgp-benchmark-ph-min',    parameter: 'pH',  unit: 's.u.', kind: 'instantaneous_min', value: 6 }),
  epaMsgp({ libraryKey: 'epa-msgp-benchmark-ph-max',    parameter: 'pH',  unit: 's.u.', kind: 'instantaneous_max', value: 9 }),
  epaMsgp({ libraryKey: 'epa-msgp-benchmark-tss-annual', parameter: 'TSS', unit: 'mg/L', kind: 'annual_average',    value: 100, verify: MSGP_AVERAGE_VERIFY }),
]

/**
 * The draft limits a site could adopt: those for the general permit its profile names, in a
 * jurisdiction its rules chain reaches. A site without a general permit (none, an individual
 * permit, not yet evaluated) has none, because its limits are in its own permit.
 */
export function defaultLimitsFor(
  jurisdictionChain: readonly JurisdictionCode[],
  profile: Pick<SiteProfile, 'stormwaterCoverage' | 'stormwaterGeneralPermit'>,
): DefaultLimit[] {
  if (profile.stormwaterCoverage !== 'general_permit' || profile.stormwaterGeneralPermit === null) return []
  return DEFAULT_LIMITS.filter(limit =>
    limit.generalPermit === profile.stormwaterGeneralPermit && jurisdictionChain.includes(limit.jurisdiction))
}

/** A default as the columns of a library limit row. Where it applies (site, outfall) is the caller's to add. */
export function defaultLimitRow(limit: DefaultLimit): Record<string, unknown> {
  return {
    parameter:   limit.parameter,
    unit:        limit.unit,
    limit_kind:  limit.kind,
    value:       limit.value,
    basis:       limit.basis,
    citation:    limit.citation,
    verify:      limit.verify,
    source:      'library',
    library_key: limit.libraryKey,
  }
}

/**
 * The month a site's reporting year begins in, and what to confirm about it. California's
 * Industrial General Permit counts from July 1; elsewhere the calendar year is assumed.
 */
export function reportingYearBasisFor(profile: Pick<SiteProfile, 'stormwaterGeneralPermit'>): { startMonth: number; verify: string } {
  if (profile.stormwaterGeneralPermit === 'ca_igp') {
    return { startMonth: 7, verify: 'Written from recollection: the IGP reporting year runs July 1 to June 30. Confirm against the permit.' }
  }
  return { startMonth: 1, verify: 'The calendar year is assumed. Confirm the reporting period in the permit that applies.' }
}
