// Care-management types + helpers for injured-person workflows.
//
// One care_case per (incident, injured_person). The case manager
// tracks clinic visits, restrictions, RTW, and post-incident drug
// testing. The day counters (away / restricted / lost) feed OSHA
// 300 columns + the scorecard's DART/LTIR metrics in later phases.

export const CARE_CASE_STATUSES = [
  'open', 'modified_duty', 'full_duty_returned',
  'permanent_restrictions', 'closed',
] as const
export type CareCaseStatus = typeof CARE_CASE_STATUSES[number]

export const CARE_CASE_STATUS_LABEL: Record<CareCaseStatus, string> = {
  open:                   'Open',
  modified_duty:          'Modified duty',
  full_duty_returned:     'Returned to full duty',
  permanent_restrictions: 'Permanent restrictions',
  closed:                 'Closed',
}

export const DRUG_TEST_STATUSES = [
  'not_required', 'pending', 'negative', 'positive', 'refused',
] as const
export type DrugTestStatus = typeof DRUG_TEST_STATUSES[number]

export const DRUG_TEST_LABEL: Record<DrugTestStatus, string> = {
  not_required: 'Not required',
  pending:      'Pending',
  negative:     'Negative',
  positive:     'Positive',
  refused:      'Refused',
}

export const CARE_VISIT_TYPES = [
  'clinic', 'phone', 'email', 'followup', 'therapy', 'other',
] as const
export type CareVisitType = typeof CARE_VISIT_TYPES[number]

export interface IncidentCareCaseRow {
  id:                      string
  tenant_id:               string
  incident_id:             string
  person_id:               string | null
  case_status:             CareCaseStatus
  initial_visit_at:        string | null
  treating_physician:      string | null
  clinic_name:             string | null
  diagnosis:               string | null
  days_away_from_work:     number
  days_restricted:         number
  days_lost:               number
  return_to_work_at:       string | null
  modified_duty_start:     string | null
  modified_duty_end:       string | null
  restrictions:            string[]
  next_followup_at:        string | null
  drug_test_status:        DrugTestStatus | null
  drug_test_at:            string | null
  drug_test_notes:         string | null
  case_manager_user_id:    string | null
  created_at:              string
  updated_at:              string
  created_by:              string | null
  updated_by:              string | null
}

export interface IncidentCareCaseCreateInput {
  person_id?:              string | null
  case_status?:            CareCaseStatus
  initial_visit_at?:       string | null
  treating_physician?:     string | null
  clinic_name?:            string | null
  diagnosis?:              string | null
  next_followup_at?:       string | null
  case_manager_user_id?:   string | null
}

export interface IncidentCareCasePatchInput {
  case_status?:            CareCaseStatus
  initial_visit_at?:       string | null
  treating_physician?:     string | null
  clinic_name?:            string | null
  diagnosis?:              string | null
  days_away_from_work?:    number
  days_restricted?:        number
  days_lost?:              number
  return_to_work_at?:      string | null
  modified_duty_start?:    string | null
  modified_duty_end?:      string | null
  restrictions?:           string[]
  next_followup_at?:       string | null
  drug_test_status?:       DrugTestStatus | null
  drug_test_at?:           string | null
  drug_test_notes?:        string | null
  case_manager_user_id?:   string | null
}

export interface IncidentCareVisitRow {
  id:                string
  tenant_id:         string
  care_case_id:      string
  visit_at:          string
  visit_type:        CareVisitType
  notes:             string | null
  attachments_count: number
  created_at:        string
  created_by:        string | null
}

export interface IncidentCareVisitInput {
  visit_at?:    string
  visit_type?:  CareVisitType
  notes?:       string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Validators
// ──────────────────────────────────────────────────────────────────────────

export function validateCareCasePatch(input: Partial<IncidentCareCasePatchInput>): string | null {
  if (input.case_status
      && !(CARE_CASE_STATUSES as readonly string[]).includes(input.case_status))
    return `Invalid case_status: ${input.case_status}`
  if (input.drug_test_status
      && !(DRUG_TEST_STATUSES as readonly string[]).includes(input.drug_test_status))
    return `Invalid drug_test_status: ${input.drug_test_status}`
  for (const k of ['days_away_from_work', 'days_restricted', 'days_lost'] as const) {
    const v = input[k]
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)))
      return `${k} must be a non-negative integer`
  }
  if (input.modified_duty_start && input.modified_duty_end) {
    const a = Date.parse(input.modified_duty_start)
    const b = Date.parse(input.modified_duty_end)
    if (!Number.isNaN(a) && !Number.isNaN(b) && b < a)
      return 'modified_duty_end cannot be before modified_duty_start'
  }
  if (input.restrictions && !Array.isArray(input.restrictions))
    return 'restrictions must be an array of strings'
  return null
}

export function validateCareVisit(input: Partial<IncidentCareVisitInput>): string | null {
  if (input.visit_type
      && !(CARE_VISIT_TYPES as readonly string[]).includes(input.visit_type))
    return `Invalid visit_type: ${input.visit_type}`
  if (input.visit_at && Number.isNaN(Date.parse(input.visit_at)))
    return 'visit_at is not a valid timestamp'
  return null
}

// Days-until-followup helper for the cron + UI surface. Returns
// null when there's no follow-up scheduled. Negative when overdue.
export function daysUntilFollowup(
  c: Pick<IncidentCareCaseRow, 'next_followup_at'>,
  now: Date = new Date(),
): number | null {
  if (!c.next_followup_at) return null
  const diff = new Date(c.next_followup_at).getTime() - now.getTime()
  return Math.floor(diff / 86_400_000)
}

// "Is this case still active?" — used by the scorecard's open-cases
// metric. modified_duty is active; closed and full_duty_returned
// are not.
export function isCaseActive(c: Pick<IncidentCareCaseRow, 'case_status'>): boolean {
  return c.case_status === 'open' || c.case_status === 'modified_duty'
}
