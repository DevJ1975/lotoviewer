import { describe, it, expect } from 'vitest'
import { findGuidance, groupBySite, standingOf, GUIDANCE_DISCLAIMER, type SiteRows } from '@/lib/environmental/assistant'

const NOW = new Date('2026-10-07T12:00:00Z')

describe('findGuidance', () => {
  it('always carries the disclaimer, and says when the state is not covered', () => {
    const out = findGuidance({ program: 'stormwater', state: 'OR' })
    expect(out.disclaimer).toBe(GUIDANCE_DISCLAIMER)
    expect(out.jurisdiction.status).toBe('unsupported')
    expect(out.notice).toMatch(/federal baseline only/)
    expect(findGuidance({ state: 'CA' }).notice).toBeNull()
  })

  it('answers a stormwater question from the stormwater guides, with steps and citations', () => {
    const out = findGuidance({ program: 'stormwater', state: 'CA', topic: 'how do I do a visual inspection of an outfall' })
    expect(out.found).toBe(true)
    expect(out.guides.length).toBeGreaterThan(0)
    expect(out.guides.length).toBeLessThanOrEqual(3)
    expect(out.guides[0]!.quickSteps.length).toBeGreaterThan(0)
    expect(out.guides.every(g => g.program === 'stormwater' || g.program === 'overview')).toBe(true)
  })

  it('ranks by the topic: a question about outfalls finds the outfall guide first', () => {
    const out = findGuidance({ state: 'CA', topic: 'outfall inspection' })
    expect(out.guides[0]!.title.toLowerCase()).toContain('outfall')
  })

  it('returns nothing from the guides for a topic the library does not discuss, rather than guessing', () => {
    const out = findGuidance({ program: 'stormwater', state: 'CA', topic: 'zzzz qqqq xxxx' })
    expect(out.guides).toEqual([])
  })

  it('lists the program\'s legal requirements with citations, and flags the ones that need checking', () => {
    const out = findGuidance({ program: 'stormwater', state: 'CA' })
    expect(out.requirements.length).toBeGreaterThan(0)
    expect(out.requirements.every(r => r.citation.length > 0)).toBe(true)
    expect(out.requirements.some(r => r.needsChecking !== null)).toBe(true)
    expect(out.requirements.every(r => r.summary.length <= 300)).toBe(true)
  })

  it('layers the state on the federal baseline only where the state is supported', () => {
    const jurisdictions = (state: string) => new Set(findGuidance({ program: 'stormwater', state }).requirements.map(r => r.jurisdiction))
    expect(jurisdictions('CA')).toContain('CA')
    expect(jurisdictions('TX')).toContain('TX')
    expect(jurisdictions('OR')).not.toContain('CA')
  })

  it('treats an unknown program as no program instead of failing', () => {
    expect(findGuidance({ program: 'astrology', state: 'CA' }).found).toBe(true)
  })
})

const rows = (over: Partial<SiteRows> = {}): SiteRows => ({
  site: { id: 's1', name: 'Anaheim Plant', state: 'CA' },
  obligations: [], permits: [], legal: [], findings: [], ...over,
})

describe('standingOf', () => {
  it('counts overdue and due-soon deadlines and finds the next one', () => {
    const s = standingOf(rows({ obligations: [
      { status: 'open', next_due_at: '2026-09-25', lead_days: 30 },
      { status: 'open', next_due_at: '2026-10-16', lead_days: 30 },
      { status: 'open', next_due_at: '2027-03-01', lead_days: 30 },
      { status: 'completed', next_due_at: '2026-01-01', lead_days: 30 },
    ] }), NOW)
    expect(s).toMatchObject({ obligationsOverdue: 1, obligationsDueSoon: 1, nextDeadline: { dueOn: '2026-09-25', days: -12 } })
  })

  it('counts permits in their renewal window and expired ones', () => {
    const s = standingOf(rows({ permits: [
      { status: 'active', expiration_date: '2026-12-01', renewal_lead_days: 90 },
      { status: 'active', expiration_date: '2026-09-01', renewal_lead_days: 90 },
      { status: 'active', expiration_date: '2030-01-01', renewal_lead_days: 90 },
    ] }), NOW)
    expect(s).toMatchObject({ permitsExpiring: 1, permitsExpired: 1 })
  })

  it('counts only requirements that apply when rating them, and reviews that are overdue', () => {
    const s = standingOf(rows({ legal: [
      { applicability: 'applicable', compliance_status: 'non_compliant', last_reviewed_at: '2025-01-01T00:00:00Z', next_review_due: '2026-01-01' },
      { applicability: 'applicable', compliance_status: 'attention', last_reviewed_at: '2026-09-01T00:00:00Z', next_review_due: '2027-09-01' },
      { applicability: 'not_applicable', compliance_status: 'not_evaluated', last_reviewed_at: null, next_review_due: null },
      { applicability: 'under_review', compliance_status: 'non_compliant', last_reviewed_at: null, next_review_due: null },
    ] }), NOW)
    expect(s).toMatchObject({ legalNonCompliant: 1, legalNeedsAttention: 1, legalReviewsOverdue: 1 })
  })

  it('counts open findings only', () => {
    const s = standingOf(rows({ findings: [{ status: 'open' }, { status: 'in_progress' }, { status: 'closed' }] }), NOW)
    expect(s.openFindings).toBe(2)
  })

  it('has no next deadline when nothing is open', () => {
    expect(standingOf(rows(), NOW).nextDeadline).toBeNull()
  })
})

describe('groupBySite', () => {
  it('gives a site its own rows and the ones that cover every site, but not another site\'s', () => {
    const all = [{ facility_id: 's1', n: 1 }, { facility_id: 's2', n: 2 }, { facility_id: null, n: 3 }]
    expect(groupBySite(all, 's1').map(r => r.n)).toEqual([1, 3])
  })
})
