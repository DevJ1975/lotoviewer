import { describe, it, expect } from 'vitest'
import { buildLotoUrl, findNextNeedsPhoto, LOTO_PATH } from '@/lib/lotoNavigation'
import type { Equipment } from '@/lib/types'

// Test fixture builder. Spread-after-defaults so explicit nulls survive
// (the same gotcha bit the photoStatus / homeMetrics tests).
function eq(partial: Partial<Equipment>): Equipment {
  return {
    equipment_id:       'EQ-001',
    description:        'Demo equipment',
    department:         'Packaging',
    prefix:             null,
    photo_status:       'missing',
    has_equip_photo:    false,
    has_iso_photo:      false,
    equip_photo_url:    null,
    iso_photo_url:      null,
    placard_url:        null,
    signed_placard_url: null,
    notes:              null,
    notes_es:           null,
    internal_notes:     null,
    spanish_reviewed:   false,
    verified:           false,
    verified_date:      null,
    verified_by:        null,
    needs_equip_photo:  true,
    needs_iso_photo:    true,
    needs_verification: false,
    decommissioned:     false,
    annotations:        [],
    created_at:         '2026-04-01T00:00:00Z',
    updated_at:         '2026-04-01T00:00:00Z',
    ...partial,
  }
}

// ── buildLotoUrl ───────────────────────────────────────────────────────────

describe('buildLotoUrl', () => {
  it('returns just /loto when there are no params and no update', () => {
    expect(buildLotoUrl(new URLSearchParams(), {})).toBe(LOTO_PATH)
  })

  it('preserves an existing param when the update omits it (undefined != null)', () => {
    const cur = new URLSearchParams('dept=Packaging')
    expect(buildLotoUrl(cur, { eq: 'EQ-001' })).toBe('/loto?dept=Packaging&eq=EQ-001')
  })

  it('null clears the param', () => {
    const cur = new URLSearchParams('dept=Packaging&eq=EQ-001')
    expect(buildLotoUrl(cur, { dept: null })).toBe('/loto?eq=EQ-001')
  })

  it('clearing the last param drops the query string entirely', () => {
    const cur = new URLSearchParams('dept=Packaging')
    expect(buildLotoUrl(cur, { dept: null })).toBe(LOTO_PATH)
  })

  it('empty string is treated like null — caller can pass raw input value without normalizing', () => {
    const cur = new URLSearchParams('dept=Packaging')
    expect(buildLotoUrl(cur, { dept: '' })).toBe(LOTO_PATH)
  })

  it('setting a fresh param appends it', () => {
    expect(buildLotoUrl(new URLSearchParams(), { dept: 'Labeling' }))
      .toBe('/loto?dept=Labeling')
  })

  it('updating an existing param overwrites it (set, not append)', () => {
    const cur = new URLSearchParams('dept=Packaging')
    expect(buildLotoUrl(cur, { dept: 'Labeling' })).toBe('/loto?dept=Labeling')
  })

  it('handles dept and eq independently in one call', () => {
    const cur = new URLSearchParams('dept=Packaging&eq=EQ-001')
    expect(buildLotoUrl(cur, { dept: null, eq: 'EQ-002' }))
      .toBe('/loto?eq=EQ-002')
  })

  it('encodes special characters in dept names', () => {
    expect(buildLotoUrl(new URLSearchParams(), { dept: 'Slice & Dice' }))
      .toBe('/loto?dept=Slice+%26+Dice')
  })

  it('does not mutate the input URLSearchParams (caller can reuse)', () => {
    const cur = new URLSearchParams('dept=Packaging')
    buildLotoUrl(cur, { eq: 'EQ-001' })
    expect(cur.toString()).toBe('dept=Packaging')
  })

  it('preserves unrelated params the LOTO page might have added', () => {
    // Forward-compatibility: if a future feature stashes ?view=grid in
    // the URL, our merge mustn't strip it on the next selection.
    const cur = new URLSearchParams('view=grid&dept=Packaging')
    const out = buildLotoUrl(cur, { eq: 'EQ-001' })
    // URLSearchParams iteration order matches insertion, so view stays first.
    expect(out).toBe('/loto?view=grid&dept=Packaging&eq=EQ-001')
  })
})

// ── findNextNeedsPhoto ─────────────────────────────────────────────────────

