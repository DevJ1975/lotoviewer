// Shared per-row validation + totals_json build for the historical
// import confirm routes.
//
// Both the single-year confirm route (PDF flow) and the batch
// confirm route (CSV flow) take admin-edited 300A numbers — an
// untrusted boundary — and must:
//   1. coerce + reject any value that isn't a non-negative whole number,
//   2. bound the year to a sane window,
//   3. assemble the Osha300ASummary the scorecard's year-over-year
//      reader expects in totals_json.
//
// Factoring it here keeps the two routes honest about applying the
// SAME rules, so a 300A imported via CSV is validated identically to
// one imported via PDF. Pure functions only — no DB, no I/O — so the
// rules are trivially unit-testable.

import { INJURY_TYPES, type InjuryType, type Osha300ASummary } from '@soteria/core/oshaForms'

// The numeric 300A scalar fields the form / CSV submit, in addition
// to `year` and the per-type breakdown. Mirrors AnnualSummaryFields
// from the extractor, but every value is re-validated here.
export const ANNUAL_SCALAR_FIELDS = [
  'total_deaths',
  'total_days_away',
  'total_restricted',
  'total_other_recordable',
  'total_days_away_count',
  'total_days_restricted_count',
  'total_hours_worked',
  'annual_avg_employees',
] as const

export type AnnualScalarField = (typeof ANNUAL_SCALAR_FIELDS)[number]

// How far back a 300A may be backfilled. OSHA keeps records for 5
// years; we allow a generous 20 so historical trend lines are useful
// without admitting obviously-wrong years (typos, 19xx, future).
export const MAX_BACKFILL_YEARS = 20

export type AnnualRowResult =
  | { ok: true; totals: Osha300ASummary }
  | { ok: false; message: string }

// A non-negative, finite, whole number — or null when the input can't
// be coerced to one. Rejects negatives, floats, NaN, and junk at the
// boundary rather than silently flooring them: the admin typed it, so
// a malformed value is worth a hard failure.
export function asCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 0) return null
  return n
}

// Validate one year's worth of 300A numbers against `thisYear` and
// build the Osha300ASummary, or return a message naming exactly what
// failed. A single malformed value fails the whole row — a partial
// 300A would corrupt the year-over-year math.
//
// `label` prefixes error messages so a batch can name the offending
// year (e.g. "2021: total_deaths must be …"); the single route passes
// no label.
export function validateAnnualRow(
  raw: Record<string, unknown>,
  thisYear: number,
  label = '',
): AnnualRowResult {
  const prefix = label ? `${label}: ` : ''

  const year = asCount(raw.year)
  if (year === null || year < thisYear - MAX_BACKFILL_YEARS || year > thisYear) {
    return { ok: false, message: `${prefix}year must be between ${thisYear - MAX_BACKFILL_YEARS} and ${thisYear}.` }
  }

  const scalars = {} as Record<AnnualScalarField, number>
  for (const key of ANNUAL_SCALAR_FIELDS) {
    const n = asCount(raw[key])
    if (n === null) return { ok: false, message: `${prefix}${key} must be a non-negative integer.` }
    scalars[key] = n
  }

  // Per-type breakdown: a MISSING entry defaults to 0 (the 300A
  // frequently leaves the breakdown blank, and the CSV flow makes it an
  // optional mapping), but a PRESENT entry must still be a valid count —
  // a typo'd illness column shouldn't be silently zeroed.
  const rawByType = (raw.by_injury_type ?? {}) as Record<string, unknown>
  const byInjuryType = {} as Record<InjuryType, number>
  for (const type of INJURY_TYPES) {
    const provided = rawByType[type]
    if (provided === undefined || provided === null) { byInjuryType[type] = 0; continue }
    const n = asCount(provided)
    if (n === null) return { ok: false, message: `${prefix}by_injury_type.${type} must be a non-negative integer.` }
    byInjuryType[type] = n
  }

  const totals: Osha300ASummary = {
    year,
    total_deaths:                scalars.total_deaths,
    total_days_away:             scalars.total_days_away,
    total_restricted:            scalars.total_restricted,
    total_other_recordable:      scalars.total_other_recordable,
    total_days_away_count:       scalars.total_days_away_count,
    total_days_restricted_count: scalars.total_days_restricted_count,
    by_injury_type:              byInjuryType,
    total_hours_worked:          scalars.total_hours_worked,
    annual_avg_employees:        scalars.annual_avg_employees,
  }
  return { ok: true, totals }
}

// The row shape the DB upsert expects, derived from a validated
// summary. Keeps the column-mapping in one place so both routes write
// identical rows.
export function annualSummaryUpsertRow(opts: {
  tenantId:         string
  establishmentId:  string
  totals:           Osha300ASummary
}) {
  return {
    tenant_id:            opts.tenantId,
    establishment_id:     opts.establishmentId,
    year:                 opts.totals.year,
    totals_json:          opts.totals,
    total_hours_worked:   opts.totals.total_hours_worked,
    annual_avg_employees: opts.totals.annual_avg_employees,
  }
}
