import { describe, expect, it } from 'vitest'
import { rate, summarizeMicrolearning, type MicrolearningInput } from '../strikeScorecard'

// WLS Demo's shape: LOTO 101 in English (v1) and Spanish (v2), one supervisor
// sign-off, a fail then a pass, a Spanish-speaking worker, and a lapsed cert.
const now = new Date('2026-11-10T12:00:00Z')

function input(overrides: Partial<MicrolearningInput> = {}): MicrolearningInput {
  return {
    windowDays: 30,
    now,
    modules: [{ id: 'loto', title: 'LOTO 101' }, { id: 'hw', title: 'Hot Work Basics' }],
    versions: [
      { id: 'loto-en', moduleId: 'loto', locale: 'en', versionNumber: 1, supersedesCompletions: false },
      { id: 'loto-es', moduleId: 'loto', locale: 'es', versionNumber: 2, supersedesCompletions: false },
      { id: 'hw-en', moduleId: 'hw', locale: 'en', versionNumber: 1, supersedesCompletions: false },
    ],
    completions: [
      { moduleId: 'loto', moduleVersionId: 'loto-en', memberId: 'm-ana', userId: 'u-ana', completedAt: '2026-11-05T10:00:00Z', expiresAt: '2027-11-05T10:00:00Z', assisted: false },
      { moduleId: 'loto', moduleVersionId: 'loto-es', memberId: 'm-luis', userId: null, completedAt: '2026-11-06T10:00:00Z', expiresAt: '2026-11-25T10:00:00Z', assisted: false },
      { moduleId: 'loto', moduleVersionId: 'loto-en', memberId: 'm-ben', userId: null, completedAt: '2026-11-07T10:00:00Z', expiresAt: '2027-11-07T10:00:00Z', assisted: true },
      { moduleId: 'hw', moduleVersionId: 'hw-en', memberId: 'm-ana', userId: 'u-ana', completedAt: '2025-01-01T10:00:00Z', expiresAt: '2026-01-01T10:00:00Z', assisted: false },
    ],
    attempts: [
      { moduleId: 'loto', memberId: 'm-ana', userId: 'u-ana', submittedAt: '2026-11-04T10:00:00Z', passed: false, scorePercent: 60 },
      { moduleId: 'loto', memberId: 'm-ana', userId: 'u-ana', submittedAt: '2026-11-05T10:00:00Z', passed: true, scorePercent: 90 },
      { moduleId: 'loto', memberId: 'm-luis', userId: null, submittedAt: '2026-11-06T10:00:00Z', passed: true, scorePercent: 100 },
    ],
    practice: [
      { correct: true, hintsUsed: 0 },
      { correct: false, hintsUsed: 1 },
      { correct: true, hintsUsed: 2 },
      { correct: true, hintsUsed: 0 },
    ],
    members: [
      { id: 'm-ana', displayName: 'Ana', profileId: 'u-ana', role: 'member', department: 'Sanitation', site: null },
      { id: 'm-luis', displayName: 'Luis', profileId: null, role: null, department: 'Sanitation', site: null },
      { id: 'm-ben', displayName: 'Ben', profileId: null, role: null, department: 'Packaging', site: null },
      { id: 'm-cai', displayName: 'Cai', profileId: null, role: null, department: 'Packaging', site: null },
    ],
    assignments: [{ id: 'a1', moduleId: 'loto', targetType: 'tenant', targetId: null, startsAt: null, dueAt: '2026-11-08T00:00:00Z' }],
    permitOverrideWorkers: 2,
    ...overrides,
  }
}

describe('summarizeMicrolearning', () => {
  const summary = summarizeMicrolearning(input())

  it('counts completions and the distinct people behind them', () => {
    expect(summary.completions).toBe(3)
    expect(summary.learners).toBe(3)
  })

  it('counts a supervisor sign-off as a completion but keeps it out of scores and pass rates', () => {
    expect(summary.delivery).toEqual({ standard: 2, assisted: 1 })
    expect(summary.passRate).toEqual(rate(2, 3))
    expect(summary.averageScore).toBe(83)
  })

  it('reports first-try success per learner and module, not per attempt', () => {
    expect(summary.firstTryPassRate).toEqual({ numerator: 1, denominator: 2, percent: 50 })
  })

  it('counts a Spanish pass toward the same module and reports the language split', () => {
    const loto = summary.modules.find(m => m.moduleId === 'loto')
    expect(loto).toMatchObject({ completions: 3, learners: 3, assisted: 1, byLocale: { en: 2, es: 1 } })
    expect(summary.languages).toEqual([{ locale: 'en', completions: 2 }, { locale: 'es', completions: 1 }])
    expect(summary.modules.map(m => m.moduleId)).toEqual(['loto'])
  })

  it('measures the workforce holding a current pass against the active roster', () => {
    expect(summary.workforceTrained).toEqual({ numerator: 3, denominator: 4, percent: 75 })
  })

  it('flags certifications about to expire and those already lapsed', () => {
    expect(summary.expiringSoon).toBe(1)
    expect(summary.expired).toBe(1)
  })

  it('reports assignment standing as of now', () => {
    expect(summary.compliance).toMatchObject({ assigned: 4, complete: 3, overdue: 1, percentComplete: 75 })
  })

  it('summarizes practice checks: first-try success and hint use', () => {
    expect(summary.practice).toEqual({ firstTries: 4, solvedFirstTry: rate(3, 4), usedHint: rate(2, 4) })
  })

  it('draws one bar per day for a month, and the bars add up to the completions', () => {
    expect(summary.trend.bucketDays).toBe(1)
    expect(summary.trend.points).toHaveLength(30)
    expect(summary.trend.points.at(-1)?.start).toBe('2026-11-10')
    expect(summary.trend.points.reduce((sum, p) => sum + p.completions, 0)).toBe(summary.completions)
  })

  it('groups a quarter by week', () => {
    const quarter = summarizeMicrolearning(input({ windowDays: 90 }))
    expect(quarter.trend.bucketDays).toBe(7)
    expect(quarter.trend.points).toHaveLength(13)
    expect(quarter.trend.points.reduce((sum, p) => sum + p.completions, 0)).toBe(quarter.completions)
  })

  it('leaves rates empty rather than claiming 0% when there is nothing to measure', () => {
    const empty = summarizeMicrolearning(input({ completions: [], attempts: [], practice: [], members: [] }))
    expect(empty.passRate.percent).toBeNull()
    expect(empty.averageScore).toBeNull()
    expect(empty.workforceTrained.percent).toBeNull()
    expect(empty.modules).toEqual([])
  })
})
