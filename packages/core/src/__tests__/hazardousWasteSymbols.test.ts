import { describe, it, expect } from 'vitest'
import {
  validateHazardSymbolFields,
  validateHazardousWasteStreamInput,
  type HazardousWasteStreamInput,
} from '../hazardousWaste'

// Contract tests for the hazard-communication symbol validation added in
// migration 239. The validator is the trust boundary the API routes rely on,
// so these assert the catalog/enum checks and that a clean payload passes.

function emptySymbols() {
  return {
    ghs_pictograms:    [] as never[],
    ghs_signal_word:   null,
    nfpa_health:       null,
    nfpa_flammability: null,
    nfpa_instability:  null,
    nfpa_special:      null,
    dot_hazard_class:  null,
    dot_packing_group: null,
  }
}

describe('validateHazardSymbolFields', () => {
  it('accepts an all-null / empty payload (every field is optional)', () => {
    expect(validateHazardSymbolFields(emptySymbols())).toEqual([])
  })

  it('accepts a fully-populated, in-catalog payload', () => {
    const errors = validateHazardSymbolFields({
      ghs_pictograms:    ['GHS02', 'GHS07'],
      ghs_signal_word:   'danger',
      nfpa_health:       1,
      nfpa_flammability: 3,
      nfpa_instability:  0,
      nfpa_special:      'W',
      dot_hazard_class:  '3',
      dot_packing_group: 'II',
    })
    expect(errors).toEqual([])
  })

  it('rejects an unknown GHS pictogram code', () => {
    const errors = validateHazardSymbolFields({ ...emptySymbols(), ghs_pictograms: ['GHS99'] as never })
    expect(errors).toEqual([{ field: 'ghs_pictograms', message: 'Unknown GHS pictogram: GHS99' }])
  })

  it('rejects an invalid signal word', () => {
    const errors = validateHazardSymbolFields({ ...emptySymbols(), ghs_signal_word: 'caution' as never })
    expect(errors.map(e => e.field)).toEqual(['ghs_signal_word'])
  })

  it('rejects NFPA ratings outside 0-4 or non-integer', () => {
    const errors = validateHazardSymbolFields({
      ...emptySymbols(),
      nfpa_health:       5,
      nfpa_flammability: -1,
      nfpa_instability:  2.5,
    })
    expect(errors.map(e => e.field).sort()).toEqual(
      ['nfpa_flammability', 'nfpa_health', 'nfpa_instability'],
    )
  })

  it('rejects an unknown NFPA special symbol', () => {
    const errors = validateHazardSymbolFields({ ...emptySymbols(), nfpa_special: 'XX' })
    expect(errors.map(e => e.field)).toEqual(['nfpa_special'])
  })

  it('rejects an invalid DOT hazard class and packing group', () => {
    const errors = validateHazardSymbolFields({
      ...emptySymbols(),
      dot_hazard_class:  '99',
      dot_packing_group: 'IV' as never,
    })
    expect(errors.map(e => e.field).sort()).toEqual(['dot_hazard_class', 'dot_packing_group'])
  })
})

describe('validateHazardousWasteStreamInput with symbols', () => {
  function baseInput(): HazardousWasteStreamInput {
    return {
      name:                'Spent acetone',
      generating_process:  null,
      description:         null,
      physical_state:      null,
      hazards:             [],
      waste_codes:         [],
      generator_category:  'lqg',
      long_haul:           false,
      determination_basis: null,
      status:              'draft',
      owner_user_id:       null,
      review_due_date:     null,
      notes:               null,
      ghs_pictograms:           [],
      ghs_signal_word:          null,
      nfpa_health:              null,
      nfpa_flammability:        null,
      nfpa_instability:         null,
      nfpa_special:             null,
      dot_un_number:            null,
      dot_hazard_class:         null,
      dot_packing_group:        null,
      dot_proper_shipping_name: null,
    }
  }

  it('passes a valid stream with symbols', () => {
    const input = baseInput()
    input.ghs_pictograms = ['GHS02']
    input.dot_hazard_class = '3'
    expect(validateHazardousWasteStreamInput(input)).toEqual([])
  })

  it('surfaces symbol errors alongside core errors', () => {
    const input = baseInput()
    input.name = '' // core error
    input.dot_hazard_class = 'bogus' // symbol error
    const fields = validateHazardousWasteStreamInput(input).map(e => e.field)
    expect(fields).toContain('name')
    expect(fields).toContain('dot_hazard_class')
  })
})
