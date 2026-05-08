import { describe, it, expect } from 'vitest'
import {
  isValidCas,
  validateProductInput,
  chemicalSdsStoragePath,
  parseToProductFields,
  canAutoApplyParse,
  validateInventoryInput,
  validateExposureInput,
  tierTwoToCsv,
  daysUntil,
  expiryTier,
  matchRestrictions,
  isHardBanned,
  isBlockedByRestrictions,
  findIncompatibilities,
  checkLocationCompatibility,
  isLegalStatusTransition,
  INVENTORY_STATUSES,
  GHS_PICTOGRAMS,
  type ParsedSdsPayload,
  type TierTwoRow,
  type RestrictionRule,
  type OverrideRule,
  type InventoryStatus,
} from '@soteria/core/chemicals'

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
    firefighting: { suitable_extinguishers: ['CO2', 'dry chemical'], unsuitable_extinguishers: [], special_hazards: null, protective_equipment: null },
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

describe('parseToProductFields', () => {
  it('maps a high-confidence parse onto product columns', () => {
    const fields = parseToProductFields(basePayload())
    expect(fields.name).toBe('Acetone')
    expect(fields.manufacturer).toBe('Acme')
    expect(fields.cas_numbers).toEqual(['67-64-1'])
    expect(fields.ghs_pictograms).toEqual(['GHS02', 'GHS07'])
    expect(fields.ghs_signal_word).toBe('danger')
    expect(fields.nfpa_health).toBe(1)
    expect(fields.flash_point_c).toBe(-20)
    expect(fields.dot_un_number).toBe('UN1090')
    expect(fields.first_aid?.inhalation).toBe('Move to fresh air')
  })

  it('drops invalid CAS numbers from the parse', () => {
    const fields = parseToProductFields(basePayload({
      cas_numbers: ['67-64-1', 'bogus', '7732-18-5'],
    }))
    expect(fields.cas_numbers).toEqual(['67-64-1', '7732-18-5'])
  })

  it('omits empty arrays so existing values are preserved', () => {
    const fields = parseToProductFields(basePayload({
      synonyms:          [],
      ghs_pictograms:    [],
      hazard_statements: [],
      ppe_required:      [],
      incompatibilities: [],
    }))
    expect(fields).not.toHaveProperty('synonyms')
    expect(fields).not.toHaveProperty('ghs_pictograms')
    expect(fields).not.toHaveProperty('hazard_statements')
    expect(fields).not.toHaveProperty('ppe_required')
    expect(fields).not.toHaveProperty('incompatibilities')
  })

  it('omits null scalars', () => {
    const fields = parseToProductFields(basePayload({
      flash_point_c: null,
      manufacturer:  null,
      pel_twa_ppm:   null,
    }))
    expect(fields).not.toHaveProperty('flash_point_c')
    expect(fields).not.toHaveProperty('manufacturer')
    expect(fields).not.toHaveProperty('pel_twa_ppm')
  })

  it('omits an empty first_aid block but keeps a partial one', () => {
    const empty = parseToProductFields(basePayload({
      first_aid: { inhalation: null, skin: null, eyes: null, ingestion: null, notes: null },
    }))
    expect(empty).not.toHaveProperty('first_aid')

    const partial = parseToProductFields(basePayload({
      first_aid: { inhalation: 'Fresh air', skin: null, eyes: null, ingestion: null, notes: null },
    }))
    expect(partial.first_aid).toBeTruthy()
  })
})

