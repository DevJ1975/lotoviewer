import { describe, it, expect } from 'vitest'
import {
  diffSdsPayloads,
  summarizeDiff,
  type SdsFieldDiff,
} from '@soteria/core/sdsDiff'
import type { ParsedSdsPayload } from '@soteria/core/chemicals'

// Mirrors the basePayload helper in chemicals.test.ts so the two suites
// stay legible side by side. A high-confidence Acetone parse; tests
// override only the fields under examination.
function basePayload(over: Partial<ParsedSdsPayload> = {}): ParsedSdsPayload {
  return {
    product_name:    'Acetone',
    manufacturer:    'Acme',
    product_code:    'ACE-100',
    recommended_use: null,
    emergency_phone: null,
    cas_numbers:     ['67-64-1'],
    synonyms:        ['propan-2-one'],
    physical_state:  'liquid',
    appearance:      null,
    flash_point_c:   -20,
    boiling_point_c: 56,
    vapor_pressure_kpa: null,
    ghs_signal_word: 'danger',
    ghs_pictograms:  ['GHS02', 'GHS07'],
    hazard_statements: [{ code: 'H225', text: 'Highly flammable liquid and vapour.' }],
    precautionary_statements: [{ code: 'P210', text: 'Keep away from heat.' }],
    nfpa_health: 1, nfpa_flammability: 3, nfpa_instability: 0, nfpa_special: null,
    pel_twa_ppm: 1000, stel_ppm: null, idlh_ppm: 2500,
    ppe_required: ['Nitrile gloves', 'Safety glasses'],
    first_aid: { inhalation: 'Move to fresh air', skin: null, eyes: null, ingestion: null, notes: null },
    firefighting: { suitable_extinguishers: ['CO2'], unsuitable_extinguishers: [], special_hazards: null, protective_equipment: null },
    spill_cleanup: { personal_precautions: null, environmental_precautions: null, containment_methods: null, cleanup_methods: null },
    storage_class: 'Flammable cabinet',
    incompatibilities: ['Strong oxidizers'],
    dot_un_number: 'UN1090', dot_hazard_class: '3', dot_packing_group: 'II',
    sds_revision_date: '2025-06-01',
    sds_language: 'en',
    confidence: {
      overall: 'high', identification: 'high', hazards: 'high', physical: 'high',
      exposure: 'high', first_aid: 'high', firefighting: 'high', spill_cleanup: 'medium',
      transport: 'high',
    },
    parser_notes: null,
    ...over,
  }
}

// Convenience: pull the single diff row for a field, asserting uniqueness.
function rowFor(diffs: SdsFieldDiff[], field: string): SdsFieldDiff | undefined {
  const matches = diffs.filter(d => d.field === field)
  return matches.length === 1 ? matches[0] : undefined
}

