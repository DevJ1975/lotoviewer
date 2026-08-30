// LQG contingency plan + Quick Reference Guide — 40 CFR 262 Subpart M.
//
// A large quantity generator must maintain a contingency plan (262.261) and
// submit a Quick Reference Guide to local emergency responders (262.262),
// re-submitting it whenever the plan is amended. This module models the
// facility-level record, the "re-submit the QRG" signal, and assembles the
// QRG content (262.262) for a printable preparation packet.
//
// Mirrors the rest of the module: pure helpers, validation at the boundary,
// and a clear note that generated output is a preparation record — not the
// generator's certified submission.

import type { FieldError } from './hazardousWaste'

export interface EmergencyCoordinator {
  name: string
  phone: string
  role: string
}

export interface EmergencyEquipmentItem {
  name: string
  location: string
  capabilities: string
}

export interface HazardousWasteContingencyPlanRow {
  id:                     string
  tenant_id:              string
  facility_id:            string
  plan_document_url:      string | null
  max_waste_quantity:     string | null
  evacuation_plan:        string | null
  emergency_coordinators: EmergencyCoordinator[]
  emergency_equipment:    EmergencyEquipmentItem[]
  qrg_submitted_at:       string | null
  qrg_submitted_to:       string | null
  last_amended_at:        string | null
  review_due_date:        string | null
  notes:                  string | null
  created_at:             string
  created_by:             string | null
  updated_at:             string
  updated_by:             string | null
}

export interface HazardousWasteContingencyPlanInput {
  plan_document_url:      string | null
  max_waste_quantity:     string | null
  evacuation_plan:        string | null
  emergency_coordinators: EmergencyCoordinator[]
  emergency_equipment:    EmergencyEquipmentItem[]
  qrg_submitted_at:       string | null
  qrg_submitted_to:       string | null
  last_amended_at:        string | null
  review_due_date:        string | null
  notes:                  string | null
}

function isIsoDateLike(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime())
}

/** Validate a contingency-plan input. Empty/unset values are allowed. */
export function validateContingencyPlanInput(input: HazardousWasteContingencyPlanInput): FieldError[] {
  const errors: FieldError[] = []

  if (input.max_waste_quantity && input.max_waste_quantity.length > 200) {
    errors.push({ field: 'max_waste_quantity', message: 'Max waste quantity must be 200 characters or fewer' })
  }
  if (input.evacuation_plan && input.evacuation_plan.length > 4000) {
    errors.push({ field: 'evacuation_plan', message: 'Evacuation plan must be 4000 characters or fewer' })
  }
  if (input.notes && input.notes.length > 4000) {
    errors.push({ field: 'notes', message: 'Notes must be 4000 characters or fewer' })
  }
  for (const [field, value] of [
    ['qrg_submitted_at', input.qrg_submitted_at],
    ['last_amended_at', input.last_amended_at],
    ['review_due_date', input.review_due_date],
  ] as const) {
    if (value && !isIsoDateLike(value)) errors.push({ field, message: 'Invalid date' })
  }
  // Coordinators must at least have a name; the field surface is otherwise
  // free-text so a site isn't blocked on, e.g., a phone format.
  input.emergency_coordinators.forEach((c, i) => {
    if (!c.name?.trim()) errors.push({ field: `emergency_coordinators[${i}].name`, message: 'Coordinator name is required' })
  })
  input.emergency_equipment.forEach((e, i) => {
    if (!e.name?.trim()) errors.push({ field: `emergency_equipment[${i}].name`, message: 'Equipment name is required' })
  })
  return errors
}

export interface ContingencyPlanStatus {
  /** The plan has meaningful content (at least one coordinator). */
  hasPlan: boolean
  /** A QRG has been recorded as submitted to local responders. */
  qrgSubmitted: boolean
  /**
   * The QRG must be (re-)submitted: never submitted, or the plan was amended
   * after the last submission (262.262 requires re-submission on amendment).
   */
  qrgOutstanding: boolean
  /** The plan's review date has passed. */
  reviewDue: boolean
}

/**
 * Derive the actionable status of a contingency plan. Pure: `now` is passed in.
 */
export function contingencyPlanStatus(
  plan: Pick<
    HazardousWasteContingencyPlanRow,
    'emergency_coordinators' | 'qrg_submitted_at' | 'last_amended_at' | 'review_due_date'
  >,
  now: Date | string,
): ContingencyPlanStatus {
  const hasPlan = (plan.emergency_coordinators?.length ?? 0) > 0
  const qrgSubmitted = !!plan.qrg_submitted_at

  // Compare dates as calendar days (string compare works for ISO yyyy-mm-dd,
  // but normalize via Date to tolerate full timestamps).
  const submittedMs = plan.qrg_submitted_at ? new Date(plan.qrg_submitted_at).getTime() : null
  const amendedMs   = plan.last_amended_at ? new Date(plan.last_amended_at).getTime() : null
  const amendedAfterSubmission =
    amendedMs != null && (submittedMs == null || amendedMs > submittedMs)

  const qrgOutstanding = hasPlan && (!qrgSubmitted || amendedAfterSubmission)

  const nowMs = (now instanceof Date ? now : new Date(now)).getTime()
  const reviewMs = plan.review_due_date ? new Date(plan.review_due_date).getTime() : null
  const reviewDue = reviewMs != null && nowMs >= reviewMs

  return { hasPlan, qrgSubmitted, qrgOutstanding, reviewDue }
}

export interface QuickReferenceGuide {
  facilityName: string | null
  epaIdNumber: string | null
  maxWasteQuantity: string | null
  emergencyCoordinators: EmergencyCoordinator[]
  emergencyEquipment: EmergencyEquipmentItem[]
  evacuationPlan: string | null
  preparedDate: string
  note: string
}

const QRG_NOTE =
  'Quick Reference Guide for local emergency responders (40 CFR 262.262). ' +
  'Submit to the local fire department / LEPC and re-submit whenever the ' +
  'contingency plan is amended. This is a preparation record.'

/**
 * Assemble the Quick Reference Guide content (262.262) from a plan + facility.
 * Pure: the caller supplies `preparedDate`.
 */
export function buildQuickReferenceGuide(
  plan: Pick<
    HazardousWasteContingencyPlanRow,
    'max_waste_quantity' | 'emergency_coordinators' | 'emergency_equipment' | 'evacuation_plan'
  >,
  facility: { facilityName: string | null; epaIdNumber: string | null },
  preparedDate: string,
): QuickReferenceGuide {
  return {
    facilityName: facility.facilityName,
    epaIdNumber: facility.epaIdNumber,
    maxWasteQuantity: plan.max_waste_quantity,
    emergencyCoordinators: plan.emergency_coordinators,
    emergencyEquipment: plan.emergency_equipment,
    evacuationPlan: plan.evacuation_plan,
    preparedDate,
    note: QRG_NOTE,
  }
}
