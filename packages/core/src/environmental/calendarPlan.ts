// Turn the resolved library into the calendar rows a site should have.
//
// Pure planning: it says what to create and why something was skipped. Writing
// the rows (and resolving a legal register entry or checklist template to its
// database id) is the caller's job, so this stays testable without a database.

import { advanceDueDate, nextAnnualOccurrence, type ObligationCadence } from '../complianceCalendar'
import type { ApplicabilityContext } from './applicability'
import { applies } from './applicability'
import type { DueAnchor, Resolved, ObligationDef, ResolvedLibrary } from './content'
import type { JurisdictionCode } from './jurisdiction'
import type { EnvProgram } from './siteProfile'

const DAY_MS = 24 * 60 * 60 * 1000

function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The last day of the month, quarter, half-year or year containing `now`. */
function periodEnd(period: 'month' | 'quarter' | 'half' | 'year', now: Date): string {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() // 0-11
  const monthsPerPeriod = { month: 1, quarter: 3, half: 6, year: 12 }[period]
  const endMonth = Math.floor(month / monthsPerPeriod) * monthsPerPeriod + monthsPerPeriod - 1
  return iso(new Date(Date.UTC(year, endMonth + 1, 0)))
}

/**
 * The first due date for an obligation created `now`.
 *  annual     - the next occurrence of the month and day, today included.
 *  period_end - the end of the current period (due today if today is the last day).
 *  rolling    - one cadence from today.
 */
export function firstDueDate(
  anchor: DueAnchor, cadence: ObligationCadence, cadenceDays: number | undefined, now: Date,
): string {
  switch (anchor.kind) {
    case 'annual':
      return nextAnnualOccurrence(anchor.month, anchor.day, now)
    case 'period_end':
      return periodEnd(anchor.period, now)
    case 'rolling':
      return advanceDueDate(iso(utcDay(now)), cadence, cadenceDays ?? null, { clampToMonthEnd: true })
  }
}

export const LIBRARY_CATEGORY = 'environmental'
const MAX_REF_LENGTH = 300

/** Stable key per (library item, facility): the calendar's unique index makes seeding idempotent. */
export function librarySystemKey(libraryKey: string, facilityId: string): string {
  return `env:${libraryKey}:${facilityId}`
}

export interface PlannedObligation {
  system_key:      string
  library_key:     string
  facility_id:     string
  program:         EnvProgram
  title:           string
  description:     string
  regulatory_ref:  string
  category:        typeof LIBRARY_CATEGORY
  cadence:         ObligationCadence
  cadence_days:    number | null
  next_due_at:     string
  lead_days:       number
  due_anchor:      'fixed' | 'period_end'
  /** The jurisdiction whose pack defined this obligation. */
  jurisdiction:    JurisdictionCode
  /** Library ids the caller resolves to database ids. */
  legal_library_key:     string | null
  checklist_library_key: string | null
}

export interface LibraryObligationPlan {
  toCreate: PlannedObligation[]
  /** Applicable obligations the site already has (by system key): left alone. */
  existing: string[]
  /** Library obligations that do not apply to this site, with why. */
  notApplicable: string[]
}

function planOne(def: Resolved<ObligationDef>, facilityId: string, now: Date): PlannedObligation {
  return {
    system_key:     librarySystemKey(def.id, facilityId),
    library_key:    def.id,
    facility_id:    facilityId,
    program:        def.program,
    title:          def.title,
    description:    def.description,
    regulatory_ref: def.citations.map(c => c.ref).join('; ').slice(0, MAX_REF_LENGTH),
    category:       LIBRARY_CATEGORY,
    cadence:        def.cadence,
    cadence_days:   def.cadenceDays ?? null,
    next_due_at:    firstDueDate(def.anchor, def.cadence, def.cadenceDays, now),
    lead_days:      def.leadDays,
    due_anchor:     def.anchor.kind === 'period_end' ? 'period_end' : 'fixed',
    jurisdiction:   def.source,
    legal_library_key:     def.legalId ?? null,
    checklist_library_key: def.checklistTemplateId ?? null,
  }
}

/**
 * Which obligations to add for a site: those that apply and are not already
 * there. Existing rows are never rewritten (a person may have changed an owner
 * or a date), so re-applying the library only ever fills gaps.
 */
export function planLibraryObligations(
  library: ResolvedLibrary,
  context: ApplicabilityContext,
  facilityId: string,
  existingSystemKeys: ReadonlySet<string>,
  now: Date,
): LibraryObligationPlan {
  const plan: LibraryObligationPlan = { toCreate: [], existing: [], notApplicable: [] }
  for (const def of library.obligations) {
    if (!applies(def.appliesWhen, context)) { plan.notApplicable.push(def.id); continue }
    if (existingSystemKeys.has(librarySystemKey(def.id, facilityId))) { plan.existing.push(def.id); continue }
    plan.toCreate.push(planOne(def, facilityId, now))
  }
  return plan
}

/** The library keys of every obligation applicable to the site, for spotting stale rows. */
export function applicableObligationKeys(
  library: ResolvedLibrary, context: ApplicabilityContext, facilityId: string,
): Set<string> {
  return new Set(
    library.obligations.filter(def => applies(def.appliesWhen, context)).map(def => librarySystemKey(def.id, facilityId)),
  )
}