describe('diffSdsPayloads', () => {
  it('returns [] when the payloads are identical', () => {
    expect(diffSdsPayloads(basePayload(), basePayload())).toEqual([])
  })

  it('treats every present value as added when prev is null', () => {
    const diffs = diffSdsPayloads(null, basePayload())
    expect(diffs.every(d => d.kind === 'added')).toBe(true)

    // Hazard classification + NFPA + exposure + physical all surface.
    const fields = diffs.map(d => d.field)
    expect(fields).toContain('ghs_signal_word')
    expect(fields).toContain('ghs_pictograms')
    expect(fields).toContain('hazard_statements')
    expect(fields).toContain('precautionary_statements')
    expect(fields).toContain('nfpa_health')
    expect(fields).toContain('pel_twa_ppm')
    expect(fields).toContain('physical_state')
    expect(fields).toContain('flash_point_c')

    // A null scalar in next (stel_ppm) is NOT reported on a null-prev diff.
    expect(fields).not.toContain('stel_ppm')
  })

  it('adds and removes pictograms by code', () => {
    const prev = basePayload({ ghs_pictograms: ['GHS02', 'GHS07'] })
    const next = basePayload({ ghs_pictograms: ['GHS02', 'GHS09'] }) // -GHS07, +GHS09
    const picto = diffSdsPayloads(prev, next).filter(d => d.field === 'ghs_pictograms')

    expect(picto).toEqual([
      { field: 'ghs_pictograms', label: 'GHS pictograms', kind: 'added',   before: null,    after: 'GHS09' },
      { field: 'ghs_pictograms', label: 'GHS pictograms', kind: 'removed', before: 'GHS07', after: null },
    ])
  })

  it('reports a signal-word change as before → after', () => {
    const diffs = diffSdsPayloads(
      basePayload({ ghs_signal_word: 'warning' }),
      basePayload({ ghs_signal_word: 'danger' }),
    )
    const row = rowFor(diffs, 'ghs_signal_word')
    expect(row).toMatchObject({ kind: 'changed', before: 'warning', after: 'danger' })
  })

  it('adds and removes hazard statements (H-codes) by code', () => {
    const prev = basePayload({
      hazard_statements: [{ code: 'H225', text: 'Flammable' }],
    })
    const next = basePayload({
      hazard_statements: [
        { code: 'H319', text: 'Causes serious eye irritation.' },
        { code: 'H336', text: 'May cause drowsiness.' },
      ],
    })
    const h = diffSdsPayloads(prev, next).filter(d => d.field === 'hazard_statements')
    expect(h.filter(d => d.kind === 'added').map(d => d.after)).toEqual(['H319', 'H336'])
    expect(h.filter(d => d.kind === 'removed').map(d => d.before)).toEqual(['H225'])
  })

  it('adds and removes precautionary statements (P-codes) by code', () => {
    const prev = basePayload({
      precautionary_statements: [{ code: 'P210', text: 'Keep away from heat.' }],
    })
    const next = basePayload({
      precautionary_statements: [
        { code: 'P210', text: 'Keep away from heat.' },
        { code: 'P273', text: 'Avoid release to the environment.' },
      ],
    })
    const p = diffSdsPayloads(prev, next).filter(d => d.field === 'precautionary_statements')
    expect(p).toEqual([
      { field: 'precautionary_statements', label: 'Precautionary statements (P-codes)', kind: 'added', before: null, after: 'P273' },
    ])
  })

  it('ignores a coded statement whose text changed but code did not', () => {
    const prev = basePayload({
      hazard_statements: [{ code: 'H225', text: 'Highly flammable liquid and vapour.' }],
    })
    const next = basePayload({
      hazard_statements: [{ code: 'H225', text: 'Extremely flammable liquid and vapor.' }],
    })
    expect(diffSdsPayloads(prev, next).filter(d => d.field === 'hazard_statements')).toEqual([])
  })

  it('renders a numeric PEL change as "100 → 50" via before/after fields', () => {
    const diffs = diffSdsPayloads(
      basePayload({ pel_twa_ppm: 100 }),
      basePayload({ pel_twa_ppm: 50 }),
    )
    const row = rowFor(diffs, 'pel_twa_ppm')
    expect(row).toMatchObject({ kind: 'changed', before: '100', after: '50' })
    expect(`${row?.before} → ${row?.after}`).toBe('100 → 50')
  })

  it('reports a numeric value newly appearing as added, and disappearing as removed', () => {
    const added = rowFor(
      diffSdsPayloads(basePayload({ stel_ppm: null }), basePayload({ stel_ppm: 250 })),
      'stel_ppm',
    )
    expect(added).toMatchObject({ kind: 'added', before: null, after: '250' })

    const removed = rowFor(
      diffSdsPayloads(basePayload({ idlh_ppm: 2500 }), basePayload({ idlh_ppm: null })),
      'idlh_ppm',
    )
    expect(removed).toMatchObject({ kind: 'removed', before: '2500', after: null })
  })

  it('reports NFPA rating changes', () => {
    const row = rowFor(
      diffSdsPayloads(basePayload({ nfpa_health: 1 }), basePayload({ nfpa_health: 3 })),
      'nfpa_health',
    )
    expect(row).toMatchObject({ kind: 'changed', before: '1', after: '3' })
  })

  it('treats nfpa value 0 as present, not absent', () => {
    // 0 → 2 is a real change; 0 must not be coerced to "missing".
    const row = rowFor(
      diffSdsPayloads(basePayload({ nfpa_instability: 0 }), basePayload({ nfpa_instability: 2 })),
      'nfpa_instability',
    )
    expect(row).toMatchObject({ kind: 'changed', before: '0', after: '2' })
  })

  it('reports physical state and flash point changes', () => {
    const diffs = diffSdsPayloads(
      basePayload({ physical_state: 'liquid', flash_point_c: -20 }),
      basePayload({ physical_state: 'gas',    flash_point_c: -40 }),
    )
    expect(rowFor(diffs, 'physical_state')).toMatchObject({ kind: 'changed', before: 'liquid', after: 'gas' })
    expect(rowFor(diffs, 'flash_point_c')).toMatchObject({ kind: 'changed', before: '-20', after: '-40' })
  })

  it('emits diffs in a stable hazard → nfpa → exposure → physical order', () => {
    const prev = basePayload({
      ghs_signal_word: 'warning',
      ghs_pictograms: ['GHS02'],
      hazard_statements: [{ code: 'H225', text: 'x' }],
      precautionary_statements: [{ code: 'P210', text: 'x' }],
      nfpa_health: 1,
      pel_twa_ppm: 1000,
      flash_point_c: -20,
    })
    const next = basePayload({
      ghs_signal_word: 'danger',
      ghs_pictograms: ['GHS02', 'GHS09'],
      hazard_statements: [{ code: 'H319', text: 'y' }],
      precautionary_statements: [{ code: 'P273', text: 'y' }],
      nfpa_health: 2,
      pel_twa_ppm: 500,
      flash_point_c: -25,
    })
    const fields = diffSdsPayloads(prev, next).map(d => d.field)
    // First occurrence index of each group is monotonically increasing.
    const firstIdx = (f: string) => fields.indexOf(f)
    expect(firstIdx('ghs_signal_word')).toBeLessThan(firstIdx('ghs_pictograms'))
    expect(firstIdx('ghs_pictograms')).toBeLessThan(firstIdx('hazard_statements'))
    expect(firstIdx('hazard_statements')).toBeLessThan(firstIdx('precautionary_statements'))
    expect(firstIdx('precautionary_statements')).toBeLessThan(firstIdx('nfpa_health'))
    expect(firstIdx('nfpa_health')).toBeLessThan(firstIdx('pel_twa_ppm'))
    expect(firstIdx('pel_twa_ppm')).toBeLessThan(firstIdx('flash_point_c'))
  })

  it('is order-insensitive within coded lists', () => {
    const prev = basePayload({ ghs_pictograms: ['GHS07', 'GHS02'] })
    const next = basePayload({ ghs_pictograms: ['GHS02', 'GHS07'] })
    expect(diffSdsPayloads(prev, next).filter(d => d.field === 'ghs_pictograms')).toEqual([])
  })
})

