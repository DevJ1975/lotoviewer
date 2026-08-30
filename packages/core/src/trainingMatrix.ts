// Pure helpers for the unified Training & Competency Matrix (migration 240).
//
// The DB view v_training_matrix computes the per (member × required course)
// status server-side. These helpers cover what the view can't: the expiry date
// to stamp when a completion is RECORDED, the status → display tone mapping, and
// pivoting the flat view rows into a member × course grid for the admin screen.
// Pure TS (no DOM, no DB) so it's unit-testable and reusable on web + mobile.

export type TrainingMatrixStatus = 'missing' | 'overdue' | 'due_soon' | 'current'
export type TrainingMatrixTone = 'danger' | 'warn' | 'success'

/** One row of v_training_matrix: a member's status for one required course. */
export interface TrainingMatrixRow {
  tenant_id:      string
  member_id:      string
  display_name:   string
  department:     string | null
  position_title: string | null
  course_id:      string
  course_code:    string
  course_title:   string
  category:       string | null
  completed_at:   string | null
  expires_at:     string | null
  status:         TrainingMatrixStatus
}

/** A status's display bucket; the web layer maps tone → Tailwind classes. */
export function trainingMatrixTone(status: TrainingMatrixStatus): TrainingMatrixTone {
  switch (status) {
    case 'current':  return 'success'
    case 'due_soon': return 'warn'
    case 'overdue':
    case 'missing':  return 'danger'
  }
}

/**
 * The expires_at (YYYY-MM-DD) to stamp on a completion, given the course's
 * validity window. Null validity → no expiry (one-time course). Adds whole
 * months to the completion date; if the target month is shorter, clamps to its
 * last day so "Jan 31 + 1 month" lands on Feb 28/29 rather than rolling into March.
 */
export function expiresFromValidity(completedAt: string, validityMonths: number | null): string | null {
  if (validityMonths == null) return null
  const d = new Date(`${completedAt}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const day = d.getUTCDate()
  d.setUTCMonth(d.getUTCMonth() + validityMonths)
  if (d.getUTCDate() < day) d.setUTCDate(0) // shorter target month → clamp to its last day
  return d.toISOString().slice(0, 10)
}

// ── pivot: flat view rows → a member × course grid ──────────────────────────

export interface MatrixCourseColumn {
  course_id: string
  code:      string
  title:     string
}

export interface MatrixCell {
  status:       TrainingMatrixStatus
  completed_at: string | null
  expires_at:   string | null
}

export interface MatrixMemberRow {
  member_id:      string
  display_name:   string
  department:     string | null
  position_title: string | null
  /** course_id → cell; absent when the member has no row for that course. */
  cells:          Record<string, MatrixCell | undefined>
  gapCount:       number // missing + overdue
  dueSoonCount:   number
}

export interface PivotedMatrix {
  courses: MatrixCourseColumn[]
  members: MatrixMemberRow[]
}

/** Pivot flat view rows into columns (courses, A→Z by title) and rows (members,
 *  worst-readiness first: most gaps, then most due-soon, then name). */
export function pivotMatrix(rows: TrainingMatrixRow[]): PivotedMatrix {
  const courseMap = new Map<string, MatrixCourseColumn>()
  const memberMap = new Map<string, MatrixMemberRow>()

  for (const r of rows) {
    if (!courseMap.has(r.course_id)) {
      courseMap.set(r.course_id, { course_id: r.course_id, code: r.course_code, title: r.course_title })
    }
    let mr = memberMap.get(r.member_id)
    if (!mr) {
      mr = {
        member_id: r.member_id, display_name: r.display_name, department: r.department,
        position_title: r.position_title, cells: {}, gapCount: 0, dueSoonCount: 0,
      }
      memberMap.set(r.member_id, mr)
    }
    mr.cells[r.course_id] = { status: r.status, completed_at: r.completed_at, expires_at: r.expires_at }
    if (r.status === 'missing' || r.status === 'overdue') mr.gapCount++
    else if (r.status === 'due_soon') mr.dueSoonCount++
  }

  const courses = [...courseMap.values()].sort((a, b) => a.title.localeCompare(b.title))
  const members = [...memberMap.values()].sort(
    (a, b) => b.gapCount - a.gapCount || b.dueSoonCount - a.dueSoonCount || a.display_name.localeCompare(b.display_name),
  )
  return { courses, members }
}
