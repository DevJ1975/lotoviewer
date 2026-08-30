import { describe, it, expect } from 'vitest'
import {
  comingUpDate,
  selectComingUp,
  type OshaRegulationUpdate,
} from '@soteria/core/oshaRegWatch'

// The Coming Up panel's selection rules. Pure — no DB, no React.

const TODAY = '2026-07-29'

function update(over: Partial<OshaRegulationUpdate> = {}): OshaRegulationUpdate {
  return {
    id:                 'u1',
    title:              'Heat Injury and Illness Prevention',
    category:           'proposed_rule',
    jurisdiction:       'federal',
    is_upcoming:        true,
    source_url:         'https://www.federalregister.gov/documents/x',
    published_date:     '2026-06-01',
    effective_date:     null,
    comment_close_date: null,
    impact_summary:     'Employers would need a written heat plan.',
    severity:           'high',
    fetched_at:         '2026-07-01T00:00:00Z',
    ...over,
  }
}

describe('comingUpDate', () => {
  it('picks the comment deadline when it lands before the effective date', () => {
    const u = update({ comment_close_date: '2026-09-01', effective_date: '2027-01-01' })
    expect(comingUpDate(u, TODAY)).toBe('2026-09-01')
  })

  it('picks the effective date once the comment period has already closed', () => {
    const u = update({ comment_close_date: '2026-06-01', effective_date: '2026-11-20' })
    expect(comingUpDate(u, TODAY)).toBe('2026-11-20')
  })

  it('is null when every date has passed', () => {
    const u = update({ comment_close_date: '2026-01-01', effective_date: '2026-02-01' })
    expect(comingUpDate(u, TODAY)).toBeNull()
  })

  it('is null when the item carries no dates at all', () => {
    expect(comingUpDate(update(), TODAY)).toBeNull()
  })
})

describe('selectComingUp — jurisdiction scoping', () => {
  const federal = update({ id: 'f', jurisdiction: 'federal', effective_date: '2026-11-20' })
  const california = update({ id: 'c', jurisdiction: 'CA', effective_date: '2027-01-01' })

  it('hides Cal/OSHA items from a tenant that does not operate in California', () => {
    const picked = selectComingUp([federal, california], {
      jurisdictions: ['federal'], todayIso: TODAY,
    })
    expect(picked.map(u => u.id)).toEqual(['f'])
  })

  it('includes Cal/OSHA items for a tenant with a California site', () => {
    const picked = selectComingUp([federal, california], {
      jurisdictions: ['federal', 'CA'], todayIso: TODAY,
    })
    expect(picked.map(u => u.id)).toEqual(['f', 'c'])
  })
})

describe('selectComingUp — what qualifies and in what order', () => {
  it('orders by the soonest deadline, whichever date that is', () => {
    const rows = [
      update({ id: 'far',  effective_date: '2027-01-01' }),
      update({ id: 'near', comment_close_date: '2026-08-21' }),
      update({ id: 'mid',  effective_date: '2026-11-20' }),
    ]
    const picked = selectComingUp(rows, { jurisdictions: ['federal'], todayIso: TODAY })
    expect(picked.map(u => u.id)).toEqual(['near', 'mid', 'far'])
  })

  it('drops items whose dates have all passed, even when flagged upcoming', () => {
    const stale = update({ id: 'stale', is_upcoming: true, effective_date: '2026-01-01' })
    const live  = update({ id: 'live',  effective_date: '2026-12-01' })
    const picked = selectComingUp([stale, live], { jurisdictions: ['federal'], todayIso: TODAY })
    expect(picked.map(u => u.id)).toEqual(['live'])
  })

  it('drops dateless items that are NOT flagged upcoming', () => {
    const settled = update({ id: 'settled', is_upcoming: false })
    expect(selectComingUp([settled], { jurisdictions: ['federal'], todayIso: TODAY })).toEqual([])
  })

  // Early-stage rulemaking often has no published date yet — dropping it would
  // hide exactly the items with the most lead time to prepare.
  it('keeps dateless flagged items, but ranks them below anything dated', () => {
    const dateless = update({ id: 'dateless', is_upcoming: true })
    const dated    = update({ id: 'dated',    effective_date: '2027-06-01' })
    const picked = selectComingUp([dateless, dated], { jurisdictions: ['federal'], todayIso: TODAY })
    expect(picked.map(u => u.id)).toEqual(['dated', 'dateless'])
  })

  it('honours the limit after ordering, not before', () => {
    const rows = [
      update({ id: 'far',  effective_date: '2027-01-01' }),
      update({ id: 'near', effective_date: '2026-08-01' }),
    ]
    const picked = selectComingUp(rows, { jurisdictions: ['federal'], todayIso: TODAY, limit: 1 })
    expect(picked.map(u => u.id)).toEqual(['near'])
  })
})
