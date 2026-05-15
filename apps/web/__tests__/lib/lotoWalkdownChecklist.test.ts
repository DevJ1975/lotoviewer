import { describe, it, expect } from 'vitest'
import {
  checklistCompletion,
  defaultWalkdownItems,
  type WalkdownItem,
} from '@soteria/core/lotoWalkdownChecklist'

function item(p: Partial<WalkdownItem> & Pick<WalkdownItem, 'id' | 'status'>): WalkdownItem {
  return {
    label:      `Item ${p.id}`,
    notes:      null,
    photo_url:  null,
    ...p,
  }
}

describe('checklistCompletion', () => {
  it('reports incomplete when any item is still pending', () => {
    const r = checklistCompletion([
      item({ id: 'a', status: 'pass' }),
      item({ id: 'b', status: 'pending' }),
    ])
    expect(r.complete).toBe(false)
    expect(r.pending).toHaveLength(1)
    expect(r.pending[0].id).toBe('b')
  })

  it('reports incomplete when a fail has no notes', () => {
    const r = checklistCompletion([
      item({ id: 'a', status: 'fail', notes: null }),
    ])
    expect(r.complete).toBe(false)
    expect(r.fails_without_notes).toHaveLength(1)
  })

  it('reports incomplete when a fail has whitespace-only notes', () => {
    const r = checklistCompletion([
      item({ id: 'a', status: 'fail', notes: '   ' }),
    ])
    expect(r.complete).toBe(false)
  })

  it('reports complete when every item is pass / fail-with-notes / N/A', () => {
    const r = checklistCompletion([
      item({ id: 'a', status: 'pass' }),
      item({ id: 'b', status: 'fail', notes: 'Cabinet door damaged' }),
      item({ id: 'c', status: 'n_a' }),
    ])
    expect(r.complete).toBe(true)
    expect(r.pending).toEqual([])
    expect(r.fails_without_notes).toEqual([])
  })

  it('treats N/A as documented without requiring notes', () => {
    const r = checklistCompletion([item({ id: 'a', status: 'n_a' })])
    expect(r.complete).toBe(true)
  })
})

describe('defaultWalkdownItems', () => {
  it('contains every §147(c)(6) item', () => {
    const items = defaultWalkdownItems()
    expect(items.map(i => i.id)).toEqual([
      'procedure_available',
      'sources_match',
      'lock_points_accessible',
      'tryout_verified',
      'workers_can_demonstrate',
      'tags_legible',
    ])
    // All start pending so the inspector has to actively mark each.
    for (const it of items) {
      expect(it.status).toBe('pending')
      expect(it.notes).toBeNull()
      expect(it.photo_url).toBeNull()
    }
  })
})
