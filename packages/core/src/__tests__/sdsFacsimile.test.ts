import { describe, it, expect } from 'vitest'
import {
  buildSdsFacsimile,
  SDS_FACSIMILE_EMPTY_SECTION_NOTE,
  type SdsFacsimileModel,
} from '../sdsFacsimile'
import type { ParsedSdsPayload } from '../chemicals'

const META = { sourceUrl: 'https://fishersci.com/acetone.pdf', parsedDate: '2026-06-01', parseModel: 'claude-sonnet-4-6' }

// A fully-populated payload — one value per parser field so we can assert the
// section mapping end to end.
function fullPayload(): ParsedSdsPayload {
  return {
    product_name:    'Acetone',
    manufacturer:    'Fisher Scientific',
    product_code:    'A18-4',
    recommended_use: 'Laboratory solvent',
    emergency_phone: '1-800-424-9300',
    cas_numbers:     ['67-64-1'],
    synonyms:        ['2-Propanone', 'Dimethyl ketone'],
    physical_state:  'liquid',
    appearance:      'Clear colorless liquid',
    flash_point_c:    -20,
    boiling_point_c:  56,
    vapor_pressure_kpa: 30.8,
    ghs_signal_word: 'danger',
    ghs_pictograms:  ['GHS02', 'GHS07'],
    hazard_statements: [
      { code: 'H225', text: 'Highly flammable liquid and vapour.' },
      { code: 'H319', text: 'Causes serious eye irritation.' },
    ],
    precautionary_statements: [
      { code: 'P210', text: 'Keep away from heat.' },
    ],
    nfpa_health: 1, nfpa_flammability: 3, nfpa_instability: 0, nfpa_special: null,
    pel_twa_ppm: 1000, stel_ppm: 750, idlh_ppm: 2500,
    ppe_required: ['Nitrile gloves', 'Safety goggles'],
    first_aid: {
      inhalation: 'Move to fresh air.', skin: 'Wash with soap and water.',
      eyes: 'Rinse cautiously with water.', ingestion: 'Rinse mouth.', notes: null,
    },
    firefighting: {
      suitable_extinguishers: ['CO2', 'Dry chemical'],
      unsuitable_extinguishers: ['Water jet'],
      special_hazards: 'Vapours are heavier than air.',
      protective_equipment: 'Self-contained breathing apparatus.',
    },
    spill_cleanup: {
      personal_precautions: 'Remove ignition sources.',
      environmental_precautions: 'Do not flush to drains.',
      containment_methods: 'Dike to contain.', cleanup_methods: 'Absorb with inert material.',
    },
    storage_class: 'Flammable liquid', incompatibilities: ['Strong oxidizers'],
    dot_un_number: 'UN1090', dot_hazard_class: '3', dot_packing_group: 'II',
    sds_revision_date: '2025-03-12', sds_language: 'en',
    confidence: {
      overall: 'high', identification: 'high', hazards: 'high', physical: 'high',
      exposure: 'high', first_aid: 'high', firefighting: 'high', spill_cleanup: 'high', transport: 'high',
    },
    parser_notes: 'Section 8 quoted ppm directly.',
  }
}

const byNumber = (m: SdsFacsimileModel, n: number) =>
  m.sections.find(s => s.number === n)!
const valueOf = (m: SdsFacsimileModel, n: number, label: string) =>
  byNumber(m, n).fields.find(f => f.label === label)?.value

