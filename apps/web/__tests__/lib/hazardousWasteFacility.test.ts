import { describe, expect, it } from 'vitest'
import {
  ageStatusForContainer,
  parseFacilityProfile,
  resolveGeneratorProfile,
  validateHazardousWasteFacilityProfile,
  EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE,
  type HazardousWasteFacilityProfile,
  type HazardousWasteStreamRow,
} from '@soteria/core/hazardousWaste'

const STREAM: Pick<HazardousWasteStreamRow, 'generator_category' | 'long_haul'> & { jurisdiction: 'federal' | 'california' } = {
  generator_category: 'vsqg',
  long_haul: false,
  jurisdiction: 'federal',
}

describe('parseFacilityProfile', () => {
  it('returns empty defaults for missing/garbage settings', () => {
    expect(parseFacilityProfile(null)).toEqual(EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE)
    expect(parseFacilityProfile({})).toEqual(EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE)
    expect(parseFacilityProfile({ hazardous_waste: 'nope' })).toEqual(EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE)
  })

  it('reads a stored profile and drops invalid values', () => {
    const p = parseFacilityProfile({
      hazardous_waste: {
        generator_category: 'lqg',
        jurisdiction: 'california',
        epa_id_number: '  CAL000111222  ',
        long_haul_default: true,
        junk: 1,
      },
    })
    expect(p).toEqual({
      generator_category: 'lqg',
      jurisdiction: 'california',
      epa_id_number: 'CAL000111222',
      long_haul_default: true,
    })
  })

  it('nulls out invalid enum values', () => {
    const p = parseFacilityProfile({ hazardous_waste: { generator_category: 'xxl', jurisdiction: 'mars' } })
    expect(p.generator_category).toBeNull()
    expect(p.jurisdiction).toBeNull()
  })
})

describe('validateHazardousWasteFacilityProfile', () => {
  it('accepts an empty profile', () => {
    expect(validateHazardousWasteFacilityProfile(EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE)).toEqual([])
  })
  it('rejects bad values', () => {
    const bad: HazardousWasteFacilityProfile = {
      generator_category: 'nope' as never,
      jurisdiction: 'nowhere' as never,
      epa_id_number: 'x'.repeat(41),
      long_haul_default: false,
    }
    const errors = validateHazardousWasteFacilityProfile(bad)
    expect(errors.map(e => e.field).sort()).toEqual(['epa_id_number', 'generator_category', 'jurisdiction'])
  })
})

describe('resolveGeneratorProfile', () => {
  it('falls back to the stream when no facility profile', () => {
    const r = resolveGeneratorProfile(null, STREAM)
    expect(r).toMatchObject({ category: 'vsqg', jurisdiction: 'federal', source: 'stream' })
  })

  it('prefers the facility category and jurisdiction when set', () => {
    const facility: HazardousWasteFacilityProfile = {
      generator_category: 'lqg',
      jurisdiction: 'california',
      epa_id_number: null,
      long_haul_default: false,
    }
    const r = resolveGeneratorProfile(facility, STREAM)
    expect(r).toMatchObject({ category: 'lqg', jurisdiction: 'california', source: 'facility' })
  })
})

describe('ageStatusForContainer with a facility profile', () => {
  const now = new Date('2026-05-14T12:00:00Z')
  const started = new Date(now.getTime() - 100 * 86_400_000).toISOString() // 100 days
  const container = {
    accumulation_started_at: started, status: 'open' as const,
    area_type: 'central_accumulation' as const,
  }

  it('uses the facility LQG category over the stream VSQG (100d → over 90d)', () => {
    const facility: HazardousWasteFacilityProfile = {
      generator_category: 'lqg', jurisdiction: 'federal', epa_id_number: null, long_haul_default: false,
    }
    const r = ageStatusForContainer(container, STREAM, now, facility)
    expect(r.limitDays).toBe(90)
    expect(r.status).toBe('over_limit')
  })

  it('without a facility profile, falls back to the stream (federal VSQG = no limit)', () => {
    const r = ageStatusForContainer(container, STREAM, now)
    expect(r.limitDays).toBeNull()
  })
})
