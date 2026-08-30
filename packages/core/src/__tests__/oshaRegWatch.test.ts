import { describe, it, expect } from 'vitest'
import { sortUpdatesForFeed, type OshaRegulationUpdate } from '../oshaRegWatch'

function update(over: Partial<OshaRegulationUpdate>): OshaRegulationUpdate {
  return {
    id:                 'id',
    title:              'Update',
    category:           'final_rule',
    is_upcoming:        false,
    source_url:         '',
    published_date:     null,
    effective_date:     null,
    comment_close_date: null,
    impact_summary:     'summary',
    severity:           null,
    fetched_at:         '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('sortUpdatesForFeed', () => {
  it('places upcoming items ahead of non-upcoming ones', () => {
    const rows = [
      update({ id: 'past',     is_upcoming: false, published_date: '2026-06-01' }),
      update({ id: 'upcoming', is_upcoming: true,  published_date: '2026-01-01' }),
    ]
    expect(sortUpdatesForFeed(rows).map(r => r.id)).toEqual(['upcoming', 'past'])
  })

  it('orders newest first within a group, by published date', () => {
    const rows = [
      update({ id: 'older', published_date: '2026-03-01' }),
      update({ id: 'newer', published_date: '2026-05-01' }),
    ]
    expect(sortUpdatesForFeed(rows).map(r => r.id)).toEqual(['newer', 'older'])
  })

  it('falls back to fetched_at when a row has no published date', () => {
    const rows = [
      update({ id: 'dated',   published_date: '2026-02-01', fetched_at: '2026-02-02T00:00:00Z' }),
      update({ id: 'undated', published_date: null,         fetched_at: '2026-09-01T00:00:00Z' }),
    ]
    // The undated row's fetched_at (Sep) outranks the dated row (Feb).
    expect(sortUpdatesForFeed(rows).map(r => r.id)).toEqual(['undated', 'dated'])
  })

  it('does not mutate the input array', () => {
    const rows = [update({ id: 'a' }), update({ id: 'b' })]
    const before = rows.map(r => r.id)
    sortUpdatesForFeed(rows)
    expect(rows.map(r => r.id)).toEqual(before)
  })
})