describe('canAutoApplyParse', () => {
  it('returns true only when the regulatory-critical sections are all high confidence', () => {
    const payload = basePayload()
    expect(canAutoApplyParse(payload)).toBe(true)
  })

  it('blocks auto-apply when overall confidence is medium', () => {
    expect(canAutoApplyParse(basePayload({
      confidence: { ...basePayload().confidence, overall: 'medium' },
    }))).toBe(false)
  })

  it('blocks auto-apply when hazards or exposure drop below high', () => {
    expect(canAutoApplyParse(basePayload({
      confidence: { ...basePayload().confidence, hazards: 'medium' },
    }))).toBe(false)
    expect(canAutoApplyParse(basePayload({
      confidence: { ...basePayload().confidence, exposure: 'low' },
    }))).toBe(false)
  })

  it('does not require firefighting or spill_cleanup to be high', () => {
    expect(canAutoApplyParse(basePayload({
      confidence: {
        ...basePayload().confidence,
        firefighting:  'low',
        spill_cleanup: 'low',
      },
    }))).toBe(true)
  })
})

describe('validateInventoryInput', () => {
  it('requires product_id, finite quantity, and a known unit', () => {
    const errs = validateInventoryInput({
      product_id: '',
      quantity:   -5,
      unit:       'oz',
    } as never)
    expect(errs.find(e => e.field === 'product_id')).toBeTruthy()
    expect(errs.find(e => e.field === 'quantity')).toBeTruthy()
  })

  it('flags unknown enum values', () => {
    const errs = validateInventoryInput({
      product_id: '00000000-0000-0000-0000-000000000001',
      quantity:   1,
      unit:       'parsec' as never,
      container_type: 'space-pod' as never,
      status:     'lost' as never,
    })
    expect(errs.map(e => e.field)).toEqual(
      expect.arrayContaining(['unit', 'container_type', 'status']),
    )
  })

  it('flags malformed dates and negative cents', () => {
    const errs = validateInventoryInput({
      product_id: '00000000-0000-0000-0000-000000000001',
      quantity:   1,
      unit:       'gal',
      received_date: 'last tuesday' as never,
      cost_cents:    -100,
    })
    expect(errs.map(e => e.field)).toEqual(
      expect.arrayContaining(['received_date', 'cost_cents']),
    )
  })

  it('accepts a fully-valid input', () => {
    expect(validateInventoryInput({
      product_id: '00000000-0000-0000-0000-000000000001',
      quantity:   55,
      unit:       'gal',
      container_type: 'drum',
      received_date:   '2026-04-01',
      expiration_date: '2027-04-01',
      status:          'in_stock',
      cost_cents:      19900,
    })).toEqual([])
  })
})

describe('daysUntil', () => {
  const today = new Date('2026-05-08T00:00:00Z')

  it('returns positive days for future dates', () => {
    expect(daysUntil('2026-05-09', today)).toBe(1)
    expect(daysUntil('2026-06-07', today)).toBe(30)
  })

  it('returns 0 for today', () => {
    expect(daysUntil('2026-05-08', today)).toBe(0)
  })

  it('returns negative days for past dates', () => {
    expect(daysUntil('2026-05-07', today)).toBe(-1)
    expect(daysUntil('2026-04-08', today)).toBe(-30)
  })

  it('returns null for missing or malformed dates', () => {
    expect(daysUntil(null,         today)).toBeNull()
    expect(daysUntil(undefined,    today)).toBeNull()
    expect(daysUntil('not a date', today)).toBeNull()
    expect(daysUntil('',           today)).toBeNull()
  })
})

describe('expiryTier', () => {
  const today = new Date('2026-05-08T00:00:00Z')

  it.each([
    ['2026-05-07', 'expired'],
    ['2026-05-08', 'critical'],
    ['2026-05-15', 'critical'],
    ['2026-05-16', 'warning'],
    ['2026-06-07', 'warning'],
    ['2026-06-08', 'ok'],
    [null,         'unknown'],
  ] as const)('buckets %s as %s', (date, expected) => {
    expect(expiryTier(date, today)).toBe(expected)
  })
})

