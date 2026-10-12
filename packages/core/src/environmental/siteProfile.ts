// What programs a site is subject to. This is the input that decides which
// checklists, obligations and legal-register entries the library offers.
//
// A profile starts "not_evaluated" on every axis: the system does not guess
// whether a plant needs a stormwater permit. A person (or the AI assistant,
// whose suggestion a person confirms) says so, and an unevaluated axis shows as
// "needs evaluating" rather than as "not applicable".

import type { RcraGeneratorCategory } from '../hazardousWaste'

export const ENV_PROGRAMS = [
  'stormwater', 'outfall', 'air', 'wastewater', 'hazardous_waste', 'manifest', 'spcc', 'epcra',
] as const
export type EnvProgram = typeof ENV_PROGRAMS[number]

export const ENV_PROGRAM_LABELS: Readonly<Record<EnvProgram, string>> = {
  stormwater:      'Stormwater',
  outfall:         'Outfalls',
  air:             'Air',
  wastewater:      'Wastewater',
  hazardous_waste: 'Hazardous waste',
  manifest:        'Manifests',
  spcc:            'Oil spill prevention (SPCC)',
  epcra:           'Chemical inventory (EPCRA)',
}

export const STORMWATER_COVERAGE = ['not_evaluated', 'not_required', 'no_exposure', 'general_permit', 'individual_permit'] as const
export const AIR_PERMIT_TYPES = ['not_evaluated', 'not_required', 'exempt', 'registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] as const
export const WASTEWATER_DISCHARGE = ['not_evaluated', 'none', 'potw_indirect', 'npdes_direct', 'zero_discharge', 'septic'] as const
export const PRETREATMENT_STATUS = ['not_evaluated', 'not_regulated', 'non_significant', 'siu', 'ciu'] as const

export type StormwaterCoverage = typeof STORMWATER_COVERAGE[number]
export type AirPermitType = typeof AIR_PERMIT_TYPES[number]
export type WastewaterDischarge = typeof WASTEWATER_DISCHARGE[number]
export type PretreatmentStatus = typeof PRETREATMENT_STATUS[number]

export interface LocalAgencies {
  airDistrict:    string | null
  cupa:           string | null
  regionalBoard:  string | null
  potw:           string | null
}

export interface SiteProfile {
  stormwaterCoverage:      StormwaterCoverage
  /** Which general permit, when coverage is a general permit (e.g. "ca_igp"). */
  stormwaterGeneralPermit: string | null
  sicCodes:                string[]
  naicsCodes:              string[]
  airPermitType:           AirPermitType
  wastewaterDischarge:     WastewaterDischarge
  pretreatmentStatus:      PretreatmentStatus
  potwName:                string | null
  localAgencies:           LocalAgencies
  /** null = not yet evaluated. */
  spccApplicable:          boolean | null
  tier2Applicable:         boolean | null
  notes:                   string | null
  confirmedAt:             string | null
}

export const EMPTY_SITE_PROFILE: SiteProfile = {
  stormwaterCoverage:      'not_evaluated',
  stormwaterGeneralPermit: null,
  sicCodes:                [],
  naicsCodes:              [],
  airPermitType:           'not_evaluated',
  wastewaterDischarge:     'not_evaluated',
  pretreatmentStatus:      'not_evaluated',
  potwName:                null,
  localAgencies:           { airDistrict: null, cupa: null, regionalBoard: null, potw: null },
  spccApplicable:          null,
  tier2Applicable:         null,
  notes:                   null,
  confirmedAt:             null,
}

const MAX_CODES = 20
const MAX_TEXT = 200
const MAX_NOTES = 2000
const PERMIT_KEY = /^[a-z0-9_]{2,40}$/

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function triState(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function codeList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Read a stored profile row (snake_case, as the table has it) into the typed
 * profile. Never throws: an unknown enum value reads as "not_evaluated", which
 * is the safe direction (it asks a person to look again).
 */
export function parseSiteProfile(row: Record<string, unknown> | null | undefined): SiteProfile {
  if (!row) return { ...EMPTY_SITE_PROFILE, localAgencies: { ...EMPTY_SITE_PROFILE.localAgencies } }
  const agencies = (typeof row.local_agencies === 'object' && row.local_agencies !== null ? row.local_agencies : {}) as Record<string, unknown>
  return {
    stormwaterCoverage:      oneOf(STORMWATER_COVERAGE, row.stormwater_coverage, 'not_evaluated'),
    stormwaterGeneralPermit: stringOrNull(row.stormwater_general_permit),
    sicCodes:                codeList(row.sic_codes),
    naicsCodes:              codeList(row.naics_codes),
    airPermitType:           oneOf(AIR_PERMIT_TYPES, row.air_permit_type, 'not_evaluated'),
    wastewaterDischarge:     oneOf(WASTEWATER_DISCHARGE, row.wastewater_discharge, 'not_evaluated'),
    pretreatmentStatus:      oneOf(PRETREATMENT_STATUS, row.pretreatment_status, 'not_evaluated'),
    potwName:                stringOrNull(row.potw_name),
    localAgencies: {
      airDistrict:   stringOrNull(agencies.air_district),
      cupa:          stringOrNull(agencies.cupa),
      regionalBoard: stringOrNull(agencies.regional_board),
      potw:          stringOrNull(agencies.potw),
    },
    spccApplicable:  triState(row.spcc_applicable),
    tier2Applicable: triState(row.tier2_applicable),
    notes:           stringOrNull(row.notes),
    confirmedAt:     stringOrNull(row.confirmed_at),
  }
}

/** The profile as table columns. The inverse of parseSiteProfile. */
export function toProfileRow(profile: SiteProfile): Record<string, unknown> {
  return {
    stormwater_coverage:       profile.stormwaterCoverage,
    stormwater_general_permit: profile.stormwaterGeneralPermit,
    sic_codes:                 profile.sicCodes,
    naics_codes:               profile.naicsCodes,
    air_permit_type:           profile.airPermitType,
    wastewater_discharge:      profile.wastewaterDischarge,
    pretreatment_status:       profile.pretreatmentStatus,
    potw_name:                 profile.potwName,
    local_agencies: {
      air_district:    profile.localAgencies.airDistrict,
      cupa:            profile.localAgencies.cupa,
      regional_board:  profile.localAgencies.regionalBoard,
      potw:            profile.localAgencies.potw,
    },
    spcc_applicable:  profile.spccApplicable,
    tier2_applicable: profile.tier2Applicable,
    notes:            profile.notes,
  }
}

export type ProfileValidation =
  | { ok: true; profile: SiteProfile }
  | { ok: false; errors: string[] }

/**
 * Validate a request body (snake_case, like the table). Unlike parseSiteProfile
 * this REJECTS what it does not understand, because a value a client sent
 * deliberately and we dropped silently would look saved when it was not.
 * Fields left out keep the value in `current`, so a partial update is safe.
 */
export function validateSiteProfile(input: unknown, current: SiteProfile = EMPTY_SITE_PROFILE): ProfileValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['Expected an object.'] }
  }
  const body = input as Record<string, unknown>
  const errors: string[] = []

  const enumField = <T extends string>(key: string, allowed: readonly T[], keep: T): T => {
    if (!(key in body)) return keep
    if (typeof body[key] === 'string' && (allowed as readonly string[]).includes(body[key] as string)) return body[key] as T
    errors.push(`${key} must be one of: ${allowed.join(', ')}.`)
    return keep
  }
  const textField = (key: string, max: number, keep: string | null): string | null => {
    if (!(key in body)) return keep
    const value = body[key]
    if (value === null || value === '') return null
    if (typeof value !== 'string') { errors.push(`${key} must be text.`); return keep }
    const trimmed = value.trim()
    if (trimmed.length > max) { errors.push(`${key} is too long (the limit is ${max} characters).`); return keep }
    return trimmed || null
  }
  const triField = (key: string, keep: boolean | null): boolean | null => {
    if (!(key in body)) return keep
    if (body[key] === null || typeof body[key] === 'boolean') return body[key] as boolean | null
    errors.push(`${key} must be true, false or null.`)
    return keep
  }
  const codesField = (key: string, pattern: RegExp, label: string, keep: string[]): string[] => {
    if (!(key in body)) return keep
    const value = body[key]
    if (!Array.isArray(value) || value.length > MAX_CODES) {
      errors.push(`${key} must be a list of at most ${MAX_CODES} ${label} codes.`)
      return keep
    }
    const bad = value.filter(v => typeof v !== 'string' || !pattern.test(v.trim()))
    if (bad.length > 0) { errors.push(`${key} has an invalid ${label} code.`); return keep }
    return [...new Set(value.map(v => (v as string).trim()))]
  }

  const coverage = enumField('stormwater_coverage', STORMWATER_COVERAGE, current.stormwaterCoverage)
  let generalPermit = textField('stormwater_general_permit', 40, current.stormwaterGeneralPermit)
  if (generalPermit !== null && !PERMIT_KEY.test(generalPermit)) {
    errors.push('stormwater_general_permit must be a short key such as "ca_igp".')
    generalPermit = current.stormwaterGeneralPermit
  }
  if (coverage !== 'general_permit' && generalPermit !== null && 'stormwater_general_permit' in body) {
    errors.push('stormwater_general_permit only applies when stormwater_coverage is general_permit.')
  }

  let agencies = current.localAgencies
  if ('local_agencies' in body) {
    const raw = body.local_agencies
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push('local_agencies must be an object.')
    } else {
      const a = raw as Record<string, unknown>
      const pick = (k: string, keep: string | null) => {
        if (!(k in a)) return keep
        if (a[k] === null || a[k] === '') return null
        if (typeof a[k] === 'string' && (a[k] as string).trim().length <= MAX_TEXT) return (a[k] as string).trim() || null
        errors.push(`local_agencies.${k} must be text of at most ${MAX_TEXT} characters.`)
        return keep
      }
      agencies = {
        airDistrict:   pick('air_district', current.localAgencies.airDistrict),
        cupa:          pick('cupa', current.localAgencies.cupa),
        regionalBoard: pick('regional_board', current.localAgencies.regionalBoard),
        potw:          pick('potw', current.localAgencies.potw),
      }
    }
  }

  const profile: SiteProfile = {
    stormwaterCoverage:      coverage,
    stormwaterGeneralPermit: coverage === 'general_permit' ? generalPermit : null,
    sicCodes:                codesField('sic_codes', /^\d{4}$/, 'SIC', current.sicCodes),
    naicsCodes:              codesField('naics_codes', /^\d{2,6}$/, 'NAICS', current.naicsCodes),
    airPermitType:           enumField('air_permit_type', AIR_PERMIT_TYPES, current.airPermitType),
    wastewaterDischarge:     enumField('wastewater_discharge', WASTEWATER_DISCHARGE, current.wastewaterDischarge),
    pretreatmentStatus:      enumField('pretreatment_status', PRETREATMENT_STATUS, current.pretreatmentStatus),
    potwName:                textField('potw_name', MAX_TEXT, current.potwName),
    localAgencies:           agencies,
    spccApplicable:          triField('spcc_applicable', current.spccApplicable),
    tier2Applicable:         triField('tier2_applicable', current.tier2Applicable),
    notes:                   textField('notes', MAX_NOTES, current.notes),
    confirmedAt:             current.confirmedAt,
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, profile }
}

