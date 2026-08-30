// EM-385 compliance dashboard math — pure, no I/O, no DOM. Given a project's
// register items, produce the counts the project detail page renders: totals by
// status and category, overdue and expiring tallies, and a single headline
// readiness percentage.
//
// Mirrors nearMissMetrics.ts / jhaMetrics.ts in shape so the dashboards share a
// mental model.

import {
  EM385_CATEGORIES,
  EM385_STATUSES,
  isOverdue,
  isExpiringSoon,
  type Em385Category,
  type Em385Status,
  type Em385RegisterItemRow,
} from './em385'

// Only the fields the math needs — lets callers pass a lightweight projection.
export type Em385ItemForMetrics = Pick<
  Em385RegisterItemRow,
  'status' | 'category' | 'due_date' | 'expires_at'
>

export interface Em385CategoryMetrics {
  total:         number
  accepted:      number
  overdue:       number
  expiringSoon:  number
  notApplicable: number
}

export interface Em385Metrics {
  total:           number
  byStatus:        Record<Em385Status, number>
  byCategory:      Record<Em385Category, Em385CategoryMetrics>
  accepted:        number
  notApplicable:   number
  overdue:         number
  expiringSoon:    number
  // 0–100, rounded. Excludes not-applicable items from the denominator so a
  // contract with many legitimately-N/A requirements isn't penalised. 0 when
  // there are no in-scope (non-N/A) items.
  percentAccepted: number
}

function emptyCategoryMetrics(): Em385CategoryMetrics {
  return { total: 0, accepted: 0, overdue: 0, expiringSoon: 0, notApplicable: 0 }
}

export function computeEm385Metrics(
  items: ReadonlyArray<Em385ItemForMetrics>,
  now: Date = new Date(),
): Em385Metrics {
  const byStatus = Object.fromEntries(
    EM385_STATUSES.map(s => [s, 0]),
  ) as Record<Em385Status, number>

  const byCategory = Object.fromEntries(
    EM385_CATEGORIES.map(c => [c, emptyCategoryMetrics()]),
  ) as Record<Em385Category, Em385CategoryMetrics>

  let accepted = 0
  let notApplicable = 0
  let overdue = 0
  let expiringSoon = 0

  for (const item of items) {
    byStatus[item.status]++

    const cat = byCategory[item.category]
    cat.total++

    if (item.status === 'accepted') { accepted++; cat.accepted++ }
    if (item.status === 'not_applicable') { notApplicable++; cat.notApplicable++ }
    if (isOverdue(item, now)) { overdue++; cat.overdue++ }
    if (isExpiringSoon(item, now)) { expiringSoon++; cat.expiringSoon++ }
  }

  const inScope = items.length - notApplicable
  const percentAccepted = inScope > 0 ? Math.round((accepted / inScope) * 100) : 0

  return {
    total: items.length,
    byStatus,
    byCategory,
    accepted,
    notApplicable,
    overdue,
    expiringSoon,
    percentAccepted,
  }
}
