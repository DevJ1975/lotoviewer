import { describe, it, expect } from 'vitest'
import type { Outfall, Permit } from '@/lib/environmental/client'
import {
  blankOutfallForm, buildOutfallRequest, coordinatePairProblem, coordinatesLabel, inspectHref, otherOutfallsAtSite,
  outfallOptionLabel, outfallToForm, permitsAtSite, representativeOfLabel, sortOutfallsByCode, type OutfallFormState,
} from '@/lib/environmental/outfallView'

const outfall = (over: Partial<Outfall> = {}): Outfall => ({
  id: 'o-1', facility_id: 'site-1', permit_id: null, code: 'OF-001', name: null, receiving_water: null, drainage_area: null,
  latitude: null, longitude: null, outfall_type: 'stormwater', substantially_identical_to: null, is_sampling_point: false,
  status: 'active', photo_path: null, notes: null, ...over,
})

const permit = (over: Partial<Permit> = {}): Permit => ({
  id: 'p-1', facility_id: 'site-1', program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: 'CAS000001',
  issuing_agency: null, jurisdiction: null, status: 'active', effective_date: null, expiration_date: null, renewal_lead_days: 180,
  identifiers: {}, conditions: [], document_path: null, notes: null, health: 'active', ...over,
})

describe('representativeOfLabel', () => {
  const all = [outfall({ id: 'o-1', code: 'OF-001' }), outfall({ id: 'o-2', code: 'OF-002', substantially_identical_to: 'o-1' })]

  it('names the outfall this one stands in for, by the code in the list', () => {
    expect(representativeOfLabel(all[1]!, all)).toBe('Same as OF-001')
  })

  it('has nothing to say for an outfall that stands alone', () => {
    expect(representativeOfLabel(all[0]!, all)).toBeNull()
  })

  it('does not name a code it cannot find', () => {
    expect(representativeOfLabel(outfall({ substantially_identical_to: 'gone' }), all)).toBe('Same as another outfall')
  })
})

describe('what an outfall may point to', () => {
  const a = outfall({ id: 'o-1', code: 'OF-001', name: 'North apron' })
  const b = outfall({ id: 'o-2', code: 'OF-002' })
  const other = outfall({ id: 'o-3', code: 'OF-003', facility_id: 'site-2' })

  it('offers the other outfalls at the site, never the outfall itself and never another site\'s', () => {
    expect(otherOutfallsAtSite([a, b, other], 'site-1', 'o-1').map(o => o.id)).toEqual(['o-2'])
  })

  it('offers every outfall at the site when adding a new one', () => {
    expect(otherOutfallsAtSite([b, a, other], 'site-1', null).map(o => o.id)).toEqual(['o-1', 'o-2'])
  })

  it('offers only the permits at the site, by name', () => {
    const permits = [permit({ id: 'p-2', permit_type: 'Wastewater Discharge' }), permit({ id: 'p-3', facility_id: 'site-2' }), permit()]
    expect(permitsAtSite(permits, 'site-1').map(p => p.id)).toEqual(['p-1', 'p-2'])
  })

  it('labels an option by its code, and its name when it has one', () => {
    expect(outfallOptionLabel(a)).toBe('OF-001: North apron')
    expect(outfallOptionLabel(b)).toBe('OF-002')
  })
})

describe('sortOutfallsByCode', () => {
  it('puts OF-2 before OF-10, which a text sort does not', () => {
    const sorted = sortOutfallsByCode([outfall({ id: 'a', code: 'OF-10' }), outfall({ id: 'b', code: 'OF-2' }), outfall({ id: 'c', code: 'OF-1' })])
    expect(sorted.map(o => o.code)).toEqual(['OF-1', 'OF-2', 'OF-10'])
  })

  it('does not change the list it is given', () => {
    const input = [outfall({ code: 'B' }), outfall({ code: 'A' })]
    sortOutfallsByCode(input)
    expect(input.map(o => o.code)).toEqual(['B', 'A'])
  })
})

describe('inspectHref', () => {
  it('opens the checklists for this outfall', () => {
    expect(inspectHref(outfall({ id: 'abc-123' }))).toBe('/environmental/compliance/checklists?subject_type=outfall&subject=abc-123')
  })

  it('is offered for an inactive outfall, which is still on the site', () => {
    expect(inspectHref(outfall({ status: 'inactive' }))).not.toBeNull()
  })

  it('is not offered for a removed outfall', () => {
    expect(inspectHref(outfall({ status: 'removed' }))).toBeNull()
  })

  it('encodes an id rather than trusting it', () => {
    expect(inspectHref(outfall({ id: 'a&b=c' }))).toBe('/environmental/compliance/checklists?subject_type=outfall&subject=a%26b%3Dc')
  })
})

describe('coordinatesLabel', () => {
  it('shows both numbers as stored', () => {
    expect(coordinatesLabel(outfall({ latitude: 30.267153, longitude: -97.743057 }))).toBe('30.267153, -97.743057')
  })

  it('shows zero as a coordinate, not as missing', () => {
    expect(coordinatesLabel(outfall({ latitude: 0, longitude: 0 }))).toBe('0, 0')
  })

  it('is null without a location', () => {
    expect(coordinatesLabel(outfall())).toBeNull()
  })
})

