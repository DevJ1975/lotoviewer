// Pure shapers for OSHA 300 / 300A / 301 / ITA CSV.
//
// "Pure" because nothing here reaches for the DB or the file system
// — the API layer fetches incidents + classifications + care_cases,
// passes them in, and pipes the result into the pdf-lib renderer or
// CSV writer. Keeping these as pure functions makes the math + edge
// cases (privacy-case redaction, day-counter capping, NAICS
// formatting) trivially testable in Vitest.

import type { OshaClassification } from './incidentClassification'

// ──────────────────────────────────────────────────────────────────────────
// 300 — log row
// ──────────────────────────────────────────────────────────────────────────
//
// One row per recordable incident per year. The 300 form has 14
// columns + an injury/illness column-set. We keep our shape close to
// the form's column letters for clarity at the rendering layer.

export const INJURY_TYPES = [
  'injury', 'skin_disorder', 'respiratory', 'poisoning',
  'hearing_loss', 'other_illness',
] as const
export type InjuryType = typeof INJURY_TYPES[number]

export const INJURY_TYPE_LABEL: Record<InjuryType, string> = {
  injury:        'Injury',
  skin_disorder: 'Skin disorder',
  respiratory:   'Respiratory condition',
  poisoning:     'Poisoning',
  hearing_loss:  'Hearing loss',
  other_illness: 'All other illnesses',
}

export interface Osha300Row {
  /** Column A — case number (uses the incident's report_number). */
  case_number:        string
  /** Column B — employee name. "Privacy Case" when is_privacy_case. */
  employee_name:      string
  /** Column C — job title. Suppressed when is_privacy_case. */
  job_title:          string | null
  /** Column D — date of injury or onset of illness. ISO date. */
  date_of_injury:     string
  /** Column E — where the event occurred. Suppressed when is_privacy_case. */
  location_text:      string | null
  /** Column F — short description. Free text. */
  injury_description: string | null
  /** Columns G–J — exactly one classification radio. */
  classification:     Exclude<OshaClassification, null>
  /** Column K — days away (only meaningful when classification='days_away'). */
  days_away:          number
  /** Column L — days restricted (only meaningful when classification='restricted'). */
  days_restricted:    number
  /** Column M — injury vs illness category. */
  injury_type:        InjuryType
  /** Tracks whether name + location were suppressed (1904.29(b)(7-9)). */
  is_privacy_case:    boolean
}

// ──────────────────────────────────────────────────────────────────────────
// 300 row shaper — given everything we know about an incident,
// produce the 300 row (or null when not recordable).
// ──────────────────────────────────────────────────────────────────────────

export interface IncidentLike {
  report_number:   string
  occurred_at:     string                                  // ISO timestamp
  description:     string
  location_text:   string | null
}

export interface ClassificationLike {
  classification:           OshaClassification
  meets_recording_criteria: boolean
  is_privacy_case:          boolean
}

export interface PersonLike {
  full_name:  string | null
  job_title:  string | null
}

export interface CareLike {
  days_away_from_work: number
  days_restricted:     number
}

// OSHA caps each case's days at 180 on the 300 form (1904.7(b)(3)(viii)).
// Once a case crosses that line, the count stays at 180 even if the
// worker is still out — the regulation is explicit about it.
const OSHA_DAYS_CAP = 180

