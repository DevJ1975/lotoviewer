import { describe, it, expect } from 'vitest'
import {
  isValidCas,
  validateProductInput,
  chemicalSdsStoragePath,
  GHS_PICTOGRAMS,
} from '@soteria/core/chemicals'

describe('isValidCas', () => {
  it.each([
    '64-17-5',     // ethanol
    '7732-18-5',   // water
    '67-64-1',     // acetone
    '110-54-3',    // n-hexane
  ])('accepts well-formed CAS %s', cas => {
    expect(isValidCas(cas)).toBe(true)
  })

  it.each([
    '',
    'abc',
    '64175',
    '64-17',
    '64-17-55',
    '1-1-1',          // first group < 2 digits
    '12345678-12-3',  // first group > 7 digits
  ])('rejects malformed CAS %s', cas => {
    expect(isValidCas(cas)).toBe(false)
  })
})

describe('validateProductInput', () => {
  it('requires a name', () => {
    const errs = validateProductInput({ name: '' })
    expect(errs.find(e => e.field === 'name')).toBeTruthy()
  })

  it('rejects unknown GHS pictograms', () => {
    const errs = validateProductInput({
      name: 'X',
      ghs_pictograms: ['GHS01', 'GHS99'] as never,
    })
    expect(errs.find(e => e.field === 'ghs_pictograms')).toBeTruthy()
  })

  it('rejects NFPA values outside 0..4', () => {
    const errs = validateProductInput({
      name: 'X',
      nfpa_health: 5,
    })
    expect(errs.find(e => e.field === 'nfpa_health')).toBeTruthy()
  })

  it('accepts a fully-valid input', () => {
    const errs = validateProductInput({
      name:            'Acetone',
      manufacturer:    'Acme',
      cas_numbers:     ['67-64-1'],
      ghs_pictograms:  ['GHS02', 'GHS07'],
      ghs_signal_word: 'danger',
      nfpa_health:     1,
      nfpa_flammability: 3,
      nfpa_instability: 0,
    })
    expect(errs).toEqual([])
  })

  it('flags every invalid CAS, not just the first', () => {
    const errs = validateProductInput({
      name:        'X',
      cas_numbers: ['67-64-1', 'bogus', 'also-bad'],
    })
    expect(errs.filter(e => e.field === 'cas_numbers')).toHaveLength(2)
  })
})

describe('chemicalSdsStoragePath', () => {
  const t = '00000000-0000-0000-0000-000000000001'
  const p = '00000000-0000-0000-0000-000000000002'

  it('builds the tenant/product/file layout', () => {
    expect(chemicalSdsStoragePath(t, p, 'msds.pdf'))
      .toBe(`${t}/${p}/msds.pdf`)
  })

  it('strips traversal + unsafe characters from the filename', () => {
    expect(chemicalSdsStoragePath(t, p, '../../etc/passwd'))
      .toBe(`${t}/${p}/.._.._etc_passwd`)
  })

  it('falls back to sds.pdf when the filename is empty after sanitization', () => {
    expect(chemicalSdsStoragePath(t, p, '////'))
      .toBe(`${t}/${p}/sds.pdf`)
  })

  it('caps long filenames at 120 chars', () => {
    const long = 'a'.repeat(300) + '.pdf'
    const out = chemicalSdsStoragePath(t, p, long)
    const filename = out.split('/').pop() ?? ''
    expect(filename.length).toBeLessThanOrEqual(120)
  })
})

describe('GHS_PICTOGRAMS', () => {
  it('covers GHS01..GHS09 exactly', () => {
    expect([...GHS_PICTOGRAMS]).toEqual([
      'GHS01','GHS02','GHS03','GHS04','GHS05','GHS06','GHS07','GHS08','GHS09',
    ])
  })
})
