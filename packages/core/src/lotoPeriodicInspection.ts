// 29 CFR 1910.147(c)(6) annual procedure inspection — pure helpers.
//
// The full lifecycle (insert + sign + denormalize next-due) lives on
// the database. This module only handles the bits the UI repeats:
//   - "is this overdue / due-soon / current / never-inspected?"
//   - bucketing a list of equipment into those four cohorts for the
//     /admin/periodic-inspections list
//   - computing the next-due date from a completed inspection so the
//     form can preview "next inspection: 2027-05-15" before signing
//
// No DB, no React. Pure TS.

export const PERIODIC_REVIEW_WINDOW_DAYS = 365
export const PERIODIC_DUE_SOON_DAYS = 30

export type PeriodicStatus = 'never' | 'overdue' | 'due_soon' | 'current'

export interface PeriodicEquipmentSnapshot {
  equipment_id: string
  description: string
  department: string
  next_periodic_review_due_at: string | null
  decommissioned?: boolean
}

export interface PeriodicCohort<T extends PeriodicEquipmentSnapshot> {
  status: PeriodicStatus
  items: T[]
}

/**
 * Classify a single equipment's periodic-review status. `null` due
 * date is a "never inspected" sentinel. Otherwise the date is
 * compared against asOf with a 30-day "due soon" warning window.
 */
export function classifyPeriodic(
  due: string | null,
  asOf: Date,
): PeriodicStatus {
  if (!due) return 'never'
  const dueMs = Date.parse(due)
  if (Number.isNaN(dueMs)) return 'never'
  const nowMs = asOf.getTime()
  const dayMs = 24 * 60 * 60 * 1000
  if (dueMs < nowMs) return 'overdue'
  if (dueMs - nowMs <= PERIODIC_DUE_SOON_DAYS * dayMs) return 'due_soon'
  return 'current'
}

/**
 * Bucket equipment by their periodic-review status. Decommissioned
 * rows are silently dropped — they're not in service, so the auditor
 * doesn't expect a current inspection on them. Each cohort is sorted
 * by due date ascending so the most-urgent entry surfaces first.
 */
export function groupByPeriodic<T extends PeriodicEquipmentSnapshot>(
  equipment: T[],
  asOf: Date,
): PeriodicCohort<T>[] {
  const cohorts: Record<PeriodicStatus, T[]> = {
    never:    [],
    overdue:  [],
    due_soon: [],
    current:  [],
  }
  for (const e of equipment) {
    if (e.decommissioned) continue
    const status = classifyPeriodic(e.next_periodic_review_due_at, asOf)
    cohorts[status].push(e)
  }

  // Sort by due-date ascending: nulls (never) by equipment_id, otherwise
  // by date. Most-urgent first within each cohort.
  for (const list of Object.values(cohorts)) {
    list.sort((a, b) => {
      const ad = a.next_periodic_review_due_at ?? ''
      const bd = b.next_periodic_review_due_at ?? ''
      if (ad === bd) return a.equipment_id.localeCompare(b.equipment_id)
      return ad.localeCompare(bd)
    })
  }

  // Document the display order: overdue → due_soon → never → current.
  // Auditors care about the gaps; current rows are reassurance.
  return [
    { status: 'overdue',  items: cohorts.overdue  },
    { status: 'due_soon', items: cohorts.due_soon },
    { status: 'never',    items: cohorts.never    },
    { status: 'current',  items: cohorts.current  },
  ]
}

/**
 * Compute the next-due timestamp for an inspection. Always
 * `inspected_at + 365 days` so the database trigger and the UI
 * preview agree without extra round-trips.
 */
export function computeNextDueAt(inspectedAt: Date): Date {
  return new Date(inspectedAt.getTime() + PERIODIC_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

export interface AuthorizedEmployeeObserved {
  worker_id: string
  full_name: string
}

export interface PeriodicInspectionRow {
  id: string
  tenant_id: string
  equipment_id: string
  inspector_user_id: string | null
  inspector_name: string
  inspected_at: string
  authorized_employees_observed: AuthorizedEmployeeObserved[]
  deviations: string | null
  corrective_actions: string | null
  signed: boolean
  signed_name: string | null
  signature: string | null
  signed_at: string | null
  ip: string | null
  user_agent: string | null
  next_due_at: string
  created_at: string
  updated_at: string
}