export function build300Row(opts: {
  incident:       IncidentLike
  classification: ClassificationLike
  person:         PersonLike | null
  care:           CareLike | null
  injury_type?:   InjuryType
}): Osha300Row | null {
  const { incident, classification, person, care } = opts
  if (!classification.meets_recording_criteria) return null
  if (!classification.classification) return null

  const isPrivacy = classification.is_privacy_case
  const employeeName = isPrivacy ? 'Privacy Case' : (person?.full_name ?? 'Unknown')
  const jobTitle = isPrivacy ? null : (person?.job_title ?? null)
  const location = isPrivacy ? null : (incident.location_text ?? null)

  const cappedAway = Math.min(care?.days_away_from_work ?? 0, OSHA_DAYS_CAP)
  const cappedRest = Math.min(care?.days_restricted     ?? 0, OSHA_DAYS_CAP)

  // Per OSHA, days_away applies only to the 'days_away' classification;
  // days_restricted only to 'restricted'. We zero the other to keep
  // the form mathematically consistent (the 300A totals row sums
  // these columns).
  const days_away       = classification.classification === 'days_away'  ? cappedAway : 0
  const days_restricted = classification.classification === 'restricted' ? cappedRest : 0

  return {
    case_number:        incident.report_number,
    employee_name:      employeeName,
    job_title:          jobTitle,
    date_of_injury:     incident.occurred_at.slice(0, 10),  // YYYY-MM-DD
    location_text:      location,
    injury_description: incident.description,
    classification:     classification.classification,
    days_away,
    days_restricted,
    injury_type:        opts.injury_type ?? 'injury',
    is_privacy_case:    isPrivacy,
  }
}

export function build300LogRows(items: Array<Parameters<typeof build300Row>[0]>): Osha300Row[] {
  return items
    .map(build300Row)
    .filter((r): r is Osha300Row => r !== null)
}

// ──────────────────────────────────────────────────────────────────────────
// 300A — annual summary
// ──────────────────────────────────────────────────────────────────────────
//
// Aggregates the 300 log into the seven counts at the top of the
// 300A plus the totals broken down by injury vs each illness
// category. Hours-worked + average employees come from the
// establishment row.

export interface Osha300ASummary {
  year:                  int
  total_deaths:          int
  total_days_away:       int
  total_restricted:      int
  total_other_recordable: int
  total_days_away_count:    int     // sum of days_away across all cases
  total_days_restricted_count: int
  by_injury_type: Record<InjuryType, int>
  // Inputs from the establishment row.
  total_hours_worked:    int
  annual_avg_employees:  int
}
type int = number

export function build300ASummary(opts: {
  rows:                   ReadonlyArray<Osha300Row>
  year:                   number
  total_hours_worked:     number
  annual_avg_employees:   number
}): Osha300ASummary {
  const counts: Osha300ASummary = {
    year: opts.year,
    total_deaths: 0,
    total_days_away: 0,
    total_restricted: 0,
    total_other_recordable: 0,
    total_days_away_count: 0,
    total_days_restricted_count: 0,
    by_injury_type: {
      injury: 0, skin_disorder: 0, respiratory: 0, poisoning: 0,
      hearing_loss: 0, other_illness: 0,
    },
    total_hours_worked:   opts.total_hours_worked,
    annual_avg_employees: opts.annual_avg_employees,
  }

  for (const r of opts.rows) {
    switch (r.classification) {
      case 'death':            counts.total_deaths            += 1; break
      case 'days_away':        counts.total_days_away         += 1; break
      case 'restricted':       counts.total_restricted        += 1; break
      case 'other_recordable': counts.total_other_recordable  += 1; break
    }
    counts.total_days_away_count       += r.days_away
    counts.total_days_restricted_count += r.days_restricted
    counts.by_injury_type[r.injury_type] += 1
  }

  return counts
}

// ──────────────────────────────────────────────────────────────────────────
// TRIR-like rate helpers — computed off the 300A counts.
// ──────────────────────────────────────────────────────────────────────────

export const OSHA_RATE_CONSTANT = 200_000

// Total recordable incident rate per 100 full-time-equivalent workers.
// Returns null when hours_worked is zero (avoids NaN; the UI renders
// "—" instead).
export function trirFromSummary(s: Osha300ASummary): number | null {
  if (!s.total_hours_worked) return null
  const recordables = s.total_deaths + s.total_days_away + s.total_restricted + s.total_other_recordable
  return (recordables * OSHA_RATE_CONSTANT) / s.total_hours_worked
}

export function dartFromSummary(s: Osha300ASummary): number | null {
  if (!s.total_hours_worked) return null
  // DART includes deaths in the BLS definition (any case with days
  // away, restricted, or transferred — death satisfies "days away").
  const dart = s.total_deaths + s.total_days_away + s.total_restricted
  return (dart * OSHA_RATE_CONSTANT) / s.total_hours_worked
}