describe('validateExposureInput', () => {
  const baseInput = {
    incident_id: '00000000-0000-0000-0000-000000000001',
    product_id:  '00000000-0000-0000-0000-000000000002',
    route:       'inhalation' as const,
  }

  it('requires incident_id, product_id, and a known route', () => {
    const errs = validateExposureInput({
      ...baseInput,
      incident_id: '',
      product_id:  '',
      route:       'oral' as never,
    })
    expect(errs.map(e => e.field)).toEqual(
      expect.arrayContaining(['incident_id', 'product_id', 'route']),
    )
  })

  it('flags unknown severity', () => {
    const errs = validateExposureInput({ ...baseInput, severity: 'severe' as never })
    expect(errs.find(e => e.field === 'severity')).toBeTruthy()
  })

  it('flags negative duration / ppm', () => {
    const errs = validateExposureInput({
      ...baseInput,
      exposure_duration_minutes: -5,
      measured_ppm:              -1,
    })
    expect(errs.map(e => e.field)).toEqual(
      expect.arrayContaining(['exposure_duration_minutes', 'measured_ppm']),
    )
  })

  it('accepts a fully-valid input', () => {
    expect(validateExposureInput({
      ...baseInput,
      route:    'inhalation',
      severity: 'first_aid',
      exposure_duration_minutes: 15,
      measured_ppm:              95,
      ppe_in_use:                ['Half-face respirator'],
    })).toEqual([])
  })
})

