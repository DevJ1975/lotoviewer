import { describe, it, expect } from 'vitest'
import { parseOutfallRow, toOutfallRow, validateOutfall, type OutfallInput } from '../../environmental/outfalls'

const FACILITY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PHOTO_PREFIX = '11111111-1111-1111-1111-111111111111/'

// A create needs a site; the tests that are not about the site get one here.
const withSite = (body: object) => ({ facility_id: FACILITY_ID, ...body })

const ok = (body: object) => {
  const r = validateOutfall(withSite(body))
  if (!r.ok) throw new Error(r.errors.join(' | '))
  return r.outfall
}
const errors = (body: object) => { const r = validateOutfall(withSite(body)); return r.ok ? [] : r.errors }

describe('validateOutfall', () => {
  it('accepts a minimal outfall with safe defaults', () => {
    expect(ok({ code: 'OF-001' })).toEqual({
      facilityId: FACILITY_ID, code: 'OF-001', name: null, receivingWater: null, drainageArea: null, latitude: null, longitude: null,
      outfallType: 'stormwater', status: 'active', isSamplingPoint: false, substantiallyIdenticalTo: null, permitId: null,
      photoPath: null, notes: null,
    })
  })

  it('accepts a fully described outfall', () => {
    const o = ok({
      code: 'OF-002', name: 'North dock', receiving_water: 'Santa Ana River', drainage_area: 'Loading docks and yard',
      latitude: 34.1, longitude: -117.4, outfall_type: 'authorized_nsw', status: 'inactive', is_sampling_point: true,
      substantially_identical_to: 'AAAAAAAA-0000-0000-0000-000000000001', permit_id: 'bbbbbbbb-0000-0000-0000-000000000002', notes: 'n',
    })
    expect(o).toMatchObject({ outfallType: 'authorized_nsw', status: 'inactive', isSamplingPoint: true, latitude: 34.1, longitude: -117.4 })
    expect(o.substantiallyIdenticalTo).toBe('aaaaaaaa-0000-0000-0000-000000000001')
  })

  it('requires a sensible code', () => {
    for (const bad of [{}, { code: '' }, { code: '   ' }, { code: 'has space' }, { code: 'x'.repeat(31) }, { code: '-lead' }, { code: 7 }]) {
      expect(errors(bad)[0], JSON.stringify(bad)).toMatch(/code is required/)
    }
    expect(ok({ code: '  OF-1.a_b  ' }).code).toBe('OF-1.a_b')
  })

  it('rejects what it does not understand instead of dropping it', () => {
    expect(errors({ code: 'A', outfall_type: 'pipe' })[0]).toMatch(/outfall_type must be one of/)
    expect(errors({ code: 'A', status: 'gone' })[0]).toMatch(/status must be one of/)
    expect(errors({ code: 'A', is_sampling_point: 'yes' })[0]).toMatch(/true or false/)
    expect(errors({ code: 'A', name: 5 })[0]).toMatch(/name must be text/)
    expect(errors({ code: 'A', name: 'x'.repeat(201) })[0]).toMatch(/too long/)
    expect(errors({ code: 'A', substantially_identical_to: 'nope' })[0]).toMatch(/must be an id/)
    expect(validateOutfall('x')).toEqual({ ok: false, errors: ['Expected an object.'] })
  })

  it('checks coordinates are in range and travel together', () => {
    expect(errors({ code: 'A', latitude: 91, longitude: 0 })[0]).toMatch(/latitude must be a number between -90 and 90/)
    expect(errors({ code: 'A', latitude: 0, longitude: -181 })[0]).toMatch(/longitude/)
    expect(errors({ code: 'A', latitude: '34.1', longitude: 0 })[0]).toMatch(/latitude/)
    expect(errors({ code: 'A', latitude: 34.1 })).toEqual(['latitude and longitude go together: give both or neither.'])
    expect(errors({ code: 'A', longitude: -117 })).toEqual(['latitude and longitude go together: give both or neither.'])
    expect(ok({ code: 'A', latitude: 0, longitude: 0 })).toMatchObject({ latitude: 0, longitude: 0 })
  })

  it('treats blank optional text as absent', () => {
    expect(ok({ code: 'A', name: '  ', notes: '' })).toMatchObject({ name: null, notes: null })
  })
})

