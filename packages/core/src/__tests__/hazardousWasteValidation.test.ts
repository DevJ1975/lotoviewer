import { describe, expect, it } from 'vitest'
import {
  HAZARDOUS_WASTE_AREA_LABEL,
  HAZARDOUS_WASTE_AREA_TYPES,
  getChecksForArea,
  validateHazardousWasteContainerInput,
  type HazardousWasteAreaType,
  type HazardousWasteContainerInput,
} from '../hazardousWaste'

// Boundary coverage for the container-input validator (it guards the
// POST /api/hazardous-waste/containers trust boundary) plus invariants
// tying HAZARDOUS_WASTE_AREA_TYPES to the structures keyed by it.

function input(overrides: Partial<HazardousWasteContainerInput> = {}): HazardousWasteContainerInput {
  return {
    stream_id: 'stream-1',
    label: 'Drum 7',
    area_type: 'satellite_accumulation',
    area_location: null,
    accumulation_started_at: null,
    volume_quantity: null,
    volume_unit: null,
    status: 'open',
    notes: null,
    ...overrides,
  }
}

function fieldsWithErrors(i: HazardousWasteContainerInput): string[] {
  return validateHazardousWasteContainerInput(i).map(e => e.field)
}

describe('validateHazardousWasteContainerInput', () => {
  it('accepts a minimal valid container', () => {
    expect(validateHazardousWasteContainerInput(input())).toEqual([])
  })

  it('label: rejects empty and whitespace-only, accepts 1 and 120 chars, rejects 121', () => {
    expect(fieldsWithErrors(input({ label: '' }))).toContain('label')
    expect(fieldsWithErrors(input({ label: '   ' }))).toContain('label')
    expect(fieldsWithErrors(input({ label: 'x' }))).toEqual([])
    expect(fieldsWithErrors(input({ label: 'x'.repeat(120) }))).toEqual([])
    expect(fieldsWithErrors(input({ label: 'x'.repeat(121) }))).toContain('label')
  })

  it('label: accepts unicode subscripts and quotes (H₂SO₄ drums exist)', () => {
    expect(fieldsWithErrors(input({ label: 'H₂SO₄ "spent" drum #3' }))).toEqual([])
  })

  it('requires stream_id', () => {
    expect(fieldsWithErrors(input({ stream_id: '' }))).toContain('stream_id')
  })

  it('rejects an unknown area_type and status', () => {
    expect(fieldsWithErrors(input({ area_type: 'rooftop' as HazardousWasteAreaType }))).toContain('area_type')
    expect(fieldsWithErrors(input({ status: 'evaporated' as HazardousWasteContainerInput['status'] }))).toContain('status')
  })

  it('accepts every canonical area_type', () => {
    for (const areaType of HAZARDOUS_WASTE_AREA_TYPES) {
      expect(fieldsWithErrors(input({ area_type: areaType }))).toEqual([])
    }
  })

  it('volume_quantity: accepts 0 and positive, rejects negative and NaN, allows null', () => {
    expect(fieldsWithErrors(input({ volume_quantity: 0 }))).toEqual([])
    expect(fieldsWithErrors(input({ volume_quantity: 55 }))).toEqual([])
    expect(fieldsWithErrors(input({ volume_quantity: -1 }))).toContain('volume_quantity')
    expect(fieldsWithErrors(input({ volume_quantity: Number.NaN }))).toContain('volume_quantity')
    expect(fieldsWithErrors(input({ volume_quantity: null }))).toEqual([])
  })

  it('volume_unit: rejects an unknown unit but allows null', () => {
    expect(fieldsWithErrors(input({ volume_unit: 'hogsheads' as HazardousWasteContainerInput['volume_unit'] }))).toContain('volume_unit')
    expect(fieldsWithErrors(input({ volume_unit: null }))).toEqual([])
  })

  it('accumulation_started_at: rejects garbage dates, allows null and ISO strings', () => {
    expect(fieldsWithErrors(input({ accumulation_started_at: 'not-a-date' }))).toContain('accumulation_started_at')
    expect(fieldsWithErrors(input({ accumulation_started_at: '2026-06-01' }))).toEqual([])
    expect(fieldsWithErrors(input({ accumulation_started_at: null }))).toEqual([])
  })

  it('reports every invalid field at once, not just the first', () => {
    const fields = fieldsWithErrors(input({
      label: '',
      stream_id: '',
      volume_quantity: -5,
    }))
    expect(fields).toEqual(expect.arrayContaining(['label', 'stream_id', 'volume_quantity']))
  })
})

describe('HAZARDOUS_WASTE_AREA_TYPES invariants', () => {
  it('matches the label map key-for-key', () => {
    expect([...HAZARDOUS_WASTE_AREA_TYPES].sort()).toEqual(Object.keys(HAZARDOUS_WASTE_AREA_LABEL).sort())
  })

  it('yields at least one field check for every area type', () => {
    for (const areaType of HAZARDOUS_WASTE_AREA_TYPES) {
      expect(getChecksForArea(areaType).length, `${areaType} has no checks`).toBeGreaterThan(0)
    }
  })
})