describe('tierTwoToCsv', () => {
  const r1: TierTwoRow = {
    product_id:        '00000000-0000-0000-0000-000000000001',
    product_name:      'Acetone',
    manufacturer:      'Acme',
    cas_numbers:       ['67-64-1'],
    storage_class:     'Flammable cabinet',
    physical_state:    'liquid',
    ghs_signal_word:   'danger',
    ghs_pictograms:    ['GHS02', 'GHS07'],
    location_id:       '00000000-0000-0000-0000-000000000010',
    location_name:     'Cabinet 3',
    location_path:     'Building A / Wash Bay 2 / Cabinet 3',
    unit:              'gal',
    total_quantity:         55,
    max_daily_quantity:     55,
    average_daily_quantity: 55,
    container_count:        2,
    earliest_expiration:    '2026-12-31',
  }

  it('starts with a UTF-8 BOM and includes the header row', () => {
    const csv = tierTwoToCsv([r1])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv).toContain('product_name,manufacturer,cas_numbers')
  })

  it('escapes commas and quotes per RFC 4180', () => {
    const csv = tierTwoToCsv([{
      ...r1,
      product_name:  'Solvent, Industrial',
      manufacturer:  'Acme "Best" Co.',
    }])
    expect(csv).toContain('"Solvent, Industrial"')
    expect(csv).toContain('"Acme ""Best"" Co."')
  })

  it('joins array fields with semicolons', () => {
    const csv = tierTwoToCsv([{
      ...r1,
      cas_numbers:    ['67-64-1', '7732-18-5'],
      ghs_pictograms: ['GHS02', 'GHS07'],
    }])
    expect(csv).toContain('67-64-1; 7732-18-5')
    expect(csv).toContain('GHS02; GHS07')
  })

  it('renders nulls as empty cells', () => {
    const csv = tierTwoToCsv([{
      ...r1,
      manufacturer:        null,
      storage_class:       null,
      earliest_expiration: null,
    }])
    // ,, sequences are empty cells.
    expect(csv).toContain(',,')
  })

  it('emits CRLF line endings', () => {
    const csv = tierTwoToCsv([r1])
    expect(csv).toContain('\r\n')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('returns header-only CSV when given no rows', () => {
    const csv = tierTwoToCsv([])
    const lines = csv.split('\r\n').filter(l => l.length > 0)
    expect(lines.length).toBe(1)
  })
})

describe('matchRestrictions', () => {
  const rules: RestrictionRule[] = [
    {
      id: '1', cas_number: '71-43-2', name_pattern: null,
      severity: 'banned', reason: 'Carcinogen', alternative: null, reference: null,
    },
    {
      id: '2', cas_number: null, name_pattern: '%benzene%',
      severity: 'restricted', reason: 'Restricted use', alternative: null, reference: null,
    },
    {
      id: '3', cas_number: null, name_pattern: 'methanol',
      severity: 'discouraged', reason: 'Use water-based alternative', alternative: 'water', reference: null,
    },
  ]

  it('matches by exact CAS', () => {
    const hit = matchRestrictions({ name: 'Benzene', cas_numbers: ['71-43-2'] }, rules)
    expect(hit).toHaveLength(2)              // CAS rule + name pattern rule both fire
    expect(hit.find(r => r.id === '1')).toBeTruthy()
  })

  it('matches by ilike-style name pattern with % wildcards', () => {
    const hit = matchRestrictions(
      { name: 'Industrial Benzene Solvent', cas_numbers: [] },
      rules,
    )
    expect(hit).toHaveLength(1)
    expect(hit[0].id).toBe('2')
  })

  it('exact-name pattern (no %) matches the whole name only', () => {
    expect(matchRestrictions({ name: 'methanol',         cas_numbers: [] }, rules)).toHaveLength(1)
    expect(matchRestrictions({ name: 'methanol blend',   cas_numbers: [] }, rules)).toHaveLength(0)
  })

  it('returns empty when nothing matches', () => {
    expect(matchRestrictions(
      { name: 'Water', cas_numbers: ['7732-18-5'] },
      rules,
    )).toEqual([])
  })

  it('classifies hits via isHardBanned + isBlockedByRestrictions', () => {
    const banHit = matchRestrictions({ name: 'Benzene', cas_numbers: ['71-43-2'] }, rules)
    expect(isHardBanned(banHit)).toBe(true)
    expect(isBlockedByRestrictions(banHit)).toBe(true)

    const discHit = matchRestrictions({ name: 'methanol', cas_numbers: [] }, rules)
    expect(isHardBanned(discHit)).toBe(false)
    expect(isBlockedByRestrictions(discHit)).toBe(false)

    const restHit = matchRestrictions({ name: 'Industrial Benzene Solvent', cas_numbers: [] }, rules)
    expect(isHardBanned(restHit)).toBe(false)
    expect(isBlockedByRestrictions(restHit)).toBe(true)
  })
})

describe('findIncompatibilities', () => {
  const flammable    = { ghs_pictograms: ['GHS02'], storage_class: 'flammable_cabinet' }
  const oxidizer     = { ghs_pictograms: ['GHS03'], storage_class: 'oxidizer_cabinet' }
  const acid         = { ghs_pictograms: ['GHS05'], storage_class: 'corrosive_acid' }
  const base         = { ghs_pictograms: ['GHS05'], storage_class: 'corrosive_base' }
  const inert        = { ghs_pictograms: [],         storage_class: null }

  it('flags GHS02 + GHS03 (flammable + oxidizer)', () => {
    const f = findIncompatibilities(flammable, oxidizer)
    expect(f.some(x => x.kind === 'pictogram' && x.a === 'GHS02' && x.b === 'GHS03')).toBe(true)
    // The flammable_cabinet + oxidizer_cabinet pair also triggers — both block postures.
    expect(f.every(x => x.posture === 'block')).toBe(true)
  })

  it('flags acid + base storage classes', () => {
    const f = findIncompatibilities(acid, base)
    expect(f.some(x => x.kind === 'storage_class' && x.a === 'acid' && x.b === 'base')).toBe(true)
  })

  it('returns empty between two inert products', () => {
    expect(findIncompatibilities(inert, inert)).toEqual([])
  })

  it('honors a tenant override that ALLOWS a default-blocked pair', () => {
    const overrides: OverrideRule[] = [{
      key_a: 'GHS02', key_b: 'GHS03', key_kind: 'pictogram',
      compatible: true, reason: 'Building B annex isolation',
    }]
    const f = findIncompatibilities(flammable, oxidizer, overrides)
    const picto = f.find(x => x.kind === 'pictogram' && x.a === 'GHS02')
    expect(picto?.posture).toBe('allow')
    expect(picto?.override).toBe(true)
  })

  it('honors a tenant override that BLOCKS a non-default pair', () => {
    const overrides: OverrideRule[] = [{
      key_a: 'GHS04', key_b: 'GHS08', key_kind: 'pictogram',
      compatible: false, reason: 'Site-specific rule',
    }]
    const f = findIncompatibilities(
      { ghs_pictograms: ['GHS04'] },
      { ghs_pictograms: ['GHS08'] },
      overrides,
    )
    expect(f).toHaveLength(1)
    expect(f[0].posture).toBe('block')
    expect(f[0].override).toBe(true)
  })
})

describe('checkLocationCompatibility', () => {
  const flammable = { ghs_pictograms: ['GHS02'] }
  const oxidizer  = { id: 'O1', name: 'Sodium chlorate', ghs_pictograms: ['GHS03'] }
  const inert     = { id: 'I1', name: 'Distilled water', ghs_pictograms: [] }

  it('returns one entry per conflicting co-located product', () => {
    const conflicts = checkLocationCompatibility(flammable, [oxidizer, inert])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].product_id).toBe('O1')
    expect(conflicts[0].findings.length).toBeGreaterThan(0)
  })

  it('omits products that come back with only allow-posture findings', () => {
    const overrides: OverrideRule[] = [{
      key_a: 'GHS02', key_b: 'GHS03', key_kind: 'pictogram',
      compatible: true, reason: 'isolated',
    }]
    expect(checkLocationCompatibility(flammable, [oxidizer], overrides)).toEqual([])
  })

  it('returns empty when nothing else is in the location', () => {
    expect(checkLocationCompatibility(flammable, [])).toEqual([])
  })
})

