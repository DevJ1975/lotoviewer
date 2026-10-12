import { describe, it, expect } from 'vitest'
import {
  EMPTY_SITE_PROFILE, parseSiteProfile, toProfileRow, validateSiteProfile, programsInScope,
  ENV_PROGRAMS, type SiteProfile,
} from '../../environmental/siteProfile'

const profile = (over: Partial<SiteProfile> = {}): SiteProfile => ({ ...EMPTY_SITE_PROFILE, ...over })
const statusOf = (p: SiteProfile, program: string, gen: 'lqg' | 'sqg' | 'vsqg' | null = null) =>
  programsInScope(p, gen).find(s => s.program === program)!.status

describe('parseSiteProfile', () => {
  it('is empty and unevaluated for no row', () => {
    expect(parseSiteProfile(null)).toEqual(EMPTY_SITE_PROFILE)
    expect(parseSiteProfile(undefined)).toEqual(EMPTY_SITE_PROFILE)
  })

  it('does not hand back a shared object it could be mutated through', () => {
    const a = parseSiteProfile(null)
    a.localAgencies.cupa = 'changed'
    expect(parseSiteProfile(null).localAgencies.cupa).toBeNull()
    expect(EMPTY_SITE_PROFILE.localAgencies.cupa).toBeNull()
  })

  it('reads a stored row', () => {
    const p = parseSiteProfile({
      stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp', sic_codes: ['2096'],
      air_permit_type: 'minor_permit', wastewater_discharge: 'potw_indirect', pretreatment_status: 'ciu',
      potw_name: 'City POTW', local_agencies: { air_district: 'SCAQMD', cupa: 'San Bernardino CUPA' },
      spcc_applicable: true, tier2_applicable: false,
    })
    expect(p).toMatchObject({
      stormwaterCoverage: 'general_permit', stormwaterGeneralPermit: 'ca_igp', sicCodes: ['2096'],
      airPermitType: 'minor_permit', pretreatmentStatus: 'ciu', potwName: 'City POTW',
      spccApplicable: true, tier2Applicable: false,
    })
    expect(p.localAgencies).toEqual({ airDistrict: 'SCAQMD', cupa: 'San Bernardino CUPA', regionalBoard: null, potw: null })
  })

  it('reads an unknown enum value as not_evaluated, the safe direction', () => {
    const p = parseSiteProfile({ stormwater_coverage: 'wat', air_permit_type: 7, spcc_applicable: 'yes' })
    expect(p.stormwaterCoverage).toBe('not_evaluated')
    expect(p.airPermitType).toBe('not_evaluated')
    expect(p.spccApplicable).toBeNull()
  })

  it('round-trips through toProfileRow', () => {
    const original = profile({
      stormwaterCoverage: 'general_permit', stormwaterGeneralPermit: 'tx_txr05', sicCodes: ['2051'], naicsCodes: ['311812'],
      airPermitType: 'registration_or_pbr', wastewaterDischarge: 'npdes_direct', pretreatmentStatus: 'not_regulated',
      potwName: null, localAgencies: { airDistrict: null, cupa: 'X', regionalBoard: null, potw: null },
      spccApplicable: false, tier2Applicable: true, notes: 'n',
    })
    expect(parseSiteProfile(toProfileRow(original))).toEqual({ ...original, confirmedAt: null })
  })
})

