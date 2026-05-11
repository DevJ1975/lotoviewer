export const EQUIPMENT_FAMILIES = [
  'general',
  'forklift_electric',
  'forklift_ic_lpg',
  'reach_truck',
  'order_picker',
  'pallet_jack_powered',
  'pallet_lifter_manual',
  'aerial_lift_scissor',
  'aerial_lift_boom',
  'tow_tractor',
  'rough_terrain_forklift',
] as const

export type EquipmentFamily = typeof EQUIPMENT_FAMILIES[number]

export const EQUIPMENT_FAMILY_LABEL: Record<EquipmentFamily, string> = {
  general:                 'General mobile equipment',
  forklift_electric:       'Electric forklift',
  forklift_ic_lpg:         'IC/LPG forklift',
  reach_truck:             'Reach truck',
  order_picker:            'Order picker',
  pallet_jack_powered:     'Powered pallet jack/lifter',
  pallet_lifter_manual:    'Manual pallet lifter',
  aerial_lift_scissor:     'Scissor lift',
  aerial_lift_boom:        'Boom lift',
  tow_tractor:             'Tow tractor/tug',
  rough_terrain_forklift:  'Rough-terrain forklift',
}

export const EQUIPMENT_READINESS_STATUSES = [
  'available',
  'inspection_due',
  'limited_use',
  'out_of_service_pending_review',
  'out_of_service',
  'decommissioned',
] as const

export type EquipmentReadinessStatus = typeof EQUIPMENT_READINESS_STATUSES[number]

export const EQUIPMENT_READINESS_LABEL: Record<EquipmentReadinessStatus, string> = {
  available:                     'Available',
  inspection_due:                'Inspection due',
  limited_use:                   'Limited use',
  out_of_service_pending_review: 'Out of service - pending review',
  out_of_service:                'Out of service',
  decommissioned:                'Decommissioned',
}

export const INSPECTION_RESPONSE_VALUES = ['pass', 'fail', 'na'] as const
export type InspectionResponseValue = typeof INSPECTION_RESPONSE_VALUES[number]

export type InspectionReadinessResult = 'ready' | 'limited_use' | 'blocked'
export type DefectSeverity = 'monitor' | 'repair_soon' | 'critical'
export type DefectActionDecision = 'continue' | 'limited_use' | 'remove_from_service'

export interface EquipmentChecklistTemplate {
  id: string
  tenant_id: string | null
  library_scope: 'global' | 'tenant'
  equipment_family: EquipmentFamily
  title: string
  version_number: number
  status: 'draft' | 'published' | 'archived' | 'superseded'
  osha_basis: string | null
  effective_at: string
}

export interface EquipmentChecklistItem {
  id: string
  template_id: string
  section: string
  prompt: string
  response_type: 'pass_fail_na' | 'number' | 'text' | 'photo_ack'
  required: boolean
  critical: boolean
  photo_required: boolean
  sort_order: number
  help_text: string | null
}

export interface InspectionResponseInput {
  item_id: string
  response: InspectionResponseValue
  numeric_value?: number | null
  notes?: string | null
  severity?: DefectSeverity | null
  action_decision?: DefectActionDecision | null
}

export interface InspectionEvidenceInput {
  storage_path: string
  evidence_kind: 'equipment_full_view' | 'hour_meter' | 'damage' | 'defect' | 'repair' | 'general'
  caption?: string | null
  component?: string | null
  captured_at?: string | null
}

export function normalizeEquipmentFamily(value: unknown): EquipmentFamily {
  return typeof value === 'string' && (EQUIPMENT_FAMILIES as readonly string[]).includes(value)
    ? value as EquipmentFamily
    : 'general'
}

export function inferEquipmentFamily(description: string | null | undefined): EquipmentFamily {
  const text = (description ?? '').toLowerCase()
  if (text.includes('scissor')) return 'aerial_lift_scissor'
  if (text.includes('boom') || text.includes('aerial')) return 'aerial_lift_boom'
  if (text.includes('reach')) return 'reach_truck'
  if (text.includes('order picker')) return 'order_picker'
  if (text.includes('pallet')) return 'pallet_jack_powered'
  if (text.includes('lpg') || text.includes('propane') || text.includes('diesel') || text.includes('gas')) return 'forklift_ic_lpg'
  if (text.includes('forklift') || text.includes('lift truck')) return 'forklift_electric'
  if (text.includes('tug') || text.includes('tow')) return 'tow_tractor'
  return 'general'
}

export function computeInspectionResult(
  responses: Array<Pick<InspectionResponseInput, 'response' | 'severity' | 'action_decision'> & { critical?: boolean }>,
): { result: InspectionReadinessResult; failedItemCount: number; failedCriticalCount: number } {
  let failedItemCount = 0
  let failedCriticalCount = 0
  let limited = false

  for (const response of responses) {
    if (response.response !== 'fail') continue
    failedItemCount += 1
    if (response.critical || response.severity === 'critical' || response.action_decision === 'remove_from_service') {
      failedCriticalCount += 1
    }
    if (response.severity === 'repair_soon' || response.action_decision === 'limited_use') limited = true
  }

  if (failedCriticalCount > 0) return { result: 'blocked', failedItemCount, failedCriticalCount }
  if (limited || failedItemCount > 0) return { result: 'limited_use', failedItemCount, failedCriticalCount }
  return { result: 'ready', failedItemCount, failedCriticalCount }
}

export function readinessStatusFromInspection(result: InspectionReadinessResult): EquipmentReadinessStatus {
  if (result === 'blocked') return 'out_of_service_pending_review'
  if (result === 'limited_use') return 'limited_use'
  return 'available'
}

export function shouldBlockInspectionForStrike(status: 'ready' | 'partial' | 'blocked' | 'not_required'): boolean {
  return status === 'blocked' || status === 'partial'
}

export function canReleaseEquipmentToService(openOtherOutOfServiceDefects: number): boolean {
  return Math.max(0, Math.floor(openOtherOutOfServiceDefects)) === 0
}

export interface InspectionQualitySignalsInput {
  durationSeconds: number | null | undefined
  failedItemCount: number
  photoCount: number
  requiredPhotoCount: number
}

export interface InspectionQualitySignals {
  rushed: boolean
  missingRequiredPhotos: boolean
  allPassNoPhotos: boolean
}

export function computeInspectionQualitySignals(input: InspectionQualitySignalsInput): InspectionQualitySignals {
  const durationSeconds = Math.max(0, Math.floor(input.durationSeconds ?? 0))
  const failedItemCount = Math.max(0, Math.floor(input.failedItemCount))
  const photoCount = Math.max(0, Math.floor(input.photoCount))
  const requiredPhotoCount = Math.max(0, Math.floor(input.requiredPhotoCount))

  return {
    rushed: durationSeconds > 0 && durationSeconds < 30,
    missingRequiredPhotos: photoCount < requiredPhotoCount,
    allPassNoPhotos: failedItemCount === 0 && photoCount === 0,
  }
}
