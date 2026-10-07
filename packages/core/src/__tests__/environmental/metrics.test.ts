import { describe, it, expect } from 'vitest'
import { summarizeEnvironmentalKpis, needsAttention, type EnvKpiInput } from '../../environmental/metrics'

const at = (iso: string) => new Date(`${iso}T09:00:00Z`)
const empty: EnvKpiInput = { obligations: [], checklistTemplates: [], findings: [], permits: [], legal: [] }

describe('summarizeEnvironmentalKpis', () => {
  it('is all zeros for a site with nothing', () => {
    expect(Object.values(summarizeEnvironmentalKpis(empty, at('2026-10-07'))).every(v => v === 0)).toBe(true)
  })

  it('counts overdue and due-soon open obligations by each one\'s own lead time', () => {
    const k = summarizeEnvironmentalKpis({
      ...empty,
      obligations: [
        { status: 'open', nextDueAt: '2026-10-01', leadDays: 30 },   // overdue
        { status: 'open', nextDueAt: '2026-10-20', leadDays: 30 },   // due soon
        { status: 'open', nextDueAt: '2026-10-20', leadDays: 5 },    // outside its own window
        { status: 'open', nextDueAt: '2026-10-07', leadDays: 0 },    // due today: due soon, not overdue
        { status: 'completed', nextDueAt: '2026-01-01', leadDays: 30 },
        { status: 'dismissed', nextDueAt: '2026-10-08', leadDays: 30 },
      ],
    }, at('2026-10-07'))
    expect(k.obligationsOverdue).toBe(1)
    expect(k.obligationsDueSoon).toBe(2)
  })

  it('counts checklists overdue and never-run separately', () => {
    const k = summarizeEnvironmentalKpis({
      ...empty,
      checklistTemplates: [
        { lastSubmittedOn: '2026-01-01', cadence: 'quarterly', cadenceDays: null },
        { lastSubmittedOn: '2026-09-20', cadence: 'quarterly', cadenceDays: null },
        { lastSubmittedOn: null, cadence: 'monthly', cadenceDays: null },
      ],
    }, at('2026-10-07'))
    expect(k).toMatchObject({ checklistsOverdue: 1, checklistsNeverRun: 1 })
  })

  it('counts only open and in-progress findings', () => {
    expect(summarizeEnvironmentalKpis({ ...empty, findings: [{ status: 'open' }, { status: 'in_progress' }, { status: 'closed' }, { status: 'cancelled' }] }, at('2026-10-07')).openFindings).toBe(2)
  })

  it('counts permits expiring and expired, ignoring ones not in force', () => {
    const k = summarizeEnvironmentalKpis({
      ...empty,
      permits: [
        { status: 'active', expirationDate: '2026-12-01', renewalLeadDays: 180 },  // expiring
        { status: 'active', expirationDate: '2026-01-01', renewalLeadDays: 180 },  // expired
        { status: 'active', expirationDate: '2030-01-01', renewalLeadDays: 180 },  // fine
        { status: 'draft', expirationDate: '2020-01-01', renewalLeadDays: 180 },   // not tracked
      ],
    }, at('2026-10-07'))
    expect(k).toMatchObject({ permitsExpiring: 1, permitsExpired: 1 })
  })

  it('counts legal reviews only for requirements that apply to the site', () => {
    const k = summarizeEnvironmentalKpis({
      ...empty,
      legal: [
        { applicability: 'applicable', lastReviewedAt: null, nextReviewDue: null },
        { applicability: 'applicable', lastReviewedAt: '2025-01-01', nextReviewDue: '2026-01-01' },
        { applicability: 'applicable', lastReviewedAt: '2026-09-01', nextReviewDue: '2027-09-01' },
        { applicability: 'not_applicable', lastReviewedAt: null, nextReviewDue: null },
        { applicability: 'under_review', lastReviewedAt: null, nextReviewDue: null },
      ],
    }, at('2026-10-07'))
    expect(k).toMatchObject({ legalNeverReviewed: 1, legalReviewsOverdue: 1 })
  })
})

describe('needsAttention', () => {
  const base = summarizeEnvironmentalKpis(empty, at('2026-10-07'))

  it('is false when nothing is overdue, expired or unreviewed past due', () => {
    expect(needsAttention(base)).toBe(false)
    expect(needsAttention({ ...base, obligationsDueSoon: 4, permitsExpiring: 2, openFindings: 3, checklistsNeverRun: 2, legalNeverReviewed: 5 })).toBe(false)
  })

  it('is true for any overdue obligation, checklist or legal review, or an expired permit', () => {
    for (const key of ['obligationsOverdue', 'checklistsOverdue', 'permitsExpired', 'legalReviewsOverdue'] as const) {
      expect(needsAttention({ ...base, [key]: 1 }), key).toBe(true)
    }
  })
})
