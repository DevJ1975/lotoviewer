import { describe, it, expect } from 'vitest'
import {
  expiresFromValidity,
  trainingMatrixTone,
  pivotMatrix,
  type TrainingMatrixRow,
} from '@soteria/core/trainingMatrix'

describe('expiresFromValidity', () => {
  it('returns null for a one-time course (null validity)', () => {
    expect(expiresFromValidity('2026-06-20', null)).toBeNull()
  })

  it('adds whole months', () => {
    expect(expiresFromValidity('2026-06-20', 12)).toBe('2027-06-20')
    expect(expiresFromValidity('2026-01-15', 3)).toBe('2026-04-15')
  })

  it('clamps to the last day when the target month is shorter', () => {
    expect(expiresFromValidity('2026-01-31', 1)).toBe('2026-02-28') // 2026 is not a leap year
    expect(expiresFromValidity('2024-01-31', 1)).toBe('2024-02-29') // leap year
  })

  it('returns null for an unparseable date', () => {
    expect(expiresFromValidity('not-a-date', 12)).toBeNull()
  })
})

describe('trainingMatrixTone', () => {
  it('maps each status to its display tone', () => {
    expect(trainingMatrixTone('current')).toBe('success')
    expect(trainingMatrixTone('due_soon')).toBe('warn')
    expect(trainingMatrixTone('overdue')).toBe('danger')
    expect(trainingMatrixTone('missing')).toBe('danger')
  })
})

function row(over: Partial<TrainingMatrixRow>): TrainingMatrixRow {
  return {
    tenant_id: 't', member_id: 'm', display_name: 'Worker', department: null, position_title: null,
    course_id: 'c', course_code: 'C', course_title: 'Course', category: null,
    completed_at: null, expires_at: null, status: 'missing', ...over,
  }
}

describe('pivotMatrix', () => {
  it('pivots rows into title-sorted columns and worst-first member rows', () => {
    const rows: TrainingMatrixRow[] = [
      row({ member_id: 'm1', display_name: 'Ann', course_id: 'c2', course_code: 'B', course_title: 'Beta',  status: 'current' }),
      row({ member_id: 'm1', display_name: 'Ann', course_id: 'c1', course_code: 'A', course_title: 'Alpha', status: 'due_soon' }),
      row({ member_id: 'm2', display_name: 'Bob', course_id: 'c1', course_code: 'A', course_title: 'Alpha', status: 'missing' }),
      row({ member_id: 'm2', display_name: 'Bob', course_id: 'c2', course_code: 'B', course_title: 'Beta',  status: 'overdue' }),
    ]
    const { courses, members } = pivotMatrix(rows)

    expect(courses.map(c => c.title)).toEqual(['Alpha', 'Beta']) // columns A→Z by title
    // Bob (2 gaps) ranks before Ann (0 gaps, 1 due-soon)
    expect(members.map(m => m.display_name)).toEqual(['Bob', 'Ann'])

    const bob = members[0]
    expect(bob.gapCount).toBe(2)
    expect(bob.dueSoonCount).toBe(0)
    expect(bob.cells['c1']?.status).toBe('missing')

    const ann = members[1]
    expect(ann.gapCount).toBe(0)
    expect(ann.dueSoonCount).toBe(1)
    expect(ann.cells['c2']?.status).toBe('current')
  })

  it('handles empty input', () => {
    expect(pivotMatrix([])).toEqual({ courses: [], members: [] })
  })
})
