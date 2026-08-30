// Severe-injury reporting — deadline math + status, by jurisdiction.
//
// Separate from 1904.7 recordability (incidentClassification.ts): a case
// can be recordable without being *reportable*, and vice-versa. Reporting
// requires an employer to phone/file with the agency, and the window
// depends on which agency has jurisdiction over the establishment:
//
//   Federal OSHA — 29 CFR 1904.39
//     • a work-related FATALITY        within 8 hours
//     • an in-patient HOSPITALIZATION,
//       AMPUTATION, or LOSS OF AN EYE   within 24 hours
//
//   Cal/OSHA — Labor Code §6409.1(b) + 8 CCR §342
//     • ALL FOUR triggers               within 8 hours
//
// California is not a stricter flavour of the federal rule — it collapses
// the two tiers into one. A California establishment given the federal
// 24-hour window is told it has 16 hours it does not have, on three of the
// four triggers. Because the countdown is the whole point of this module,
// jurisdiction is a REQUIRED argument rather than a defaulted one: a call
// site that forgets it should fail to compile, not silently report federal.
//
// California also starts the clock differently. Federal 1904.39 runs from
// when the employer learned; §6409.1(b) runs from when the employer "knows,
// or with diligent inquiry would have known" — a constructive-knowledge
// standard. The stored basis timestamp is the same field either way, so the
// difference is carried in REPORTING_BASIS_LABEL for the UI to render.
//
// This module is pure: given a trigger, a jurisdiction, the basis moment,
// and "now", it returns the deadline + a status the UI colours.
// Persistence + the actual case number live in
// incident_severe_injury_reports (migrations 197, 252).

export const SEVERE_INJURY_TRIGGERS = [
  'fatality',
  'in_patient_hospitalization',
  'amputation',
  'loss_of_eye',
] as const
export type SevereInjuryTrigger = typeof SEVERE_INJURY_TRIGGERS[number]

export const SEVERE_INJURY_TRIGGER_LABEL: Record<SevereInjuryTrigger, string> = {
  fatality:                    'Fatality',
  in_patient_hospitalization:  'In-patient hospitalization',
  amputation:                  'Amputation',
  loss_of_eye:                 'Loss of an eye',
}

// The jurisdictions whose reporting windows we model. 'federal' is the
// baseline every non-California establishment falls back to — other state
// plans that shorten the window can be added here as they're confirmed.
export const REPORTING_JURISDICTIONS = ['federal', 'CA'] as const
export type ReportingJurisdiction = typeof REPORTING_JURISDICTIONS[number]

export const REPORTING_JURISDICTION_LABEL: Record<ReportingJurisdiction, string> = {
  federal: 'Federal OSHA · 29 CFR 1904.39',
  CA:      'Cal/OSHA · Lab. Code §6409.1(b), 8 CCR §342',
}

/** How the clock's start is described — California uses constructive knowledge. */
export const REPORTING_BASIS_LABEL: Record<ReportingJurisdiction, string> = {
  federal: 'Employer learned at',
  CA:      'Employer knew, or with diligent inquiry would have known, at',
}

/**
 * Map a 2-char US state code to the jurisdiction whose reporting window
 * governs. Unknown, absent, or non-California codes fall back to federal —
 * the conservative direction is the SHORTER window, and federal is never
 * shorter than California, so a miss here never overstates the time left.
 */
export function resolveReportingJurisdiction(
  stateCode: string | null | undefined,
): ReportingJurisdiction {
  return stateCode?.trim().toUpperCase() === 'CA' ? 'CA' : 'federal'
}

export const REPORT_METHODS = ['osha_phone', 'osha_online', 'area_office'] as const
export type ReportMethod = typeof REPORT_METHODS[number]

export const REPORT_METHOD_LABEL: Record<ReportMethod, string> = {
  osha_phone:  'Phoned OSHA (1-800-321-OSHA)',
  osha_online: 'Online report form',
  area_office: 'Nearest OSHA Area Office',
}

const HOUR_MS = 3_600_000

/**
 * The reporting window in hours. Federal splits 8 (fatality) / 24 (the
 * rest); California is 8 for every trigger.
 */
export function reportingWindowHours(
  trigger: SevereInjuryTrigger,
  jurisdiction: ReportingJurisdiction,
): 8 | 24 {
  if (jurisdiction === 'CA') return 8
  return trigger === 'fatality' ? 8 : 24
}

/** Absolute deadline (ms epoch) = the basis moment + the window. */
export function reportingDeadlineMs(
  trigger: SevereInjuryTrigger,
  basisMs: number,
  jurisdiction: ReportingJurisdiction,
): number {
  return basisMs + reportingWindowHours(trigger, jurisdiction) * HOUR_MS
}

export type SevereInjuryReportStatus = 'reported' | 'overdue' | 'due_soon' | 'pending'

export interface SevereInjuryReportState {
  status:     SevereInjuryReportStatus
  deadlineMs: number
  /** Hours until the deadline; negative when overdue. Null once reported. */
  hoursRemaining: number | null
}

/**
 * Classify where a single reportable trigger stands right now.
 * `dueSoonHours` is how close to the deadline flips the status to
 * 'due_soon' (default 2h) so the UI can escalate visually before it's
 * actually late.
 */
export function evaluateSevereInjuryReport(opts: {
  trigger:      SevereInjuryTrigger
  jurisdiction: ReportingJurisdiction
  basisMs:      number
  reportedAtMs: number | null
  nowMs:        number
  dueSoonHours?: number
}): SevereInjuryReportState {
  const deadlineMs = reportingDeadlineMs(opts.trigger, opts.basisMs, opts.jurisdiction)
  if (opts.reportedAtMs != null) {
    return { status: 'reported', deadlineMs, hoursRemaining: null }
  }
  const hoursRemaining = (deadlineMs - opts.nowMs) / HOUR_MS
  const dueSoon = opts.dueSoonHours ?? 2
  if (hoursRemaining < 0)        return { status: 'overdue',  deadlineMs, hoursRemaining }
  if (hoursRemaining <= dueSoon) return { status: 'due_soon', deadlineMs, hoursRemaining }
  return { status: 'pending', deadlineMs, hoursRemaining }
}
