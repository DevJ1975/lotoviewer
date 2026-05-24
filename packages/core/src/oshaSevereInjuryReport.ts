// OSHA 1904.39 severe-injury reporting — deadline math + status.
//
// Separate from 1904.7 recordability (incidentClassification.ts): a case
// can be recordable without being *reportable*, and vice-versa. 1904.39
// requires an employer to phone/file with OSHA:
//   • a work-related FATALITY        within 8 hours
//   • an in-patient HOSPITALIZATION,
//     AMPUTATION, or LOSS OF AN EYE   within 24 hours
// of learning of the event. Missing these windows is a citable violation,
// so the board needs a live countdown — not a static reminder.
//
// This module is pure: given a trigger, the moment the employer learned
// of it, and "now", it returns the deadline + a status the UI colours.
// Persistence + the actual OSHA case number live in
// incident_severe_injury_reports (migration 197).

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

export const REPORT_METHODS = ['osha_phone', 'osha_online', 'area_office'] as const
export type ReportMethod = typeof REPORT_METHODS[number]

export const REPORT_METHOD_LABEL: Record<ReportMethod, string> = {
  osha_phone:  'Phoned OSHA (1-800-321-OSHA)',
  osha_online: 'Online report form',
  area_office: 'Nearest OSHA Area Office',
}

const HOUR_MS = 3_600_000

/** The reporting window in hours: 8 for a fatality, 24 for the rest. */
export function reportingWindowHours(trigger: SevereInjuryTrigger): 8 | 24 {
  return trigger === 'fatality' ? 8 : 24
}

/** Absolute deadline (ms epoch) = when the employer learned + the window. */
export function reportingDeadlineMs(trigger: SevereInjuryTrigger, basisMs: number): number {
  return basisMs + reportingWindowHours(trigger) * HOUR_MS
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
  basisMs:      number
  reportedAtMs: number | null
  nowMs:        number
  dueSoonHours?: number
}): SevereInjuryReportState {
  const deadlineMs = reportingDeadlineMs(opts.trigger, opts.basisMs)
  if (opts.reportedAtMs != null) {
    return { status: 'reported', deadlineMs, hoursRemaining: null }
  }
  const hoursRemaining = (deadlineMs - opts.nowMs) / HOUR_MS
  const dueSoon = opts.dueSoonHours ?? 2
  if (hoursRemaining < 0)        return { status: 'overdue',  deadlineMs, hoursRemaining }
  if (hoursRemaining <= dueSoon) return { status: 'due_soon', deadlineMs, hoursRemaining }
  return { status: 'pending', deadlineMs, hoursRemaining }
}
