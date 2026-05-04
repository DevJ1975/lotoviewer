import { describe, it, expect } from 'vitest'
import { parseRiskFilters, toApiParams, toUrlSearch } from '@/lib/risk-filters'

// URL-state filter parser. Both /risk and /risk/list mount this; if
// the parser drops a recognized value or accepts garbage, the heat
// map and the list view drift apart silently.

describe('parseRiskFilters', () => {
  it('returns sensible defaults for an empty URLSearchParams', () => {
    const f = parseRiskFilters(new URLSearchParams())
    expect(f.status).toEqual([])
    expect(f.hazardCategory).toEqual([])
    expect(f.band).toBeNull()
    expect(f.view).toBe('residual')
    expect(f.search).toBe('')
    expect(f.assignedTo).toBeNull()
    expect(f.sort).toBe('residual_score')
    expect(f.dir).toBeNull()
    expect(f.limit).toBe(50)
    expect(f.offset).toBe(0)
  })

  it('treats null search params the same as empty', () => {
    const f = parseRiskFilters(null)
    expect(f.view).toBe('residual')
    expect(f.limit).toBe(50)
  })

  it('parses comma-separated status + hazard_category lists, dropping unknown values', () => {
    const sp = new URLSearchParams({
      status:          'open,in_review,bogus',
      hazard_category: 'physical,chemical,nonsense',
    })
    const f = parseRiskFilters(sp)
    expect(f.status).toEqual(['open', 'in_review'])
    expect(f.hazardCategory).toEqual(['physical', 'chemical'])
  })

  it('accepts band only when valid', () => {
    expect(parseRiskFilters(new URLSearchParams({ band: 'high' })).band).toBe('high')
    expect(parseRiskFilters(new URLSearchParams({ band: 'rainbow' })).band).toBeNull()
  })

  it('accepts view=inherent and falls back to residual otherwise', () => {
    expect(parseRiskFilters(new URLSearchParams({ view: 'inherent' })).view).toBe('inherent')
    expect(parseRiskFilters(new URLSearchParams({ view: 'spelunking' })).view).toBe('residual')
  })

  it('accepts dir=asc/desc and rejects nonsense', () => {
    expect(parseRiskFilters(new URLSearchParams({ dir: 'asc' })).dir).toBe('asc')
    expect(parseRiskFilters(new URLSearchParams({ dir: 'sideways' })).dir).toBeNull()
  })

  it('clamps limit to [1, 200] and offset to [0, …]', () => {
    expect(parseRiskFilters(new URLSearchParams({ limit: '500' })).limit).toBe(200)
    expect(parseRiskFilters(new URLSearchParams({ limit: '0' })).limit).toBe(1)
    expect(parseRiskFilters(new URLSearchParams({ limit: 'cake' })).limit).toBe(50)
    expect(parseRiskFilters(new URLSearchParams({ offset: '-1' })).offset).toBe(0)
  })
})

describe('toApiParams', () => {
  it('emits no params when filters are at defaults', () => {
    const params = toApiParams({
      status: [], hazardCategory: [], band: null, view: 'residual', search: '',
      assignedTo: null, sort: 'residual_score', dir: null, limit: 50, offset: 0,
    })
    expect(params.toString()).toBe('')
  })

  it('emits explicit filter params', () => {
    const params = toApiParams({
      status: ['open', 'in_review'],
      hazardCategory: ['physical'],
      band: 'high',
      view: 'inherent',
      search: 'fryer',
      assignedTo: '00000000-0000-0000-0000-000000000001',
      sort: 'created_at',
      dir: 'asc',
      limit: 100,
      offset: 50,
    })
    const out = params.toString()
    expect(out).toContain('status=open%2Cin_review')
    expect(out).toContain('hazard_category=physical')
    expect(out).toContain('band=high')
    expect(out).toContain('view=inherent')
    expect(out).toContain('search=fryer')
    expect(out).toContain('assigned_to=00000000-0000-0000-0000-000000000001')
    expect(out).toContain('sort=created_at')
    expect(out).toContain('dir=asc')
    expect(out).toContain('limit=100')
    expect(out).toContain('offset=50')
  })

  it('drops view=residual + sort=residual_score (defaults — keeps URLs short)', () => {
    const params = toApiParams({
      status: ['open'], hazardCategory: [], band: null, view: 'residual', search: '',
      assignedTo: null, sort: 'residual_score', dir: null, limit: 50, offset: 0,
    })
    expect(params.has('view')).toBe(false)
    expect(params.has('sort')).toBe(false)
    expect(params.get('status')).toBe('open')
  })
})

describe('toUrlSearch', () => {
  it('round-trips through parseRiskFilters', () => {
    const original = {
      status: ['open' as const, 'monitoring' as const],
      hazardCategory: ['chemical' as const, 'electrical' as const],
      band: 'high' as const,
      view: 'inherent' as const,
      search: 'pump',
      assignedTo: 'abc',
    }
    const qs = toUrlSearch(original)
    const parsed = parseRiskFilters(new URLSearchParams(qs))
    expect(parsed.status).toEqual(original.status)
    expect(parsed.hazardCategory).toEqual(original.hazardCategory)
    expect(parsed.band).toBe(original.band)
    expect(parsed.view).toBe(original.view)
    expect(parsed.search).toBe(original.search)
    expect(parsed.assignedTo).toBe(original.assignedTo)
  })

  it('omits view=residual (default) so URLs stay clean', () => {
    expect(toUrlSearch({ view: 'residual' })).toBe('')
    expect(toUrlSearch({ view: 'inherent' })).toContain('view=inherent')
  })
})
