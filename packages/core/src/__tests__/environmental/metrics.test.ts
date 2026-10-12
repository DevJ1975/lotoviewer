import { describe, it, expect } from 'vitest'
import { summarizeEnvironmentalKpis, needsAttention, type EnvKpiInput } from '../../environmental/metrics'
import type { PermitForStanding } from '../../environmentalPermit'

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

  it('counts permits by the EMS vault\'s renewal rules: soon is within 90 days, missed is past the deadline, and a retired or submitted one counts as neither', () => {
    const permit = (over: Partial<PermitForStanding>): PermitForStanding =>
      ({ retiredAt: null, renewalSubmittedOn: null, renewalApplicationDueOn: null, expiresOn: null, ...over })
    const k = summarizeEnvironmentalKpis({
      ...empty,
      permits: [
        permit({ expiresOn: '2026-12-01' }),                                       // 55 days out: soon
        permit({ expiresOn: '2027-03-01' }),                                       // 145 days out: the 180 tier is not "soon"
        permit({ expiresOn: '2026-01-01' }),                                       // lapsed: missed
        permit({ expiresOn: '2026-09-01', renewalApplicationDueOn: '2026-12-01' }),// the permit's own renewal date wins, and it is ahead
        permit({ expiresOn: '2026-12-01', renewalApplicationDueOn: '2026-10-01' }),// application date passed: missed
        permit({ expiresOn: '2026-01-01', renewalSubmittedOn: '2025-12-01' }),     // renewal submitted: neither
        permit({ expiresOn: '2026-01-01', retiredAt: '2026-02-01T00:00:00Z' }),    // retired: neither
        permit({}),                                                                // no fixed term: neither
      ],
    }, at('2026-10-07'))
    expect(k).toMatchObject({ permitsRenewalSoon: 2, permitsRenewalMissed: 2 })
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
    expect(needsAttention({ ...base, obligationsDueSoon: 4, permitsRenewalSoon: 2, openFindings: 3, checklistsNeverRun: 2, legalNeverReviewed: 5 })).toBe(false)
  })

  it('is true for any overdue obligation, checklist or legal review, or a permit whose renewal deadline was missed', () => {
    for (const key of ['obligationsOverdue', 'checklistsOverdue', 'permitsRenewalMissed', 'legalReviewsOverdue'] as const) {
      expect(needsAttention({ ...base, [key]: 1 }), key).toBe(true)
    }
  })
})