describe('buildSdsFacsimile — golden path', () => {
  const model = buildSdsFacsimile(fullPayload(), META)

  it('emits all 16 sections in canonical order', () => {
    expect(model.sections.map(s => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(byNumber(model, 1).title).toBe('Identification')
    expect(byNumber(model, 14).title).toBe('Transport Information')
  })

  it('maps identification and composition fields', () => {
    expect(valueOf(model, 1, 'Product name')).toBe('Acetone')
    expect(valueOf(model, 1, 'Manufacturer')).toBe('Fisher Scientific')
    expect(valueOf(model, 3, 'CAS number(s)')).toBe('67-64-1')
    expect(valueOf(model, 3, 'Synonyms')).toBe('2-Propanone, Dimethyl ketone')
  })

  it('renders signal word uppercased, pictograms as labels, and H/P codes as rows', () => {
    expect(model.signalWord).toBe('danger')
    expect(valueOf(model, 2, 'Signal word')).toBe('DANGER')
    expect(valueOf(model, 2, 'Pictograms')).toBe('Flammable, Irritant / harmful')
    expect(model.pictograms).toEqual(['GHS02', 'GHS07'])
    expect(byNumber(model, 2).fields.find(f => f.label === 'H225')?.value)
      .toBe('Highly flammable liquid and vapour.')
    expect(byNumber(model, 2).fields.find(f => f.label === 'P210')?.value)
      .toBe('Keep away from heat.')
  })

  it('formats numeric properties with units', () => {
    expect(valueOf(model, 8, 'OSHA PEL (TWA)')).toBe('1000 ppm')
    expect(valueOf(model, 9, 'Flash point')).toBe('-20 °C')
    expect(valueOf(model, 9, 'Vapor pressure')).toBe('30.8 kPa')
  })

  it('maps first-aid, firefighting, spill, and transport sections', () => {
    expect(valueOf(model, 4, 'Inhalation')).toBe('Move to fresh air.')
    expect(valueOf(model, 5, 'Suitable extinguishing media')).toBe('CO2, Dry chemical')
    expect(valueOf(model, 6, 'Personal precautions')).toBe('Remove ignition sources.')
    expect(valueOf(model, 14, 'UN number')).toBe('UN1090')
  })

  it('leaves unparsed sections empty so consumers show the not-extracted note', () => {
    for (const n of [10, 11, 12, 13, 15]) {
      expect(byNumber(model, n).fields).toEqual([])
    }
    // The note itself is a single-sourced constant the consumers render.
    expect(SDS_FACSIMILE_EMPTY_SECTION_NOTE).toMatch(/not extracted/i)
  })

  it('carries provenance for the mandatory banner', () => {
    expect(model.provenance).toEqual({
      sourceUrl: 'https://fishersci.com/acetone.pdf',
      revisionDate: '2025-03-12',
      parsedDate: '2026-06-01',
      parseModel: 'claude-sonnet-4-6',
      parseConfidence: 'high',
    })
  })
})

describe('buildSdsFacsimile — boundaries', () => {
  it('drops blank/null fields rather than render dangling labels', () => {
    const sparse = { ...fullPayload(), manufacturer: null, product_code: '', synonyms: [], stel_ppm: null }
    const model = buildSdsFacsimile(sparse, META)
    const ids = byNumber(model, 1).fields.map(f => f.label)
    expect(ids).not.toContain('Manufacturer')
    expect(ids).not.toContain('Product code')
    expect(byNumber(model, 3).fields.map(f => f.label)).not.toContain('Synonyms')
    expect(byNumber(model, 8).fields.map(f => f.label)).not.toContain('STEL')
  })

  it('drops an invalid pictogram code and an out-of-range signal word', () => {
    const payload = {
      ...fullPayload(),
      ghs_pictograms: ['GHS02', 'GHS99', 'nonsense'],
      ghs_signal_word: 'caution',
    } as unknown as ParsedSdsPayload
    const model = buildSdsFacsimile(payload, META)
    expect(model.pictograms).toEqual(['GHS02'])
    expect(model.signalWord).toBeNull()
    expect(valueOf(model, 2, 'Signal word')).toBeUndefined()
  })

  it('tolerates a malformed jsonb payload without throwing', () => {
    const garbage = {
      product_name: 'X',
      ghs_pictograms: 'not-an-array',
      hazard_statements: 'nope',
      firefighting: 'nope',
      cas_numbers: [123, null, 'OK'],
      confidence: 'broken',
    } as unknown as ParsedSdsPayload
    const model = buildSdsFacsimile(garbage, { sourceUrl: null, parsedDate: null, parseModel: null })
    expect(model.productName).toBe('X')
    expect(model.pictograms).toEqual([])
    expect(byNumber(model, 2).fields.filter(f => f.label.startsWith('H'))).toEqual([])
    expect(valueOf(model, 3, 'CAS number(s)')).toBe('OK')
    expect(model.provenance.parseConfidence).toBeNull()
    // All 16 sections still present.
    expect(model.sections).toHaveLength(16)
  })

  it('uses the code as the value for a statement with no text, and "—" as the label for one with no code', () => {
    const payload = {
      ...fullPayload(),
      hazard_statements: [{ code: 'H225', text: '' }, { code: '', text: 'orphan text' }],
    }
    const model = buildSdsFacsimile(payload, META)
    const s2 = byNumber(model, 2).fields
    expect(s2.find(f => f.label === 'H225')?.value).toBe('H225')
    expect(s2.find(f => f.label === '—')?.value).toBe('orphan text')
  })
})
