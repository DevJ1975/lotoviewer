import { describe, it, expect } from 'vitest'
import { permitLabel, permitsAtSite, type PermitRef } from '@/lib/environmental/permitRefs'

const permit = (over: Partial<PermitRef> & Pick<PermitRef, 'id'>): PermitRef => ({
  facility_id: 'site-a', title: 'Industrial General Permit', permit_number: null, retired_at: null, ...over,
})

describe('permitLabel', () => {
  it('joins the title and the number', () => {
    expect(permitLabel({ title: 'Industrial General Permit', permit_number: '4 19I012345' })).toBe('Industrial General Permit 4 19I012345')
  })

  it('is just the title for a permit with no number', () => {
    expect(permitLabel({ title: 'Air registration', permit_number: null })).toBe('Air registration')
  })
})

describe('permitsAtSite', () => {
  it('offers only the site\'s own permits', () => {
    const permits = [permit({ id: '1' }), permit({ id: '2', facility_id: 'site-b' })]
    expect(permitsAtSite(permits, 'site-a').map(p => p.id)).toEqual(['1'])
    expect(permitsAtSite(permits, 'site-c')).toEqual([])
  })

  it('lists permits in force before retired ones, then by name', () => {
    const permits = [
      permit({ id: 'retired', title: 'Aardvark old permit', retired_at: '2026-01-01T00:00:00Z' }),
      permit({ id: 'b', title: 'Wastewater discharge' }),
      permit({ id: 'a', title: 'Air registration' }),
    ]
    expect(permitsAtSite(permits, 'site-a').map(p => p.id)).toEqual(['a', 'b', 'retired'])
  })

  it('does not reorder the caller\'s array', () => {
    const permits = [permit({ id: 'z', title: 'Zinc' }), permit({ id: 'a', title: 'Air' })]
    permitsAtSite(permits, 'site-a')
    expect(permits.map(p => p.id)).toEqual(['z', 'a'])
  })
})
