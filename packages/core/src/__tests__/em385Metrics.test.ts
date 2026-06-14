import { describe, it, expect } from 'vitest'
import { computeEm385Metrics, type Em385ItemForMetrics } from '../em385Metrics'

const NOW = new Date('2026-06-14T12:00:00Z')

function item(p: Partial<Em385ItemForMetrics>): Em385ItemForMetrics {
  return {
    status: 'not_started',
    category: 'app_plan',
    due_date: null,
    expires_at: null,
    ...p,
  }
}

describe('computeEm385Metrics', () => {
  it('counts by status and category', () => {
    const m = computeEm385Metrics([
      item({ status: 'accepted', category: 'app_plan' }),
      item({ status: 'in_progress', category: 'app_plan' }),
      item({ status: 'accepted', category: 'permit' }),
    ])
    expect(m.total).toBe(3)
    expect(m.byStatus.accepted).toBe(2)
    expect(m.byStatus.in_progress).toBe(1)
    expect(m.byCategory.app_plan.total).toBe(2)
    expect(m.byCategory.app_plan.accepted).toBe(1)
    expect(m.byCategory.permit.accepted).toBe(1)
  })

  it('excludes not_applicable from the readiness denominator', () => {
    // 1 accepted, 1 in_progress, 2 N/A → in-scope = 2 → 50%.
    const m = computeEm385Metrics([
      item({ status: 'accepted' }),
      item({ status: 'in_progress' }),
      item({ status: 'not_applicable' }),
      item({ status: 'not_applicable' }),
    ])
    expect(m.notApplicable).toBe(2)
    expect(m.percentAccepted).toBe(50)
  })

  it('returns 0% readiness for an all-N/A project (no divide-by-zero)', () => {
    const m = computeEm385Metrics([
      item({ status: 'not_applicable' }),
      item({ status: 'not_applicable' }),
    ])
    expect(m.percentAccepted).toBe(0)
  })

  it('tallies overdue and expiring-soon, including category roll-ups', () => {
    const m = computeEm385Metrics([
      item({ status: 'in_progress', due_date: '2026-06-01', category: 'permit' }), // overdue
      item({ status: 'accepted', expires_at: '2026-07-01', category: 'training_cert' }), // expiring soon
      item({ status: 'accepted', expires_at: '2027-01-01', category: 'training_cert' }), // not soon
    ], NOW)
    expect(m.overdue).toBe(1)
    expect(m.expiringSoon).toBe(1)
    expect(m.byCategory.permit.overdue).toBe(1)
    expect(m.byCategory.training_cert.expiringSoon).toBe(1)
  })

  it('handles an empty register', () => {
    const m = computeEm385Metrics([])
    expect(m.total).toBe(0)
    expect(m.percentAccepted).toBe(0)
    expect(m.overdue).toBe(0)
  })
})
