import { describe, expect, it } from 'vitest'
import {
  allWasteCodesValid,
  classifyWasteCode,
  EPA_CHARACTERISTIC_CODES,
  partitionWasteCodes,
} from '@soteria/core/wasteCodes'
import {
  universalWasteCategories,
  UNIVERSAL_WASTE_CATEGORY_LABEL,
} from '@soteria/core/hazardousWaste'

describe('classifyWasteCode', () => {
  it('recognizes EPA codes and their kind', () => {
    expect(classifyWasteCode('D001')).toMatchObject({ system: 'epa', epaKind: 'characteristic', label: 'Ignitability' })
    expect(classifyWasteCode('f003')).toMatchObject({ system: 'epa', epaKind: 'non_specific_source', code: 'F003' })
    expect(classifyWasteCode('P030')).toMatchObject({ system: 'epa', epaKind: 'acute' })
    expect(classifyWasteCode('U154')).toMatchObject({ system: 'epa', epaKind: 'toxic' })
    expect(classifyWasteCode('K071')).toMatchObject({ system: 'epa', epaKind: 'specific_source' })
  })

  it('recognizes California three-digit codes', () => {
    expect(classifyWasteCode('134')).toMatchObject({ system: 'california', valid: true })
    expect(classifyWasteCode('221')).toMatchObject({ system: 'california', valid: true })
  })

  it('flags unrecognized codes as invalid', () => {
    expect(classifyWasteCode('XYZ')).toMatchObject({ system: 'unknown', valid: false })
    expect(classifyWasteCode('D01')).toMatchObject({ system: 'unknown', valid: false })
  })

  it('exposes the full characteristic D-list', () => {
    expect(EPA_CHARACTERISTIC_CODES.D008).toBe('Lead')
    expect(Object.keys(EPA_CHARACTERISTIC_CODES)).toContain('D043')
  })
})

describe('partitionWasteCodes', () => {
  it('splits a mixed manifest array', () => {
    const p = partitionWasteCodes(['D001', '134', 'F003', '791', 'bogus'])
    expect(p.epa).toEqual(['D001', 'F003'])
    expect(p.california).toEqual(['134', '791'])
    expect(p.unknown).toEqual(['BOGUS'])
  })

  it('allWasteCodesValid is false when any code is unrecognized', () => {
    expect(allWasteCodesValid(['D001', '134'])).toBe(true)
    expect(allWasteCodesValid(['D001', 'nope'])).toBe(false)
  })
})

describe('universalWasteCategories', () => {
  it('federal covers five categories', () => {
    const fed = universalWasteCategories('federal')
    expect(fed).toContain('pesticides')
    expect(fed).not.toContain('pv_modules')
    expect(fed.length).toBe(5)
  })

  it('California adds electronics, CRTs, CRT glass, and PV modules', () => {
    const ca = universalWasteCategories('california')
    expect(ca).toContain('electronic_devices')
    expect(ca).toContain('crts')
    expect(ca).toContain('pv_modules')
    expect(UNIVERSAL_WASTE_CATEGORY_LABEL.pv_modules).toMatch(/solar/i)
  })
})
