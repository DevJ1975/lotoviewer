import { describe, it, expect } from 'vitest'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parseResultsQuery } from '@/lib/environmental/monitoringResultsQuery'

const ID = 'f0000000-0000-0000-0000-0000000000a1'
const parse = (query: string) => parseResultsQuery(new URLSearchParams(query))
const errorsOf = (query: string) => { const r = parse(query); return r.ok ? [] : r.errors }

describe('parseResultsQuery', () => {
  it('asks for the first page of everything, a page of 50, when given nothing', () => {
    expect(parse('')).toEqual({ ok: true, facilityId: null, outfallId: null, parameter: null, from: null, to: null, pageSize: DEFAULT_PAGE_SIZE, cursor: null })
    expect(DEFAULT_PAGE_SIZE).toBe(50)
  })

  it('reads every filter, trimmed, ids in lower case', () => {
    const r = parse(`facility_id=${ID.toUpperCase()}&outfall_id=${ID}&parameter=%20Oil%20%26%20grease%20&from=2026-01-01&to=2026-06-30&limit=25`)
    expect(r).toEqual({
      ok: true, facilityId: ID, outfallId: ID, parameter: 'Oil & grease', from: '2026-01-01', to: '2026-06-30', pageSize: 25, cursor: null,
    })
  })

  it('treats a blank filter as not given', () => {
    expect(parse('outfall_id=&parameter=%20&from=')).toMatchObject({ ok: true, outfallId: null, parameter: null, from: null })
  })

  it('refuses a malformed id, date or parameter, saying which', () => {
    expect(errorsOf('facility_id=nope')).toEqual(['facility_id must be an id.'])
    expect(errorsOf('outfall_id=1')).toEqual(['outfall_id must be an id.'])
    expect(errorsOf('from=2026-02-30')).toEqual(['from must be a date such as 2026-07-01.'])
    expect(errorsOf('to=yesterday')).toEqual(['to must be a date such as 2026-07-01.'])
    expect(errorsOf(`parameter=${'p'.repeat(81)}`)).toEqual(['parameter is too long (the limit is 80 characters).'])
  })

  it('refuses a range that ends before it starts, and takes a single day', () => {
    expect(errorsOf('from=2026-02-02&to=2026-02-01')).toEqual(['to cannot be before from.'])
    expect(parse('from=2026-02-02&to=2026-02-02')).toMatchObject({ ok: true, from: '2026-02-02', to: '2026-02-02' })
  })

  it('bounds the page size: 1 to 200, whole numbers', () => {
    expect(parse(`limit=${MAX_PAGE_SIZE}`)).toMatchObject({ ok: true, pageSize: 200 })
    expect(parse('limit=1')).toMatchObject({ ok: true, pageSize: 1 })
    for (const bad of ['0', '201', '-5', '2.5', 'many', '1e2']) expect(errorsOf(`limit=${bad}`), bad).toEqual(['limit must be a whole number from 1 to 200.'])
  })

  describe('the cursor', () => {
    const cursor = `2026-02-03T10:00:00+00:00|${ID}`
    it('is read into the time and id of the last row of the previous page', () => {
      expect(parse(`cursor=${encodeURIComponent(cursor)}`)).toMatchObject({ ok: true, cursor: { sampledAt: '2026-02-03T10:00:00+00:00', id: ID } })
      expect(parse(`cursor=${encodeURIComponent(`2026-02-03T10:00:00.123456Z|${ID}`)}`)).toMatchObject({ ok: true, cursor: { sampledAt: '2026-02-03T10:00:00.123456Z' } })
    })

    it('is refused unless it is exactly a time and an id: it goes into a filter string, so nothing else may through', () => {
      const attacks = [
        `2026-02-03T10:00:00Z),or(id.not.is.null|${ID}`,
        `2026-02-03T10:00:00Z,id.gt.0|${ID}`,
        `2026-02-03T10:00:00Z|${ID}),tenant_id.neq.x`,
        `2026-02-03|${ID}`,
        `2026-13-45T10:00:00Z|${ID}`,
        '2026-02-03T10:00:00Z|not-an-id',
        `${ID}`,
        '|',
      ]
      for (const attack of attacks) expect(errorsOf(`cursor=${encodeURIComponent(attack)}`), attack).toEqual(['cursor is not one this list gave out.'])
    })
  })

  it('reports every problem at once', () => {
    expect(errorsOf('facility_id=x&from=y&limit=0&cursor=z')).toHaveLength(4)
  })
})