describe('validateSiteProfile', () => {
  const ok = (body: unknown, current?: SiteProfile) => {
    const r = validateSiteProfile(body, current)
    if (!r.ok) throw new Error(r.errors.join(' | '))
    return r.profile
  }
  const errors = (body: unknown, current?: SiteProfile) => {
    const r = validateSiteProfile(body, current)
    return r.ok ? [] : r.errors
  }

  it('applies only the fields sent, keeping the rest', () => {
    const current = profile({ airPermitType: 'title_v', potwName: 'Keep me' })
    const p = ok({ stormwater_coverage: 'no_exposure' }, current)
    expect(p).toMatchObject({ stormwaterCoverage: 'no_exposure', airPermitType: 'title_v', potwName: 'Keep me' })
  })

  it('rejects what it does not understand instead of silently dropping it', () => {
    expect(errors({ stormwater_coverage: 'maybe' })[0]).toMatch(/stormwater_coverage must be one of/)
    expect(errors({ air_permit_type: 5 })[0]).toMatch(/air_permit_type/)
    expect(errors({ spcc_applicable: 'yes' })[0]).toMatch(/true, false or null/)
    expect(errors('nope')).toEqual(['Expected an object.'])
    expect(errors([])).toEqual(['Expected an object.'])
    expect(errors(null)).toEqual(['Expected an object.'])
  })

  it('reports every problem at once', () => {
    expect(errors({ stormwater_coverage: 'x', air_permit_type: 'y', wastewater_discharge: 'z' })).toHaveLength(3)
  })

  it('validates SIC and NAICS code shapes and caps the list', () => {
    expect(ok({ sic_codes: ['2096', ' 2051 ', '2096'] }).sicCodes).toEqual(['2096', '2051'])
    expect(errors({ sic_codes: ['209'] })[0]).toMatch(/invalid SIC/)
    expect(errors({ sic_codes: ['abcd'] })[0]).toMatch(/invalid SIC/)
    expect(errors({ naics_codes: ['1'] })[0]).toMatch(/invalid NAICS/)
    expect(ok({ naics_codes: ['311', '311812'] }).naicsCodes).toEqual(['311', '311812'])
    expect(errors({ sic_codes: Array.from({ length: 21 }, () => '2096') })[0]).toMatch(/at most 20/)
    expect(errors({ sic_codes: 'x' })[0]).toMatch(/at most 20/)
  })

  it('accepts a general-permit key only alongside general-permit coverage', () => {
    expect(ok({ stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp' }).stormwaterGeneralPermit).toBe('ca_igp')
    expect(errors({ stormwater_coverage: 'not_required', stormwater_general_permit: 'ca_igp' })[0]).toMatch(/only applies when/)
    expect(errors({ stormwater_coverage: 'general_permit', stormwater_general_permit: 'Not A Key!' })[0]).toMatch(/short key/)
  })

  it('drops a stale general-permit key when coverage changes away from a general permit', () => {
    const current = profile({ stormwaterCoverage: 'general_permit', stormwaterGeneralPermit: 'ca_igp' })
    expect(ok({ stormwater_coverage: 'no_exposure' }, current).stormwaterGeneralPermit).toBeNull()
  })

  it('bounds text fields and treats blank as cleared', () => {
    expect(errors({ potw_name: 'x'.repeat(201) })[0]).toMatch(/too long/)
    expect(errors({ notes: 'x'.repeat(2001) })[0]).toMatch(/too long/)
    expect(ok({ potw_name: '  ' }, profile({ potwName: 'Old' })).potwName).toBeNull()
    expect(ok({ potw_name: null }, profile({ potwName: 'Old' })).potwName).toBeNull()
    expect(errors({ potw_name: 7 })[0]).toMatch(/must be text/)
  })

  it('validates local agencies as an object of text, merging into what was there', () => {
    const current = profile({ localAgencies: { airDistrict: 'SCAQMD', cupa: null, regionalBoard: null, potw: null } })
    const p = ok({ local_agencies: { cupa: 'My CUPA' } }, current)
    expect(p.localAgencies).toEqual({ airDistrict: 'SCAQMD', cupa: 'My CUPA', regionalBoard: null, potw: null })
    expect(errors({ local_agencies: 'x' })[0]).toMatch(/must be an object/)
    expect(errors({ local_agencies: { cupa: 5 } })[0]).toMatch(/local_agencies.cupa/)
  })

  it('never lets a client set confirmedAt', () => {
    expect(ok({ confirmed_at: '2020-01-01' }, profile({ confirmedAt: null })).confirmedAt).toBeNull()
  })

  it('accepts null to put an applicability answer back to "not evaluated"', () => {
    expect(ok({ spcc_applicable: null }, profile({ spccApplicable: true })).spccApplicable).toBeNull()
  })
})

describe('programsInScope', () => {
  it('lists every program once', () => {
    expect(programsInScope(EMPTY_SITE_PROFILE).map(s => s.program)).toEqual([...ENV_PROGRAMS])
  })

  it('a brand-new site is not evaluated everywhere: nothing is assumed out of scope', () => {
    expect(programsInScope(EMPTY_SITE_PROFILE).every(s => s.status === 'not_evaluated')).toBe(true)
  })

  it('stormwater follows coverage: a permit or no-exposure is in scope, not_required is out', () => {
    expect(statusOf(profile({ stormwaterCoverage: 'general_permit' }), 'stormwater')).toBe('in_scope')
    expect(statusOf(profile({ stormwaterCoverage: 'individual_permit' }), 'stormwater')).toBe('in_scope')
    expect(statusOf(profile({ stormwaterCoverage: 'no_exposure' }), 'stormwater')).toBe('in_scope')
    expect(statusOf(profile({ stormwaterCoverage: 'not_required' }), 'stormwater')).toBe('out_of_scope')
  })

  it('outfalls follow stormwater coverage or a direct NPDES discharge', () => {
    expect(statusOf(profile({ stormwaterCoverage: 'general_permit' }), 'outfall')).toBe('in_scope')
    expect(statusOf(profile({ stormwaterCoverage: 'not_required', wastewaterDischarge: 'npdes_direct' }), 'outfall')).toBe('in_scope')
    expect(statusOf(profile({ stormwaterCoverage: 'not_required', wastewaterDischarge: 'potw_indirect' }), 'outfall')).toBe('out_of_scope')
    expect(statusOf(EMPTY_SITE_PROFILE, 'outfall')).toBe('not_evaluated')
  })

  it('air: exempt and not-required are out; any permit or registration is in', () => {
    for (const t of ['registration_or_pbr', 'minor_permit', 'synthetic_minor', 'title_v'] as const) {
      expect(statusOf(profile({ airPermitType: t }), 'air'), t).toBe('in_scope')
    }
    for (const t of ['exempt', 'not_required'] as const) expect(statusOf(profile({ airPermitType: t }), 'air'), t).toBe('out_of_scope')
  })

  it('wastewater: only a sewer or a direct discharge puts it in scope', () => {
    expect(statusOf(profile({ wastewaterDischarge: 'potw_indirect' }), 'wastewater')).toBe('in_scope')
    expect(statusOf(profile({ wastewaterDischarge: 'npdes_direct' }), 'wastewater')).toBe('in_scope')
    for (const d of ['none', 'zero_discharge', 'septic'] as const) {
      expect(statusOf(profile({ wastewaterDischarge: d }), 'wastewater'), d).toBe('out_of_scope')
    }
  })

  it('hazardous waste and manifests follow the generator category passed in, every category counting', () => {
    expect(statusOf(EMPTY_SITE_PROFILE, 'hazardous_waste', null)).toBe('not_evaluated')
    for (const g of ['lqg', 'sqg', 'vsqg'] as const) {
      expect(statusOf(EMPTY_SITE_PROFILE, 'hazardous_waste', g)).toBe('in_scope')
      expect(statusOf(EMPTY_SITE_PROFILE, 'manifest', g)).toBe('in_scope')
    }
  })

  it('SPCC and EPCRA are three-state', () => {
    expect(statusOf(profile({ spccApplicable: true }), 'spcc')).toBe('in_scope')
    expect(statusOf(profile({ spccApplicable: false }), 'spcc')).toBe('out_of_scope')
    expect(statusOf(profile({ tier2Applicable: null }), 'epcra')).toBe('not_evaluated')
  })
})
