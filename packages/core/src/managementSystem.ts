// Shared management-system core: the rules ISO 14001 (environmental) and
// ISO 45001 (OH&S) have in common because both follow the Annex SL
// structure. Environmental-only rules live beside their records
// (environmentalAspect.ts and friends); this module holds what an OH&S
// register will reuse unchanged. See docs/ems/EMS_IMPLEMENTATION_PLAN.md,
// "ISO 45001 extension".

/** Every standard a shared management-system record can belong to. */
export const DISCIPLINES = ['ems', 'ohs', 'integrated'] as const

/**
 * Which management system a shared record belongs to: `ems` (ISO 14001),
 * `ohs` (ISO 45001), or `integrated` for a tenant that runs one combined
 * system. Shared tables carry it as a `discipline` column so the same
 * register serves both standards.
 */
export type Discipline = typeof DISCIPLINES[number]

/** Traffic-light state of a register, as shown on the dashboard. */
export type RegisterHealth = 'green' | 'amber' | 'red'

/** The two facts register health needs from any register row. */
export interface RegisterRow {
  /** False once the row is retired (e.g. an obsolete aspect). Retired rows stay in history but never affect health. */
  active: boolean
  /** ISO calendar date (YYYY-MM-DD) by which the row must next be reviewed. */
  nextReviewDue: string
}

/**
 * Health of a register (aspects, obligations, context, …).
 *
 * An auditor's first request is a dated register, so absence and staleness
 * must show without anyone running a report:
 * - `red`: no active rows. The register effectively does not exist.
 * - `amber`: at least one active row is past its review date.
 * - `green`: every active row is within its review date.
 *
 * A row due today is not yet overdue.
 *
 * @param rows  The register's rows, active and retired.
 * @param today Today's ISO calendar date (YYYY-MM-DD) in the site's timezone.
 */
export function registerHealth(rows: readonly RegisterRow[], today: string): RegisterHealth {
  const active = rows.filter(row => row.active)
  if (active.length === 0) return 'red'
  return active.some(row => row.nextReviewDue < today) ? 'amber' : 'green'
}