// ──────────────────────────────────────────────────────────────────────────
// 301 — single-incident report (one form per injured person)
// ──────────────────────────────────────────────────────────────────────────
//
// Represents a flat shape of every 301 field; the renderer pours
// these into the form layout. NULL fields render as a blank line.

export interface Osha301Form {
  report_number:           string
  date_of_injury:          string                          // ISO date
  time_of_event:           string | null                   // HH:MM 24h
  case_number:             string                          // = report_number

  // Employee
  employee_full_name:      string | null
  employee_address:        string | null
  employee_dob:            string | null                   // ISO date
  employee_hired_at:       string | null                   // ISO date
  employee_gender:         string | null
  employee_job_title:      string | null

  // Treatment
  treating_physician:      string | null
  treatment_facility:      string | null
  treated_in_emergency_room: boolean
  hospitalised_overnight:    boolean

  // Event
  what_was_employee_doing: string | null                   // narrative
  what_happened:           string | null                   // narrative
  injury_or_illness:       string | null                   // body-part + nature
  what_object_substance:   string | null
  date_of_death:           string | null

  // Reporter
  prepared_by_name:        string | null
  prepared_by_title:       string | null
  prepared_by_phone:       string | null
  prepared_at:             string | null                   // ISO timestamp
}

export interface Build301Inputs {
  incident: {
    report_number:   string
    occurred_at:     string
    description:     string
  }
  person:    PersonLike & {
    home_address:        string | null
    date_of_birth:       string | null
    hire_date:           string | null
    gender:              string | null
    body_part:           string[] | null
    injury_nature:       string | null
    injury_source:       string | null
    treatment_facility:  string | null
  } | null
  care:      {
    treating_physician: string | null
    clinic_name:        string | null
  } | null
  preparer:  {
    name:  string | null
    title: string | null
    phone: string | null
  } | null
  classification: { classification: OshaClassification }
}