describe('findNextNeedsPhoto', () => {
  it('returns null on an empty equipment list', () => {
    expect(findNextNeedsPhoto([], 'anything', null, new Set())).toBeNull()
  })

  it('returns null when only one item is in scope (no other to advance to)', () => {
    const list = [eq({ equipment_id: 'EQ-001' })]
    expect(findNextNeedsPhoto(list, 'EQ-001', null, new Set())).toBeNull()
  })

  it('advances to the next item by id ASC', () => {
    const list = [
      eq({ equipment_id: 'EQ-001' }),
      eq({ equipment_id: 'EQ-002' }),
      eq({ equipment_id: 'EQ-003' }),
    ]
    expect(findNextNeedsPhoto(list, 'EQ-001', null, new Set())?.equipment_id).toBe('EQ-002')
  })

  it('wraps from the last item back to the first', () => {
    const list = [
      eq({ equipment_id: 'EQ-001' }),
      eq({ equipment_id: 'EQ-002' }),
      eq({ equipment_id: 'EQ-003' }),
    ]
    expect(findNextNeedsPhoto(list, 'EQ-003', null, new Set())?.equipment_id).toBe('EQ-001')
  })

  it('skips equipment that has already been completed', () => {
    const list = [
      eq({ equipment_id: 'EQ-001' }),  // current
      // Already complete — both photo URLs present, no needs flags.
      eq({
        equipment_id: 'EQ-002',
        equip_photo_url: 'https://x/a.jpg',
        iso_photo_url:   'https://x/b.jpg',
        needs_equip_photo: false,
        needs_iso_photo:   false,
        photo_status: 'complete',
      }),
      eq({ equipment_id: 'EQ-003' }),
    ]
    expect(findNextNeedsPhoto(list, 'EQ-001', null, new Set())?.equipment_id).toBe('EQ-003')
  })

  it('skips decommissioned rows even if they technically "need" a photo', () => {
    const list = [
      eq({ equipment_id: 'EQ-001' }),
      eq({ equipment_id: 'EQ-002' }),
      eq({ equipment_id: 'EQ-003' }),
    ]
    expect(findNextNeedsPhoto(list, 'EQ-001', null, new Set(['EQ-002']))?.equipment_id).toBe('EQ-003')
  })

  it('limits scope to the active dept', () => {
    const list = [
      eq({ equipment_id: 'EQ-A1', department: 'Packaging' }),
      eq({ equipment_id: 'EQ-B1', department: 'Labeling'  }),
      eq({ equipment_id: 'EQ-A2', department: 'Packaging' }),
    ]
    // Even though EQ-B1 is alphabetically between A1 and A2, we stay
    // inside the Packaging dept.
    expect(findNextNeedsPhoto(list, 'EQ-A1', 'Packaging', new Set())?.equipment_id).toBe('EQ-A2')
  })

  it('returns null when every other item in scope is already complete', () => {
    const completed = (id: string) => eq({
      equipment_id:      id,
      equip_photo_url:   'https://x.jpg',
      iso_photo_url:     'https://y.jpg',
      needs_equip_photo: false,
      needs_iso_photo:   false,
      photo_status:      'complete',
    })
    const list = [
      eq({ equipment_id: 'EQ-001' }),  // current
      completed('EQ-002'),
      completed('EQ-003'),
    ]
    expect(findNextNeedsPhoto(list, 'EQ-001', null, new Set())).toBeNull()
  })

  it('searches from the start when the current id is not in scope (dept changed mid-flight)', () => {
    // User finished saving for EQ-X1 in Labeling, then switched dept to
    // Packaging before the advance fired. We should not freeze — we
    // search Packaging from the start.
    const list = [
      eq({ equipment_id: 'EQ-X1', department: 'Labeling'  }),
      eq({ equipment_id: 'EQ-A1', department: 'Packaging' }),
      eq({ equipment_id: 'EQ-A2', department: 'Packaging' }),
    ]
    const out = findNextNeedsPhoto(list, 'EQ-X1', 'Packaging', new Set())
    expect(out?.equipment_id).toBe('EQ-A1')
  })

  it('global mode (dept=null) advances across departments', () => {
    const list = [
      eq({ equipment_id: 'EQ-A1', department: 'Packaging' }),
      eq({ equipment_id: 'EQ-B1', department: 'Labeling'  }),
    ]
    expect(findNextNeedsPhoto(list, 'EQ-A1', null, new Set())?.equipment_id).toBe('EQ-B1')
  })

  it('returns the row object, not just the id — caller can read department / etc.', () => {
    const target = eq({ equipment_id: 'EQ-002', department: 'Sanitation' })
    const list = [eq({ equipment_id: 'EQ-001' }), target]
    const out = findNextNeedsPhoto(list, 'EQ-001', null, new Set())
    expect(out).toBeTruthy()
    expect(out?.department).toBe('Sanitation')
  })

  it('does not mutate the input array (sort uses a copy)', () => {
    const list = [
      eq({ equipment_id: 'EQ-002' }),
      eq({ equipment_id: 'EQ-001' }),
    ]
    const before = list.map(e => e.equipment_id)
    findNextNeedsPhoto(list, 'EQ-001', null, new Set())
    expect(list.map(e => e.equipment_id)).toEqual(before)
  })

  it('returns null when scope is empty even if the global list has rows', () => {
    // dept filter excludes everything — no candidates.
    const list = [eq({ equipment_id: 'EQ-A1', department: 'Packaging' })]
    expect(findNextNeedsPhoto(list, 'EQ-A1', 'NoSuchDept', new Set())).toBeNull()
  })
})
