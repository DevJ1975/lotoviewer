import { describe, expect, it } from 'vitest'
import {
  buildComplianceCells,
  complianceCsv,
  complianceTotals,
  missedQuestionStats,
  type ComplianceInput,
} from '../strikeCompliance'

const now = new Date('2026-11-10T12:00:00Z')
const lineage = new Map([['loto', [{ id: 'v1', versionNumber: 1, supersedesCompletions: false }]]])

function input(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    now,
    lineageByModule: lineage,
    members: [
      { id: 'm-ana', displayName: 'Ana', profileId: 'u-ana', role: 'member', department: 'Sanitation', site: null },
      { id: 'm-ben', displayName: 'Ben', profileId: null, role: null, department: 'Packaging', site: null },
    ],
    assignments: [{ id: 'a1', moduleId: 'loto', targetType: 'tenant', targetId: null, startsAt: null, dueAt: '2026-11-09T00:00:00Z' }],
    completions: [{ moduleId: 'loto', moduleVersionId: 'v1', memberId: null, userId: 'u-ana', completedAt: '2026-11-01T00:00:00Z', expiresAt: null }],
    ...overrides,
  }
}

describe('buildComplianceCells', () => {
  it('credits a completion recorded against the account or the roster entry', () => {
    const cells = buildComplianceCells(input())
    expect(cells.map(c => [c.memberId, c.standing])).toEqual([['m-ana', 'complete'], ['m-ben', 'overdue']])
  })

  it('applies department assignments only to that department', () => {
    const cells = buildComplianceCells(input({
      assignments: [{ id: 'a2', moduleId: 'loto', targetType: 'department', targetId: 'packaging', startsAt: null, dueAt: null }],
    }))
    expect(cells.map(c => c.memberId)).toEqual(['m-ben'])
  })

  it('keeps one cell per member and module, using the assignment due soonest', () => {
    const cells = buildComplianceCells(input({
      completions: [],
      assignments: [
        { id: 'late', moduleId: 'loto', targetType: 'tenant', targetId: null, startsAt: null, dueAt: '2026-12-30T00:00:00Z' },
        { id: 'soon', moduleId: 'loto', targetType: 'tenant', targetId: null, startsAt: null, dueAt: '2026-11-11T00:00:00Z' },
      ],
    }))
    expect(cells.filter(c => c.memberId === 'm-ana')).toEqual([expect.objectContaining({ assignmentId: 'soon', standing: 'due_soon' })])
  })

  it('ignores an expired completion', () => {
    const cells = buildComplianceCells(input({
      completions: [{ moduleId: 'loto', moduleVersionId: 'v1', memberId: 'm-ana', userId: null, completedAt: '2025-01-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' }],
    }))
    expect(cells.find(c => c.memberId === 'm-ana')?.standing).toBe('overdue')
  })
})

describe('complianceTotals', () => {
  it('leaves unreleased work out of the completion rate', () => {
    const cells = buildComplianceCells(input({
      assignments: [
        { id: 'a1', moduleId: 'loto', targetType: 'tenant', targetId: null, startsAt: null, dueAt: '2026-11-09T00:00:00Z' },
        { id: 'a3', moduleId: 'cse', targetType: 'tenant', targetId: null, startsAt: '2026-12-01T00:00:00Z', dueAt: '2026-12-15T00:00:00Z' },
      ],
    }))
    expect(complianceTotals(cells)).toEqual({ assigned: 2, complete: 1, overdue: 1, dueSoon: 0, upcoming: 2, percentComplete: 50 })
  })
})

describe('missedQuestionStats', () => {
  it('ranks questions by miss rate once they have enough attempts', () => {
    const attempts = Array.from({ length: 6 }, (_, i) => ({ questionIds: ['q1', 'q2'], missedQuestionIds: i < 4 ? ['q2'] : [] }))
    expect(missedQuestionStats(attempts)).toEqual([
      { questionId: 'q2', attempts: 6, missed: 4, missRate: 67 },
      { questionId: 'q1', attempts: 6, missed: 0, missRate: 0 },
    ])
    expect(missedQuestionStats(attempts.slice(0, 2))).toEqual([])
  })
})

describe('complianceCsv', () => {
  it('quotes commas and neutralises formula injection in names', () => {
    const csv = complianceCsv(
      [{ memberId: 'm1', moduleId: 'loto', assignmentId: 'a', standing: 'due_soon', dueAt: '2026-11-12T00:00:00Z', completedAt: null }],
      new Map([['m1', '=HYPERLINK("x")']]),
      new Map([['loto', 'LOTO 101, Control of Energy']]),
    )
    expect(csv.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")","LOTO 101, Control of Energy",due soon,2026-11-12,`)
  })
})
