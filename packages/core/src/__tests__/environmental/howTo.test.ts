import { describe, it, expect } from 'vitest'
import { getHowTo, getGuide } from '../../environmental/howTo'
import { resolveLibrary } from '../../environmental/resolve'
import type { GuideDef, JurisdictionPack } from '../../environmental/content'

const guide = (id: string, pageKeys: string[]): GuideDef => ({ id, program: 'stormwater', title: id, pageKeys, quickSteps: ['one'], sections: [] })
const library = resolveLibrary(['federal'], {
  federal: { meta: { jurisdiction: 'federal', version: '1', draftedOn: '2026-10-07', lastVerified: null, status: 'draft', reviewer: null },
    guides: { add: [guide('a', ['home', 'checklists']), guide('b', ['checklists']), guide('c', ['legal'])] } } as JurisdictionPack,
})

describe('getHowTo', () => {
  it('returns the guides for a screen, in library order', () => {
    expect(getHowTo('checklists', library).map(g => g.id)).toEqual(['a', 'b'])
    expect(getHowTo('legal', library).map(g => g.id)).toEqual(['c'])
  })

  it('is empty for a screen with no guide', () => {
    expect(getHowTo('nowhere', library)).toEqual([])
  })

  it('finds one guide by id', () => {
    expect(getGuide('b', library)?.id).toBe('b')
    expect(getGuide('zzz', library)).toBeUndefined()
  })
})
