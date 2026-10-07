import { describe, it, expect } from 'vitest'
import { validateOutfall } from '../../environmental/outfalls'

const ok = (body: unknown) => {
  const r = validateOutfall(body)
  if (!r.ok) throw new Error(r.errors.join(' | '))
  return r.outfall
}
const errors = (body: unknown) => { const r = validateOutfall(body); return r.ok ? [] : r.errors }

describe('validateOutfall', () => {
  it('accepts a minimal outfall with safe defaults', () => {
    expect(ok({ code: 'OF-001' })).toEqual({
      code: 'OF-001', name: null, receivingWater: null, drainageArea: null, latitude: null, longitude: null,
      outfallType: 'stormwater', status: 'active', isSamplingPoint: false, substantiallyIdenticalTo: null, permitId: null, notes: null,
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
    expect(errors('x')).toEqual(['Expected an object.'])
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