export type ProgramScopeStatus = 'in_scope' | 'out_of_scope' | 'not_evaluated'

export interface ProgramScope {
  program: EnvProgram
  status:  ProgramScopeStatus
}

/**
 * Where each program stands for a site. "not_evaluated" is a first-class answer:
 * it is what a new site shows, and what drives the "finish your profile" prompt.
 * Hazardous waste and manifests follow the generator category, which lives with
 * the hazardous waste module (it is single-sourced there), so it is passed in.
 */
export function programsInScope(
  profile: SiteProfile,
  generatorCategory: RcraGeneratorCategory | null = null,
): ProgramScope[] {
  const stormwater: ProgramScopeStatus =
    profile.stormwaterCoverage === 'not_evaluated' ? 'not_evaluated'
    : profile.stormwaterCoverage === 'not_required' ? 'out_of_scope'
    : 'in_scope'

  const outfall: ProgramScopeStatus =
    profile.wastewaterDischarge === 'npdes_direct' || stormwater === 'in_scope' ? 'in_scope'
    : stormwater === 'not_evaluated' && profile.wastewaterDischarge === 'not_evaluated' ? 'not_evaluated'
    : 'out_of_scope'

  const air: ProgramScopeStatus =
    profile.airPermitType === 'not_evaluated' ? 'not_evaluated'
    : profile.airPermitType === 'not_required' || profile.airPermitType === 'exempt' ? 'out_of_scope'
    : 'in_scope'

  const wastewater: ProgramScopeStatus =
    profile.wastewaterDischarge === 'not_evaluated' ? 'not_evaluated'
    : profile.wastewaterDischarge === 'potw_indirect' || profile.wastewaterDischarge === 'npdes_direct' ? 'in_scope'
    : 'out_of_scope'

  const waste: ProgramScopeStatus = generatorCategory === null ? 'not_evaluated' : 'in_scope'
  const tri = (v: boolean | null): ProgramScopeStatus => (v === null ? 'not_evaluated' : v ? 'in_scope' : 'out_of_scope')

  return [
    { program: 'stormwater',      status: stormwater },
    { program: 'outfall',         status: outfall },
    { program: 'air',             status: air },
    { program: 'wastewater',      status: wastewater },
    { program: 'hazardous_waste', status: waste },
    { program: 'manifest',        status: waste },
    { program: 'spcc',            status: tri(profile.spccApplicable) },
    { program: 'epcra',           status: tri(profile.tier2Applicable) },
  ]
}