export function build301Form(inputs: Build301Inputs): Osha301Form {
  const occurredIso = inputs.incident.occurred_at
  const occurredDate = occurredIso.slice(0, 10)
  const occurredTime = occurredIso.length >= 16 ? occurredIso.slice(11, 16) : null

  const bodyPartLine = inputs.person?.body_part?.length
    ? inputs.person.body_part.join(', ')
    : null
  const natureLine = inputs.person?.injury_nature ?? null
  const injuryLine = [bodyPartLine, natureLine].filter(Boolean).join(' — ') || null

  return {
    report_number:    inputs.incident.report_number,
    date_of_injury:   occurredDate,
    time_of_event:    occurredTime,
    case_number:      inputs.incident.report_number,

    employee_full_name: inputs.person?.full_name ?? null,
    employee_address:   inputs.person?.home_address ?? null,
    employee_dob:       inputs.person?.date_of_birth ?? null,
    employee_hired_at:  inputs.person?.hire_date ?? null,
    employee_gender:    inputs.person?.gender ?? null,
    employee_job_title: inputs.person?.job_title ?? null,

    treating_physician: inputs.care?.treating_physician ?? null,
    treatment_facility: inputs.care?.clinic_name ?? inputs.person?.treatment_facility ?? null,
    treated_in_emergency_room: false,
    hospitalised_overnight:    false,

    what_was_employee_doing: null,
    what_happened:           inputs.incident.description,
    injury_or_illness:       injuryLine,
    what_object_substance:   inputs.person?.injury_source ?? null,
    date_of_death:           inputs.classification.classification === 'death' ? occurredDate : null,

    prepared_by_name:  inputs.preparer?.name  ?? null,
    prepared_by_title: inputs.preparer?.title ?? null,
    prepared_by_phone: inputs.preparer?.phone ?? null,
    prepared_at:       new Date().toISOString(),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ITA CSV — Annual upload to OSHA's Injury Tracking Application.
// ──────────────────────────────────────────────────────────────────────────
//
// Per the OSHA ITA spec, the annual upload is a CSV with one row per
// establishment per year, carrying the 300A counts + the
// establishment metadata. The exact column order / spelling matters
// — OSHA validates field names. We export the canonical column list
// here and a writer that produces the rows in that order.

export const ITA_CSV_COLUMNS = [
  'establishment_name',
  'establishment_id',
  'street',
  'city',
  'state',
  'zip',
  'naics_code',
  'industry_description',
  'annual_average_employees',
  'total_hours_worked',
  'no_injuries',
  'total_deaths',
  'total_dafw_cases',
  'total_djtr_cases',
  'total_other_cases',
  'total_dafw_days',
  'total_djtr_days',
  'total_injuries',
  'total_skin_disorders',
  'total_respiratory_conditions',
  'total_poisonings',
  'total_hearing_loss',
  'total_other_illnesses',
] as const
export type ItaCsvColumn = typeof ITA_CSV_COLUMNS[number]

export interface ItaEstablishmentInput {
  name:         string
  internal_id:  string
  street:       string | null
  city:         string | null
  state:        string | null
  zip:          string | null
  naics_code:   string | null
  industry_description: string | null
  summary:      Osha300ASummary
}

// Returns rows[0] = header, rows[1..] = one per establishment.
export function buildItaCsvRows(items: ReadonlyArray<ItaEstablishmentInput>): string[][] {
  const header: string[] = [...ITA_CSV_COLUMNS]
  const out: string[][] = [header]
  for (const e of items) {
    const totalRecordables =
      e.summary.total_deaths + e.summary.total_days_away
      + e.summary.total_restricted + e.summary.total_other_recordable
    out.push([
      e.name,
      e.internal_id,
      e.street ?? '',
      e.city ?? '',
      e.state ?? '',
      e.zip ?? '',
      e.naics_code ?? '',
      e.industry_description ?? '',
      String(e.summary.annual_avg_employees),
      String(e.summary.total_hours_worked),
      // "no_injuries": OSHA's "if zero, check this box" — express as 1/0
      totalRecordables === 0 ? '1' : '0',
      String(e.summary.total_deaths),
      String(e.summary.total_days_away),
      String(e.summary.total_restricted),
      String(e.summary.total_other_recordable),
      String(e.summary.total_days_away_count),
      String(e.summary.total_days_restricted_count),
      String(e.summary.by_injury_type.injury),
      String(e.summary.by_injury_type.skin_disorder),
      String(e.summary.by_injury_type.respiratory),
      String(e.summary.by_injury_type.poisoning),
      String(e.summary.by_injury_type.hearing_loss),
      String(e.summary.by_injury_type.other_illness),
    ])
  }
  return out
}

// CSV escape: wrap in quotes if the cell contains a comma, double-quote,
// or newline; double up any embedded double-quotes. Used by the API
// layer to assemble the final response body.
export function csvEscape(cell: string): string {
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`
  return cell
}

export function rowsToCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n') + '\n'
}

// ──────────────────────────────────────────────────────────────────────────
// OSHA ITA (Injury Tracking Application) electronic submission payload.
//
// Mirrors the established CSV column shape but emits JSON suitable
// for posting to OSHA's ITA submission endpoint. The exact endpoint
// URL + auth flow are configured at runtime in the API route — this
// helper only shapes the payload, so it stays unit-testable and
// pure.
//
// We expose this as a typed builder rather than a free-form record
// so a typo in a field name shows up at compile time instead of
// after OSHA rejects the submission.
// ──────────────────────────────────────────────────────────────────────────

export interface ItaSubmissionPayload {
  reporting_year:               number
  /** OSHA-issued Establishment ID assigned during ITA registration. */
  establishment_id:             string
  establishment_name:           string
  street:                       string | null
  city:                         string | null
  state:                        string | null
  zip:                          string | null
  naics_code:                   string | null
  industry_description:         string | null
  annual_average_employees:     number
  total_hours_worked:           number
  /** True when the establishment had no recordable cases this year. */
  no_injuries:                  boolean
  totals: {
    deaths:                     number
    days_away_cases:            number
    job_transfer_cases:         number
    other_recordable_cases:     number
    days_away_days:             number
    job_transfer_days:          number
  }
  illness_types: {
    injury:                     number
    skin_disorder:              number
    respiratory_condition:      number
    poisoning:                  number
    hearing_loss:               number
    other_illness:              number
  }
  certification: {
    /** Typed name from `osha_annual_summaries.certified_typed_name`. */
    executive_typed_name:       string | null
    /** ISO timestamp of the in-app certification. */
    certified_at:               string | null
  }
  /** When `include_cases` is true (Appendix B large establishments) the
   *  300 + 301 case rows ride along with the 300A summary. */
  cases?:                       Osha300Row[]
}

export interface BuildItaSubmissionInput {
  year:                       number
  establishment_id:           string
  establishment_name:         string
  street:                     string | null
  city:                       string | null
  state:                      string | null
  zip:                        string | null
  naics_code:                 string | null
  industry_description:       string | null
  summary:                    Osha300ASummary
  certified_typed_name:       string | null
  certified_at:               string | null
  /** Set true for Appendix B 100+-employee establishments — sends
   *  the per-case 300/301 rows alongside the summary. */
  include_cases?:             boolean
  cases?:                     ReadonlyArray<Osha300Row>
}

export function buildItaSubmissionPayload(
  input: BuildItaSubmissionInput,
): ItaSubmissionPayload {
  const totalRecordables =
    input.summary.total_deaths + input.summary.total_days_away
    + input.summary.total_restricted + input.summary.total_other_recordable

  const payload: ItaSubmissionPayload = {
    reporting_year:           input.year,
    establishment_id:         input.establishment_id,
    establishment_name:       input.establishment_name,
    street:                   input.street,
    city:                     input.city,
    state:                    input.state,
    zip:                      input.zip,
    naics_code:               input.naics_code,
    industry_description:     input.industry_description,
    annual_average_employees: input.summary.annual_avg_employees,
    total_hours_worked:       input.summary.total_hours_worked,
    no_injuries:              totalRecordables === 0,
    totals: {
      deaths:                 input.summary.total_deaths,
      days_away_cases:        input.summary.total_days_away,
      job_transfer_cases:     input.summary.total_restricted,
      other_recordable_cases: input.summary.total_other_recordable,
      days_away_days:         input.summary.total_days_away_count,
      job_transfer_days:      input.summary.total_days_restricted_count,
    },
    illness_types: {
      injury:                 input.summary.by_injury_type.injury,
      skin_disorder:          input.summary.by_injury_type.skin_disorder,
      respiratory_condition:  input.summary.by_injury_type.respiratory,
      poisoning:              input.summary.by_injury_type.poisoning,
      hearing_loss:           input.summary.by_injury_type.hearing_loss,
      other_illness:          input.summary.by_injury_type.other_illness,
    },
    certification: {
      executive_typed_name:   input.certified_typed_name,
      certified_at:           input.certified_at,
    },
  }
  if (input.include_cases && input.cases?.length) {
    payload.cases = [...input.cases]
  }
  return payload
}

// Heuristic for whether an establishment's CY-N records must be
// submitted to ITA at all. Returns one of:
//   'summary_only'  — 300A only (>=250 employees any industry, OR
//                     20-249 in Appendix A industries)
//   'summary_and_cases' — 300A + 300 + 301 (>=100 in Appendix B
//                     industries, post-CY2023)
//   'not_required'  — outside the covered population
//
// Industry-list classification is not embedded here because the
// Appendix A/B NAICS-prefix tables drift; the caller passes the
// classification result. This helper just applies the size cutoff.
export type ItaCoverage = 'summary_only' | 'summary_and_cases' | 'not_required'

export function classifyItaCoverage(opts: {
  annual_avg_employees: number
  appendix:             'a' | 'b' | null
}): ItaCoverage {
  const n = opts.annual_avg_employees
  if (opts.appendix === 'b' && n >= 100) return 'summary_and_cases'
  if (n >= 250)                          return 'summary_only'
  if (opts.appendix === 'a' && n >= 20 && n <= 249) return 'summary_only'
  return 'not_required'
}