describe('coordinatePairProblem', () => {
  it('accepts both, or neither', () => {
    expect(coordinatePairProblem('30.1', '-97.7')).toBeNull()
    expect(coordinatePairProblem('', '')).toBeNull()
    expect(coordinatePairProblem('  ', '')).toBeNull()
  })

  it('says to give both when only one is given', () => {
    const message = 'Latitude and longitude go together: give both or neither.'
    expect(coordinatePairProblem('30.1', '')).toBe(message)
    expect(coordinatePairProblem('', '-97.7')).toBe(message)
    expect(coordinatePairProblem('0', ' ')).toBe(message)
  })
})

describe('the form', () => {
  const filled = (over: Partial<OutfallFormState> = {}): OutfallFormState => ({ ...blankOutfallForm(), code: 'OF-001', ...over })

  it('starts as an active stormwater outfall that is not a sampling point', () => {
    expect(blankOutfallForm()).toMatchObject({ outfallType: 'stormwater', status: 'active', isSamplingPoint: false, latitude: '', longitude: '', photoPath: null })
  })

  it('builds the request: trimmed text, blanks as null, coordinates as numbers', () => {
    const result = buildOutfallRequest(filled({
      code: ' OF-001 ', name: ' North apron ', receivingWater: ' Walnut Creek ', drainageArea: '', latitude: ' 30.267153 ', longitude: '-97.743057',
      outfallType: 'combined', status: 'inactive', isSamplingPoint: true, substantiallyIdenticalTo: 'o-9', permitId: 'p-1',
      photoPath: 'tenant/outfalls/a.jpg', notes: '  by the dock ',
    }))
    expect(result).toEqual({
      ok: true,
      body: {
        code: 'OF-001', name: 'North apron', receiving_water: 'Walnut Creek', drainage_area: null, latitude: 30.267153, longitude: -97.743057,
        outfall_type: 'combined', status: 'inactive', is_sampling_point: true, substantially_identical_to: 'o-9', permit_id: 'p-1',
        photo_path: 'tenant/outfalls/a.jpg', notes: 'by the dock',
      },
    })
  })

  it('sends no location, and no links, when none are chosen', () => {
    expect(buildOutfallRequest(filled())).toMatchObject({
      ok: true, body: { latitude: null, longitude: null, substantially_identical_to: null, permit_id: null, photo_path: null },
    })
  })

  it('sends a coordinate of zero as zero, not as nothing', () => {
    expect(buildOutfallRequest(filled({ latitude: '0', longitude: '0' }))).toMatchObject({ ok: true, body: { latitude: 0, longitude: 0 } })
  })

  it('refuses one coordinate without the other', () => {
    const message = 'Latitude and longitude go together: give both or neither.'
    expect(buildOutfallRequest(filled({ latitude: '30.1' }))).toEqual({ ok: false, errors: [message] })
    expect(buildOutfallRequest(filled({ longitude: '-97.7' }))).toEqual({ ok: false, errors: [message] })
  })

  it('refuses a coordinate that is not a number, which cannot be sent as one', () => {
    expect(buildOutfallRequest(filled({ latitude: 'north', longitude: '-97.7' }))).toEqual({ ok: false, errors: ['Latitude must be a number.'] })
    expect(buildOutfallRequest(filled({ latitude: '1', longitude: 'Infinity' }))).toEqual({ ok: false, errors: ['Longitude must be a number.'] })
  })

  it('leaves the range of a coordinate to the API', () => {
    expect(buildOutfallRequest(filled({ latitude: '95', longitude: '-97.7' }))).toMatchObject({ ok: true, body: { latitude: 95 } })
  })

  it('shows a stored outfall in the form and sends back what it was', () => {
    const stored = outfall({
      name: 'North apron', receiving_water: 'Walnut Creek', latitude: 30.5, longitude: -97.7, is_sampling_point: true,
      substantially_identical_to: 'o-9', permit_id: 'p-1', photo_path: 'tenant/outfalls/a.jpg', notes: 'by the dock', status: 'inactive',
    })
    const form = outfallToForm(stored)
    expect(form).toMatchObject({ drainageArea: '', latitude: '30.5', longitude: '-97.7', substantiallyIdenticalTo: 'o-9', permitId: 'p-1' })
    expect(buildOutfallRequest(form)).toEqual({
      ok: true,
      body: {
        code: 'OF-001', name: 'North apron', receiving_water: 'Walnut Creek', drainage_area: null, latitude: 30.5, longitude: -97.7,
        outfall_type: 'stormwater', status: 'inactive', is_sampling_point: true, substantially_identical_to: 'o-9', permit_id: 'p-1',
        photo_path: 'tenant/outfalls/a.jpg', notes: 'by the dock',
      },
    })
  })

  it('shows a stored coordinate of zero as "0", not as an empty field', () => {
    expect(outfallToForm(outfall({ latitude: 0, longitude: 0 }))).toMatchObject({ latitude: '0', longitude: '0' })
  })
})