describe('isLegalStatusTransition', () => {
  it('approves the requested → in_stock transition', () => {
    expect(isLegalStatusTransition('requested', 'in_stock')).toBe(true)
  })

  it('rejects the requested → in_use shortcut (must approve first)', () => {
    expect(isLegalStatusTransition('requested', 'in_use')).toBe(false)
    expect(isLegalStatusTransition('requested', 'empty')).toBe(false)
    expect(isLegalStatusTransition('requested', 'quarantined')).toBe(false)
  })

  it('allows reject from requested', () => {
    expect(isLegalStatusTransition('requested', 'rejected')).toBe(true)
  })

  it('rejects retroactive reject after approval', () => {
    expect(isLegalStatusTransition('in_stock',    'rejected')).toBe(false)
    expect(isLegalStatusTransition('in_use',      'rejected')).toBe(false)
    expect(isLegalStatusTransition('quarantined', 'rejected')).toBe(false)
  })

  it('treats rejected and disposed as terminal states', () => {
    for (const t of INVENTORY_STATUSES) {
      if (t === 'rejected') continue
      expect(isLegalStatusTransition('rejected', t as InventoryStatus)).toBe(false)
    }
    for (const t of INVENTORY_STATUSES) {
      if (t === 'disposed') continue
      expect(isLegalStatusTransition('disposed', t as InventoryStatus)).toBe(false)
    }
  })

  it('is reflexive — same status to same status is always legal', () => {
    for (const s of INVENTORY_STATUSES) {
      expect(isLegalStatusTransition(s, s)).toBe(true)
    }
  })

  it('permits live-state transitions once approved', () => {
    expect(isLegalStatusTransition('in_stock',    'in_use')).toBe(true)
    expect(isLegalStatusTransition('in_use',      'empty')).toBe(true)
    expect(isLegalStatusTransition('in_use',      'disposed')).toBe(true)
    expect(isLegalStatusTransition('quarantined', 'in_stock')).toBe(true)
  })
})

describe('GHS_PICTOGRAMS', () => {
  it('covers GHS01..GHS09 exactly', () => {
    expect([...GHS_PICTOGRAMS]).toEqual([
      'GHS01','GHS02','GHS03','GHS04','GHS05','GHS06','GHS07','GHS08','GHS09',
    ])
  })
})
