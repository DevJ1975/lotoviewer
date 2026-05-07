import { describe, it, expect } from 'vitest'
import {
  classifyMatrix,
  firstAidVsMedical,
  previewClassificationFromSeverity,
  FIRST_AID_TREATMENTS,
} from '@soteria/core/incidentClassification'

describe('classifyMatrix', () => {
  it('returns extreme for severity=extreme × probability=almost_certain (5×5=25)', () => {
    const c = classifyMatrix('extreme', 'almost_certain')
    expect(c.score).toBe(25)
    expect(c.band).toBe('extreme')
    expect(c.cell).toBe('S5xP5_extreme')
    expect(c.slaHours).toBe(1)
  })

  it('returns low for severity=low × probability=rare (2×1=2)', () => {
    const c = classifyMatrix('low', 'rare')
    expect(c.score).toBe(2)
    expect(c.band).toBe('low')
    expect(c.slaHours).toBeNull()
  })

  it('returns moderate at the 5–9 boundary', () => {
    expect(classifyMatrix('low', 'almost_certain').score).toBe(10) // 2*5
    expect(classifyMatrix('low', 'almost_certain').band).toBe('high')
    expect(classifyMatrix('moderate', 'unlikely').score).toBe(6)   // 3*2
    expect(classifyMatrix('moderate', 'unlikely').band).toBe('moderate')
  })

  it('returns high at the 10–14 boundary', () => {
    expect(classifyMatrix('high', 'unlikely').score).toBe(8)
    expect(classifyMatrix('high', 'unlikely').band).toBe('moderate')
    expect(classifyMatrix('high', 'possible').score).toBe(12)
    expect(classifyMatrix('high', 'possible').band).toBe('high')
  })

  it('produces a stable cell label format', () => {
    const c = classifyMatrix('high', 'possible')
    expect(c.cell).toMatch(/^S\dxP\d_(low|moderate|high|extreme)$/)
  })
})

describe('firstAidVsMedical', () => {
  it('returns first_aid when every treatment is on the canonical list', () => {
    expect(firstAidVsMedical([
      'wound_coverings',
      'tetanus_immunization',
      'hot_or_cold_therapy',
    ])).toBe('first_aid')
  })

  it('returns first_aid for empty input (no treatment given)', () => {
    expect(firstAidVsMedical([])).toBe('first_aid')
  })

  it('returns medical the moment any non-first-aid treatment is present', () => {
    expect(firstAidVsMedical([
      'wound_coverings',
      'sutures',                   // not on the first-aid list
    ])).toBe('medical')
  })

  it('treats prescription drugs as medical (1904.7 example)', () => {
    expect(firstAidVsMedical(['prescription_medication']))
      .toBe('medical')
  })

  it('treats chiropractic adjustment as medical', () => {
    expect(firstAidVsMedical(['chiropractic_adjustment']))
      .toBe('medical')
  })

  it('exposes the canonical list non-empty for the wizard', () => {
    expect(FIRST_AID_TREATMENTS.length).toBeGreaterThan(10)
  })
})

describe('previewClassificationFromSeverity', () => {
  it('maps fatality and catastrophic to death', () => {
    expect(previewClassificationFromSeverity('fatality')).toBe('death')
    expect(previewClassificationFromSeverity('catastrophic')).toBe('death')
  })

  it('maps lost_time to days_away', () => {
    expect(previewClassificationFromSeverity('lost_time')).toBe('days_away')
  })

  it('maps medical to other_recordable', () => {
    expect(previewClassificationFromSeverity('medical')).toBe('other_recordable')
  })

  it('maps first_aid and none to null (not recordable)', () => {
    expect(previewClassificationFromSeverity('first_aid')).toBeNull()
    expect(previewClassificationFromSeverity('none')).toBeNull()
  })
})