describe('validateOutfall: the site', () => {
  it('requires one on create, because an outfall belongs to one site', () => {
    const r = validateOutfall({ code: 'A' })
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/facility_id is required/)] })
  })

  it('refuses a site that is not an id, with a single message', () => {
    for (const bad of ['nope', null, 7, '']) {
      const r = validateOutfall({ code: 'A', facility_id: bad })
      expect(r, JSON.stringify(bad)).toEqual({ ok: false, errors: ['facility_id must be an id.'] })
    }
  })

  it('normalises the id to lower case', () => {
    expect(ok({ code: 'A', facility_id: FACILITY_ID.toUpperCase() }).facilityId).toBe(FACILITY_ID)
  })
})

describe('validateOutfall: photo_path', () => {
  const photo = (photo_path: unknown, options: { photoPathPrefix?: string } = { photoPathPrefix: PHOTO_PREFIX }) =>
    validateOutfall(withSite({ code: 'A', photo_path }), options)

  it('accepts a file inside the caller\'s folder', () => {
    const r = photo(`${PHOTO_PREFIX}outfalls/of-1.jpg`)
    expect(r).toMatchObject({ ok: true, outfall: { photoPath: `${PHOTO_PREFIX}outfalls/of-1.jpg` } })
  })

  it('treats null or blank as no photo', () => {
    expect(photo(null)).toMatchObject({ ok: true, outfall: { photoPath: null } })
    expect(photo('')).toMatchObject({ ok: true, outfall: { photoPath: null } })
  })

  it('refuses a path outside the caller\'s folder, one that climbs out of it, or one that is not text', () => {
    const message = ['photo_path must be a file you uploaded to this account.']
    for (const bad of ['22222222-2222-2222-2222-222222222222/x.jpg', `${PHOTO_PREFIX}../22222222-2222-2222-2222-222222222222/x.jpg`, 42, {}]) {
      expect(photo(bad), JSON.stringify(bad)).toEqual({ ok: false, errors: message })
    }
  })

  it('refuses a path longer than the column allows', () => {
    expect(photo(`${PHOTO_PREFIX}${'x'.repeat(300)}`).ok).toBe(false)
  })

  it('refuses every path when it is not told which folder is the caller\'s, even an empty prefix', () => {
    expect(photo(`${PHOTO_PREFIX}x.jpg`, {}).ok).toBe(false)
    expect(photo(`${PHOTO_PREFIX}x.jpg`, { photoPathPrefix: '' }).ok).toBe(false)
  })
})

describe('validateOutfall: partial update with `current`', () => {
  const CURRENT: OutfallInput = {
    facilityId: FACILITY_ID, code: 'OF-001', name: 'North dock', receivingWater: 'Santa Ana River', drainageArea: 'Yard',
    latitude: 34.1, longitude: -117.4, outfallType: 'combined', status: 'inactive', isSamplingPoint: true,
    substantiallyIdenticalTo: 'cccccccc-0000-0000-0000-000000000003', permitId: 'bbbbbbbb-0000-0000-0000-000000000002',
    photoPath: `${PHOTO_PREFIX}of-1.jpg`, notes: 'n',
  }
  const update = (body: object) => validateOutfall(body, { current: CURRENT, photoPathPrefix: PHOTO_PREFIX })
  const updated = (body: object) => {
    const r = update(body)
    if (!r.ok) throw new Error(r.errors.join(' | '))
    return r.outfall
  }
  const updateErrors = (body: object) => { const r = update(body); return r.ok ? [] : r.errors }

  it('keeps every field when nothing is sent', () => {
    expect(updated({})).toEqual(CURRENT)
  })

  it('changes only the fields that were sent', () => {
    expect(updated({ name: 'South dock', status: 'active', is_sampling_point: false })).toEqual({
      ...CURRENT, name: 'South dock', status: 'active', isSamplingPoint: false,
    })
  })

  it('does not need the code, but still checks one that is sent', () => {
    expect(updated({ notes: 'x' }).code).toBe('OF-001')
    expect(updated({ code: ' OF-002 ' }).code).toBe('OF-002')
    for (const bad of ['', '   ', 'has space', null]) {
      expect(updateErrors({ code: bad })[0], JSON.stringify(bad)).toMatch(/code is required/)
    }
  })

  it('clears an optional field only when it is sent as null or blank', () => {
    expect(updated({ name: null, receiving_water: '', permit_id: null, substantially_identical_to: '', photo_path: null, notes: '  ' })).toMatchObject({
      name: null, receivingWater: null, permitId: null, substantiallyIdenticalTo: null, photoPath: null, notes: null,
      drainageArea: 'Yard', code: 'OF-001',
    })
  })

  it('validates what is sent exactly as on create', () => {
    expect(updateErrors({ status: 'gone' })[0]).toMatch(/status must be one of/)
    expect(updateErrors({ outfall_type: 'pipe' })[0]).toMatch(/outfall_type must be one of/)
    expect(updateErrors({ permit_id: 'nope' })[0]).toMatch(/permit_id must be an id/)
    expect(updateErrors({ is_sampling_point: 'yes' })[0]).toMatch(/true or false/)
    expect(updateErrors({ photo_path: '22222222-2222-2222-2222-222222222222/x.jpg' })[0]).toMatch(/photo_path/)
    expect(updateErrors({ facility_id: 'nope' })).toEqual(['facility_id must be an id.'])
  })

  it('accepts a new photo inside the caller\'s folder and refuses one outside it', () => {
    expect(updated({ photo_path: `${PHOTO_PREFIX}of-2.jpg` }).photoPath).toBe(`${PHOTO_PREFIX}of-2.jpg`)
    expect(updateErrors({ photo_path: 'elsewhere/x.jpg' })).toHaveLength(1)
  })

  it('moves one coordinate on its own, because the other is still there', () => {
    expect(updated({ latitude: 35 })).toMatchObject({ latitude: 35, longitude: -117.4 })
  })

  it('refuses to clear one coordinate and not the other, but clears both together', () => {
    const together = ['latitude and longitude go together: give both or neither.']
    expect(updateErrors({ latitude: null })).toEqual(together)
    expect(updateErrors({ longitude: '' })).toEqual(together)
    expect(updated({ latitude: null, longitude: null })).toMatchObject({ latitude: null, longitude: null })
  })

  it('still needs both coordinates when the stored outfall has none', () => {
    const noCoordinates = { ...CURRENT, latitude: null, longitude: null }
    const r = validateOutfall({ latitude: 35 }, { current: noCoordinates })
    expect(r).toEqual({ ok: false, errors: ['latitude and longitude go together: give both or neither.'] })
  })
})

