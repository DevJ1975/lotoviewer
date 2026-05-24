// Fleet Safety — pre-trip vehicle inspection domain.
//
// Pure module. A checklist is an ordered list of items; each gets a status
// at inspection time. `evaluateInspection` rolls the item statuses into a
// pass/fail (any 'fail' fails the inspection) plus the list of failed items
// so the caller can take the vehicle out of service and record defects.

export const INSPECTION_TYPES = ['pre_trip', 'post_trip', 'periodic'] as const
export type InspectionType = typeof INSPECTION_TYPES[number]

export const ITEM_STATUSES = ['pass', 'fail', 'na'] as const
export type ItemStatus = typeof ITEM_STATUSES[number]

export interface ChecklistItem {
  key:    string
  label:  string
  status: ItemStatus
  note?:  string
}

// Default DMV/DOT-style pre-trip walkaround (FMCSA 49 CFR 396.13). The set
// is intentionally generic; a tenant-configurable template is a later slice.
export const DEFAULT_PRETRIP_ITEMS: { key: string; label: string }[] = [
  { key: 'brakes',          label: 'Service & parking brakes' },
  { key: 'lights',          label: 'Headlights, signals, brake & marker lights' },
  { key: 'tires',           label: 'Tires, wheels & rims' },
  { key: 'steering',        label: 'Steering mechanism' },
  { key: 'mirrors',         label: 'Mirrors & glass' },
  { key: 'wipers',          label: 'Windshield wipers / washer' },
  { key: 'horn',            label: 'Horn' },
  { key: 'coupling',        label: 'Coupling devices (5th wheel / hitch)' },
  { key: 'fluids',          label: 'No fluid leaks (oil, coolant, fuel)' },
  { key: 'emergency_gear',  label: 'Emergency equipment (extinguisher, triangles)' },
  { key: 'seatbelt',        label: 'Seatbelt & cab interior' },
  { key: 'load_secure',     label: 'Cargo secured' },
]

/** Build a fresh checklist (all items defaulted to 'pass'). */
export function buildDefaultChecklist(): ChecklistItem[] {
  return DEFAULT_PRETRIP_ITEMS.map(i => ({ key: i.key, label: i.label, status: 'pass' as ItemStatus }))
}

export interface InspectionResult {
  passed:      boolean
  failedItems: ChecklistItem[]
  /** Auto-generated defect summary from failed items + their notes. */
  defectSummary: string | null
}

/**
 * Roll item statuses into a pass/fail. Any 'fail' fails the whole inspection;
 * 'na' and 'pass' are both non-failing. Returns the failed items and a
 * human-readable defect summary the caller can persist + use to flag the
 * vehicle out of service.
 */
export function evaluateInspection(items: ChecklistItem[]): InspectionResult {
  const failedItems = items.filter(i => i.status === 'fail')
  const passed = failedItems.length === 0
  const defectSummary = passed
    ? null
    : failedItems.map(i => (i.note ? `${i.label}: ${i.note}` : i.label)).join('; ')
  return { passed, failedItems, defectSummary }
}

/** Validate a submitted inspection payload. Returns the first problem or null. */
export function validateInspection(input: {
  inspection_type?: string
  items?: unknown
  odometer_miles?: number | null
}): string | null {
  if (input.inspection_type !== undefined && !INSPECTION_TYPES.includes(input.inspection_type as InspectionType)) {
    return `inspection_type must be one of ${INSPECTION_TYPES.join(', ')}`
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return 'items must be a non-empty array'
  }
  for (const raw of input.items) {
    if (!raw || typeof raw !== 'object') return 'each item must be an object'
    const it = raw as Record<string, unknown>
    if (typeof it.key !== 'string' || !it.key.trim()) return 'each item needs a key'
    if (typeof it.status !== 'string' || !ITEM_STATUSES.includes(it.status as ItemStatus)) {
      return `each item status must be one of ${ITEM_STATUSES.join(', ')}`
    }
  }
  if (input.odometer_miles != null && (typeof input.odometer_miles !== 'number' || input.odometer_miles < 0)) {
    return 'odometer_miles must be a non-negative number'
  }
  return null
}