describe('summarizeDiff', () => {
  it('returns an empty string for no diffs', () => {
    expect(summarizeDiff([])).toBe('')
  })

  it('names a single pictogram addition', () => {
    const diffs = diffSdsPayloads(
      basePayload({ ghs_pictograms: ['GHS02'] }),
      basePayload({ ghs_pictograms: ['GHS02', 'GHS09'] }),
    )
    expect(summarizeDiff(diffs)).toBe('GHS09 added')
  })

  it('renders a PEL change as "PEL 100→50 ppm"', () => {
    const diffs = diffSdsPayloads(
      basePayload({ ghs_pictograms: ['GHS02'], pel_twa_ppm: 100 }),
      basePayload({ ghs_pictograms: ['GHS02'], pel_twa_ppm: 50 }),
    )
    expect(summarizeDiff(diffs)).toBe('PEL 100→50 ppm')
  })

  it('counts multiple H-code additions as "+2 H-codes"', () => {
    const diffs = diffSdsPayloads(
      basePayload({ hazard_statements: [{ code: 'H225', text: 'x' }] }),
      basePayload({
        hazard_statements: [
          { code: 'H225', text: 'x' },
          { code: 'H319', text: 'y' },
          { code: 'H336', text: 'z' },
        ],
      }),
    )
    expect(summarizeDiff(diffs)).toBe('+2 H-codes')
  })

  it('combines a pictogram add and a PEL change into one line', () => {
    const diffs = diffSdsPayloads(
      basePayload({ ghs_pictograms: ['GHS02'], pel_twa_ppm: 100 }),
      basePayload({ ghs_pictograms: ['GHS02', 'GHS09'], pel_twa_ppm: 50 }),
    )
    expect(summarizeDiff(diffs)).toBe('GHS09 added; PEL 100→50 ppm')
  })

  it('summarizes a signal-word change', () => {
    const diffs = diffSdsPayloads(
      basePayload({ ghs_pictograms: ['GHS02'], ghs_signal_word: 'warning' }),
      basePayload({ ghs_pictograms: ['GHS02'], ghs_signal_word: 'danger' }),
    )
    expect(summarizeDiff(diffs)).toBe('signal word warning→danger')
  })
})