describe('outfall rows', () => {
  const OUTFALL: OutfallInput = {
    facilityId: FACILITY_ID, code: 'OF-001', name: 'North dock', receivingWater: 'Santa Ana River', drainageArea: 'Yard',
    latitude: 34.1, longitude: -117.4, outfallType: 'authorized_nsw', status: 'inactive', isSamplingPoint: true,
    substantiallyIdenticalTo: 'cccccccc-0000-0000-0000-000000000003', permitId: 'bbbbbbbb-0000-0000-0000-000000000002',
    photoPath: `${PHOTO_PREFIX}of-1.jpg`, notes: 'n',
  }

  it('toOutfallRow names every table column an outfall owns', () => {
    expect(toOutfallRow(OUTFALL)).toEqual({
      facility_id: FACILITY_ID, code: 'OF-001', name: 'North dock', receiving_water: 'Santa Ana River', drainage_area: 'Yard',
      latitude: 34.1, longitude: -117.4, outfall_type: 'authorized_nsw', status: 'inactive', is_sampling_point: true,
      substantially_identical_to: 'cccccccc-0000-0000-0000-000000000003', permit_id: 'bbbbbbbb-0000-0000-0000-000000000002',
      photo_path: `${PHOTO_PREFIX}of-1.jpg`, notes: 'n',
    })
  })

  it('parseOutfallRow is the inverse of toOutfallRow', () => {
    expect(parseOutfallRow(toOutfallRow(OUTFALL))).toEqual(OUTFALL)
  })

  it('parseOutfallRow reads a stored row, ignoring the columns an outfall does not own', () => {
    const stored = {
      id: 'f0000000-0000-0000-0000-000000000001', tenant_id: '11111111-1111-1111-1111-111111111111', created_at: '2026-01-01T00:00:00Z',
      ...toOutfallRow({ ...OUTFALL, name: null, latitude: null, longitude: null, permitId: null, photoPath: null }),
    }
    expect(parseOutfallRow(stored)).toEqual({ ...OUTFALL, name: null, latitude: null, longitude: null, permitId: null, photoPath: null })
  })

  it('a stored row survives an empty update unchanged, so a partial update cannot lose data', () => {
    const r = validateOutfall({}, { current: parseOutfallRow(toOutfallRow(OUTFALL)) })
    expect(r).toEqual({ ok: true, outfall: OUTFALL })
  })
})
