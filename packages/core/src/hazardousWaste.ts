export type HazardousWasteAreaType =
  | 'satellite_accumulation'
  | 'central_accumulation'
  | 'universal_waste'
  | 'used_oil'
  | 'inspection_only'

export interface HazardousWasteFieldCheck {
  id: string
  label: string
  detail: string
  areaTypes: HazardousWasteAreaType[]
  critical: boolean
}

export interface HazardousWasteCalendarItem {
  id: string
  title: string
  cadence: string
  dueRule: string
  ownerHint: string
  notes: string
}

export interface HazardousWasteDocumentPacket {
  id: string
  title: string
  officialSource: string
  systemOutput: string
  submissionMode: 'api_candidate' | 'portal_upload' | 'pdf_record'
  caution: string
}

export interface HazardousWasteFieldDraft {
  id: string
  areaType: HazardousWasteAreaType
  locationName: string
  containerLabel: string
  wasteDescription: string
  observations: string
  checkedIds: string[]
  flaggedIds: string[]
  updatedAt: string
}

export const HAZARDOUS_WASTE_AREA_LABEL: Record<HazardousWasteAreaType, string> = {
  satellite_accumulation: 'Satellite accumulation',
  central_accumulation: 'Central accumulation',
  universal_waste: 'Universal waste',
  used_oil: 'Used oil',
  inspection_only: 'Inspection only',
}

export const HAZARDOUS_WASTE_FIELD_CHECKS: HazardousWasteFieldCheck[] = [
  {
    id: 'closed-container',
    label: 'Container is closed except when adding or removing waste',
    detail: 'Open funnels, loose bungs, or propped lids should be corrected before the area is left unattended.',
    areaTypes: ['satellite_accumulation', 'central_accumulation', 'universal_waste', 'used_oil'],
    critical: true,
  },
  {
    id: 'compatible-container',
    label: 'Container appears compatible and in good condition',
    detail: 'Look for corrosion, swelling, leaks, degraded liners, cracked lids, damaged seams, and incompatible residue.',
    areaTypes: ['satellite_accumulation', 'central_accumulation', 'universal_waste', 'used_oil'],
    critical: true,
  },
  {
    id: 'label-readable',
    label: 'Waste label is present, readable, and facing outward',
    detail: 'The label should identify the contents clearly enough for workers and responders.',
    areaTypes: ['satellite_accumulation', 'central_accumulation', 'universal_waste', 'used_oil'],
    critical: true,
  },
  {
    id: 'hazards-marked',
    label: 'Hazard indicators match the waste stream',
    detail: 'Use the approved site label language for flammable, corrosive, toxic, reactive, oxidizer, and other hazards.',
    areaTypes: ['satellite_accumulation', 'central_accumulation'],
    critical: true,
  },
  {
    id: 'saa-at-point',
    label: 'Satellite container is at or near the point of generation',
    detail: 'Satellite containers should remain under control of the operator generating the waste.',
    areaTypes: ['satellite_accumulation'],
    critical: true,
  },
  {
    id: 'saa-volume-under-limit',
    label: 'Satellite quantity is below the site limit',
    detail: 'Default guideposts: 55 gallons non-acute hazardous waste, 1 quart liquid acute or extremely hazardous waste, and 1 kg solid acute waste.',
    areaTypes: ['satellite_accumulation'],
    critical: true,
  },
  {
    id: 'accumulation-date',
    label: 'Accumulation start date is present where required',
    detail: 'Central accumulation containers need a start date. Satellite containers need prompt dating when the satellite limit is exceeded or moved to central accumulation.',
    areaTypes: ['satellite_accumulation', 'central_accumulation', 'universal_waste'],
    critical: true,
  },
  {
    id: 'secondary-containment',
    label: 'Secondary containment is clean and adequate',
    detail: 'Inspect berms, trays, pallets, sumps, and nearby drains for standing liquid, residue, damage, and capacity concerns.',
    areaTypes: ['central_accumulation', 'used_oil'],
    critical: false,
  },
  {
    id: 'aisle-access',
    label: 'Aisle space and emergency access are clear',
    detail: 'Keep access open for inspection, spill response, emergency equipment, and container movement.',
    areaTypes: ['central_accumulation', 'inspection_only'],
    critical: false,
  },
  {
    id: 'incompatibles-separated',
    label: 'Incompatible wastes are separated',
    detail: 'Check acids from bases, oxidizers from organics, cyanides/sulfides from acids, water reactives from liquids, and site-specific incompatibilities.',
    areaTypes: ['central_accumulation', 'satellite_accumulation'],
    critical: true,
  },
  {
    id: 'emergency-info-posted',
    label: 'Emergency contacts and spill instructions are available',
    detail: 'Workers should know who to call, where spill supplies are located, and when to evacuate instead of responding.',
    areaTypes: ['central_accumulation', 'inspection_only'],
    critical: false,
  },
  {
    id: 'manifest-ready',
    label: 'Shipment paperwork can be assembled from current data',
    detail: 'Confirm generator site, EPA ID, transporter, TSDF, waste codes, container counts, DOT description, and emergency phone before pickup.',
    areaTypes: ['central_accumulation'],
    critical: false,
  },
]

export const HAZARDOUS_WASTE_CALENDAR: HazardousWasteCalendarItem[] = [
  {
    id: 'federal-biennial-report',
    title: 'Federal Biennial Hazardous Waste Report',
    cadence: 'Every even-numbered year',
    dueRule: 'March 1 for the preceding odd-numbered report year',
    ownerHint: 'Environmental manager or hazardous waste program owner',
    notes: 'Applies to covered RCRA generators and facilities. Keep source data by EPA ID, waste stream, manifest, and management method.',
  },
  {
    id: 'california-annual-facility-report',
    title: 'California Annual Facility Report support file',
    cadence: 'Annually',
    dueRule: 'March 1 cycle unless DTSC updates the program instructions',
    ownerHint: 'California hazardous waste program owner',
    notes: 'Use the system export as a preparation record for DTSC/RCRAInfo workflows; confirm the current DTSC filing instructions before submission.',
  },
  {
    id: 'cers-hmbp',
    title: 'CERS Hazardous Materials Business Plan certification',
    cadence: 'Annually or when locally required',
    dueRule: 'Default reminder March 1; override by CUPA/local jurisdiction',
    ownerHint: 'EHS manager or facility manager',
    notes: 'CERS EDT is primarily an agency exchange interface. Business users should prepare portal-ready data and submit through the required local process.',
  },
  {
    id: 'epcra-tier-ii',
    title: 'EPCRA Tier II chemical inventory report',
    cadence: 'Annually',
    dueRule: 'March 1 for prior calendar year inventory',
    ownerHint: 'Chemical inventory owner',
    notes: 'Hazardous waste data may support chemical inventory reconciliation, but Tier II is managed through the chemical inventory/reporting workflow.',
  },
  {
    id: 'central-accumulation-inspection',
    title: 'Central accumulation area inspection',
    cadence: 'Weekly default',
    dueRule: 'Every 7 days unless the tenant config is stricter',
    ownerHint: 'Area owner or environmental technician',
    notes: 'The module should preserve each inspection, corrective action, photo, and late/missed inspection reason.',
  },
  {
    id: 'manifest-return-tracking',
    title: 'Manifest return and exception tracking',
    cadence: 'Per shipment',
    dueRule: 'Track signed copies, returns, corrections, and exception thresholds from shipment date',
    ownerHint: 'Shipping coordinator or environmental manager',
    notes: 'Use configurable 30/45/60 day checkpoints by generator category, state, and manifest type. California non-electronic copy workflows need special attention.',
  },
]

export const HAZARDOUS_WASTE_DOCUMENT_PACKETS: HazardousWasteDocumentPacket[] = [
  {
    id: 'uniform-manifest',
    title: 'Uniform Hazardous Waste Manifest data package',
    officialSource: 'EPA Form 8700-22 and continuation sheet 8700-22A',
    systemOutput: 'Draft worksheet/PDF packet with generator, transporter, TSDF, DOT description, waste codes, container counts, emergency phone, and signatures checklist.',
    submissionMode: 'api_candidate',
    caution: 'Shipping manifests must use EPA-approved registered printer paper or official e-Manifest workflows; a normal generated PDF is a preparation record unless produced through an approved workflow.',
  },
  {
    id: 'site-id',
    title: 'Site Identification Form preparation record',
    officialSource: 'EPA Form 8700-12',
    systemOutput: 'Prefilled review packet for EPA ID, generator category, contacts, regulated activity, and handler data.',
    submissionMode: 'pdf_record',
    caution: 'Final filing path depends on EPA/state requirements and RCRAInfo permissions.',
  },
  {
    id: 'biennial-report',
    title: 'Biennial Hazardous Waste Report support export',
    officialSource: 'EPA Form 8700-13 A/B',
    systemOutput: 'Report-year rollup by EPA ID, waste stream, manifest, quantity, management method, and receiving facility.',
    submissionMode: 'portal_upload',
    caution: 'The report owner must validate current EPA and state instructions before submission.',
  },
  {
    id: 'cers-hmbp',
    title: 'CERS-ready HMBP inventory and emergency plan packet',
    officialSource: 'CalEPA CERS business portal templates and local CUPA instructions',
    systemOutput: 'Portal-ready inventory support data, emergency contacts, facility map attachment checklist, and plan review PDF.',
    submissionMode: 'portal_upload',
    caution: 'Do not present this as automatic CERS submission; public business API access is not the same as agency EDT exchange.',
  },
  {
    id: 'inspection-binder',
    title: 'CUPA/DTSC inspection binder',
    officialSource: 'Tenant records generated from inspections, labels, determinations, training, shipments, and corrective actions',
    systemOutput: 'Date-range PDF bundle with table of contents, record hashes, photos, late items, and open corrective actions.',
    submissionMode: 'pdf_record',
    caution: 'Use as an inspection and internal audit record; it does not replace required portal submissions.',
  },
]

export function createEmptyHazardousWasteFieldDraft(areaType: HazardousWasteAreaType = 'satellite_accumulation'): HazardousWasteFieldDraft {
  const now = new Date().toISOString()
  return {
    id: `hw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    areaType,
    locationName: '',
    containerLabel: '',
    wasteDescription: '',
    observations: '',
    checkedIds: [],
    flaggedIds: [],
    updatedAt: now,
  }
}

export function getChecksForArea(areaType: HazardousWasteAreaType): HazardousWasteFieldCheck[] {
  return HAZARDOUS_WASTE_FIELD_CHECKS.filter(check => check.areaTypes.includes(areaType))
}

export function summarizeHazardousWasteDraft(draft: HazardousWasteFieldDraft): {
  total: number
  checked: number
  flaggedCritical: number
  readyForReview: boolean
} {
  const checks = getChecksForArea(draft.areaType)
  const checked = checks.filter(check => draft.checkedIds.includes(check.id)).length
  const flaggedCritical = checks.filter(check => check.critical && draft.flaggedIds.includes(check.id)).length
  // readyForReview is meaningful only when checks actually apply to the area.
  // An area type with no checks (or a future config where every check is
  // filtered out) must NOT report ready-for-review vacuously — that would
  // mislead a supervisor reading the draft list.
  return {
    total: checks.length,
    checked,
    flaggedCritical,
    readyForReview: checks.length > 0 && checked === checks.length && flaggedCritical === 0,
  }
}

// ── Persisted row types ─────────────────────────────────────────────────────
//
// Mirror the schema in migration 142. Kept here (not in apps/web) so the
// Expo app can share them once mobile sync lands.

export interface HazardousWasteAreaRow {
  id:                   string
  tenant_id:            string
  name:                 string
  area_type:            HazardousWasteAreaType
  location_notes:       string | null
  weekly_cadence_days:  number
  archived_at:          string | null
  created_at:           string
  updated_at:           string
  created_by:           string | null
  updated_by:           string | null
}

export type HazardousWasteFindingStatus = 'pass' | 'fail' | 'na'

export interface HazardousWasteInspectionFinding {
  check_id:          string
  status:            HazardousWasteFindingStatus
  note:              string | null
  flagged_critical:  boolean
}

export interface HazardousWasteInspectionRow {
  id:                  string
  tenant_id:           string
  area_id:             string
  area_type:           HazardousWasteAreaType
  inspected_by:        string | null
  inspected_at:        string
  container_label:     string | null
  waste_description:   string | null
  observations:        string | null
  findings:            HazardousWasteInspectionFinding[]
  total_checks:        number
  passing_checks:      number
  critical_failures:   number
  status:              'draft' | 'submitted'
  created_at:          string
  updated_at:          string
  created_by:          string | null
  updated_by:          string | null
}

// Translate an in-progress field draft (the catalog-of-ids shape used by
// the mobile screen) into the persisted findings array. Anything in
// `flaggedIds` is a fail; anything in `checkedIds` not also flagged is a
// pass; everything else is recorded as `na` so the row preserves the
// full checklist surface area and the binder PDF can show "skipped" items.
export function findingsFromDraft(draft: HazardousWasteFieldDraft): HazardousWasteInspectionFinding[] {
  const checks = getChecksForArea(draft.areaType)
  const flagged = new Set(draft.flaggedIds)
  const checked = new Set(draft.checkedIds)
  return checks.map(check => {
    let status: HazardousWasteFindingStatus
    if (flagged.has(check.id)) status = 'fail'
    else if (checked.has(check.id)) status = 'pass'
    else status = 'na'
    return {
      check_id:         check.id,
      status,
      note:             null,
      flagged_critical: check.critical,
    }
  })
}

// Days since the most recent inspection of an area. Returns null when
// the area has never been inspected so the caller can render an
// explicit "never inspected" state instead of a misleading large number.
export function daysSinceLastInspection(
  lastInspectedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!lastInspectedAt) return null
  const last = new Date(lastInspectedAt).getTime()
  if (!Number.isFinite(last)) return null
  return Math.floor((now.getTime() - last) / 86_400_000)
}

// True when the area's last inspection is older than its cadence (or
// it has never been inspected). Used by the dashboard to count "due"
// areas without re-querying the inspections table.
export function isAreaOverdue(
  area: Pick<HazardousWasteAreaRow, 'weekly_cadence_days'>,
  lastInspectedAt: string | null,
  now: Date = new Date(),
): boolean {
  const days = daysSinceLastInspection(lastInspectedAt, now)
  if (days === null) return true
  return days >= area.weekly_cadence_days
}

// ── Accumulation & calendar helpers ───────────────────────────────────────
// Pure date utilities. Inputs are accepted as Date or ISO string; outputs
// are deterministic given the same inputs (no `new Date()` inside the
// helpers themselves — callers pass `now` explicitly). All math is done
// in UTC to avoid DST traps; consumers should format for display in the
// site's local zone.

/**
 * RCRA generator categories used for accumulation-time limits.
 * `lqg` = Large Quantity Generator (90-day baseline).
 * `sqg` = Small Quantity Generator (180-day baseline; 270 days if the
 *         designated TSDF is &gt; 200 miles from the site).
 * `vsqg` = Very Small Quantity Generator (no federal time limit; consult
 *          state rules).
 */
export type RcraGeneratorCategory = 'lqg' | 'sqg' | 'vsqg'

export type ContainerAgeStatus = 'unknown' | 'ok' | 'approaching' | 'over_limit'

export interface ContainerAgeOptions {
  /** Generator category that determines the baseline limit. */
  category: RcraGeneratorCategory
  /** SQG only: set true when the TSDF is &gt; 200 miles, extending to 270 days. */
  longHaul?: boolean
  /** Day count before the limit that flips status to `approaching`. Default 14. */
  warnDaysBeforeLimit?: number
}

export interface ContainerAgeResult {
  /** Whole days between startedAt and now (UTC, floored). null when unknown. */
  ageDays: number | null
  /** Federally applicable limit, in days. null for VSQG (no federal limit). */
  limitDays: number | null
  /** Days remaining until the limit. Negative when over. null when unknown. */
  daysUntilLimit: number | null
  status: ContainerAgeStatus
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function baselineLimitDays(opts: ContainerAgeOptions): number | null {
  if (opts.category === 'lqg') return 90
  if (opts.category === 'sqg') return opts.longHaul ? 270 : 180
  return null // vsqg: no federal limit
}

/**
 * Compute the age status of a central-accumulation container.
 *
 * Edge cases handled:
 * - `startedAt` null/invalid → ageDays:null, status:'unknown'
 * - `startedAt` in the future (data-entry error) → ageDays:0, status:'unknown'
 * - `category === 'vsqg'` → limit:null, status:'unknown' (federal does not gate)
 * - DST/TZ → math is in UTC ms; status flips on day boundaries, not hours
 */
export function containerAgeStatus(
  startedAt: Date | string | null | undefined,
  now: Date | string,
  opts: ContainerAgeOptions,
): ContainerAgeResult {
  const start = toDate(startedAt)
  const nowDate = toDate(now)
  const limit = baselineLimitDays(opts)

  if (!start || !nowDate) {
    return { ageDays: null, limitDays: limit, daysUntilLimit: null, status: 'unknown' }
  }

  const diffMs = nowDate.getTime() - start.getTime()
  if (diffMs < 0) {
    // Future start date — almost always a data-entry mistake. Surface as
    // unknown so the UI prompts the user to correct it.
    return { ageDays: 0, limitDays: limit, daysUntilLimit: null, status: 'unknown' }
  }

  const ageDays = Math.floor(diffMs / MS_PER_DAY)
  if (limit == null) {
    return { ageDays, limitDays: null, daysUntilLimit: null, status: 'unknown' }
  }

  const daysUntilLimit = limit - ageDays
  const warnWindow = Math.max(0, opts.warnDaysBeforeLimit ?? 14)
  let status: ContainerAgeStatus
  if (ageDays > limit) status = 'over_limit'
  else if (daysUntilLimit <= warnWindow) status = 'approaching'
  else status = 'ok'
  return { ageDays, limitDays: limit, daysUntilLimit, status }
}

// ── Persisted records (migration 140) ────────────────────────────────────
// Row shapes for the tables introduced in migration 140. The hazardous-
// waste module now stores actual generator data per tenant — streams
// (process master records) and containers (physical instances). These
// types mirror the DB columns exactly so server routes and client
// components share one source of truth.

export const HAZARDOUS_WASTE_STREAM_STATUSES = ['draft', 'active', 'archived'] as const
export type HazardousWasteStreamStatus = typeof HAZARDOUS_WASTE_STREAM_STATUSES[number]

export const HAZARDOUS_WASTE_PHYSICAL_STATES = ['solid', 'liquid', 'gas', 'sludge', 'mixed'] as const
export type HazardousWastePhysicalState = typeof HAZARDOUS_WASTE_PHYSICAL_STATES[number]

export const HAZARDOUS_WASTE_CONTAINER_STATUSES = ['open', 'closed', 'in_shipment', 'disposed'] as const
export type HazardousWasteContainerStatus = typeof HAZARDOUS_WASTE_CONTAINER_STATUSES[number]

export const HAZARDOUS_WASTE_VOLUME_UNITS = [
  'gallons', 'liters', 'quarts', 'pounds', 'kilograms', 'grams',
] as const
export type HazardousWasteVolumeUnit = typeof HAZARDOUS_WASTE_VOLUME_UNITS[number]

export interface HazardousWasteStreamRow {
  id:                   string
  tenant_id:            string
  name:                 string
  generating_process:   string | null
  description:          string | null
  physical_state:       HazardousWastePhysicalState | null
  hazards:              string[]
  waste_codes:          string[]
  generator_category:   RcraGeneratorCategory
  long_haul:            boolean
  determination_basis:  string | null
  status:               HazardousWasteStreamStatus
  owner_user_id:        string | null
  review_due_date:      string | null
  notes:                string | null
  created_at:           string
  created_by:           string | null
  updated_at:           string
  updated_by:           string | null
  archived_at:          string | null
}

export interface HazardousWasteContainerRow {
  id:                       string
  tenant_id:                string
  stream_id:                string
  label:                    string
  area_type:                HazardousWasteAreaType
  area_location:            string | null
  accumulation_started_at:  string | null
  volume_quantity:          number | null
  volume_unit:              HazardousWasteVolumeUnit | null
  status:                   HazardousWasteContainerStatus
  notes:                    string | null
  created_at:               string
  created_by:               string | null
  updated_at:               string
  updated_by:               string | null
  archived_at:              string | null
}

export interface HazardousWasteStreamInput {
  name:                 string
  generating_process:   string | null
  description:          string | null
  physical_state:       HazardousWastePhysicalState | null
  hazards:              string[]
  waste_codes:          string[]
  generator_category:   RcraGeneratorCategory
  long_haul:            boolean
  determination_basis:  string | null
  status:               HazardousWasteStreamStatus
  owner_user_id:        string | null
  review_due_date:      string | null
  notes:                string | null
}

export interface HazardousWasteContainerInput {
  stream_id:                string
  label:                    string
  area_type:                HazardousWasteAreaType
  area_location:            string | null
  accumulation_started_at:  string | null
  volume_quantity:          number | null
  volume_unit:              HazardousWasteVolumeUnit | null
  status:                   HazardousWasteContainerStatus
  notes:                    string | null
}

export interface FieldError { field: string; message: string }

/**
 * Validate a HazardousWasteStreamInput. Returns an empty array when the
 * input is acceptable. Validation is intentionally minimal — it enforces
 * what the DB check constraints enforce, plus name/notes length caps the
 * UI should also enforce. Trim before calling.
 */
export function validateHazardousWasteStreamInput(input: HazardousWasteStreamInput): FieldError[] {
  const errors: FieldError[] = []
  const name = input.name.trim()
  if (name.length < 1) errors.push({ field: 'name', message: 'Name is required' })
  if (name.length > 200) errors.push({ field: 'name', message: 'Name must be 200 characters or fewer' })
  if (input.description && input.description.length > 4000) {
    errors.push({ field: 'description', message: 'Description must be 4000 characters or fewer' })
  }
  if (input.generating_process && input.generating_process.length > 500) {
    errors.push({ field: 'generating_process', message: 'Generating process must be 500 characters or fewer' })
  }
  if (!HAZARDOUS_WASTE_STREAM_STATUSES.includes(input.status)) {
    errors.push({ field: 'status', message: 'Invalid status' })
  }
  if (input.physical_state && !HAZARDOUS_WASTE_PHYSICAL_STATES.includes(input.physical_state)) {
    errors.push({ field: 'physical_state', message: 'Invalid physical state' })
  }
  if (!(['lqg', 'sqg', 'vsqg'] as RcraGeneratorCategory[]).includes(input.generator_category)) {
    errors.push({ field: 'generator_category', message: 'Invalid generator category' })
  }
  return errors
}

/**
 * Validate a HazardousWasteContainerInput.
 */
export function validateHazardousWasteContainerInput(input: HazardousWasteContainerInput): FieldError[] {
  const errors: FieldError[] = []
  const label = input.label.trim()
  if (label.length < 1) errors.push({ field: 'label', message: 'Label is required' })
  if (label.length > 120) errors.push({ field: 'label', message: 'Label must be 120 characters or fewer' })
  if (!input.stream_id) errors.push({ field: 'stream_id', message: 'Stream is required' })
  const validAreas: HazardousWasteAreaType[] = [
    'satellite_accumulation', 'central_accumulation',
    'universal_waste', 'used_oil', 'inspection_only',
  ]
  if (!validAreas.includes(input.area_type)) {
    errors.push({ field: 'area_type', message: 'Invalid area type' })
  }
  if (!HAZARDOUS_WASTE_CONTAINER_STATUSES.includes(input.status)) {
    errors.push({ field: 'status', message: 'Invalid status' })
  }
  if (input.volume_unit && !HAZARDOUS_WASTE_VOLUME_UNITS.includes(input.volume_unit)) {
    errors.push({ field: 'volume_unit', message: 'Invalid volume unit' })
  }
  if (input.volume_quantity != null && (Number.isNaN(input.volume_quantity) || input.volume_quantity < 0)) {
    errors.push({ field: 'volume_quantity', message: 'Volume quantity must be a non-negative number' })
  }
  if (input.accumulation_started_at) {
    const d = new Date(input.accumulation_started_at)
    if (Number.isNaN(d.getTime())) {
      errors.push({ field: 'accumulation_started_at', message: 'Invalid date' })
    }
  }
  return errors
}

/**
 * Compute the age status of a persisted container row using its stream's
 * generator_category + long_haul. Wrapper around containerAgeStatus that
 * removes the join boilerplate at every call site.
 */
export function ageStatusForContainer(
  container: Pick<HazardousWasteContainerRow, 'accumulation_started_at' | 'status'>,
  stream: Pick<HazardousWasteStreamRow, 'generator_category' | 'long_haul'>,
  now: Date | string,
): ContainerAgeResult {
  // Disposed and in-shipment containers no longer accumulate.
  if (container.status === 'disposed' || container.status === 'in_shipment') {
    return { ageDays: null, limitDays: null, daysUntilLimit: null, status: 'unknown' }
  }
  return containerAgeStatus(container.accumulation_started_at, now, {
    category: stream.generator_category,
    longHaul: stream.long_haul,
  })
}

/**
 * Compute the next due date for the federal Biennial Hazardous Waste
 * Report. Per 40 CFR 262.41, the report is filed by March 1 of every
 * even-numbered year for waste activity in the preceding odd-numbered
 * year (e.g. 2027 activity reported by 2028-03-01).
 *
 * Returns a UTC Date set to midnight on March 1 of the next even year
 * &gt;= `now`. If `now` is already past March 1 of an even year, the
 * function rolls forward to the next even-year cycle (two years later).
 *
 * Examples:
 *   now=2026-01-15 → 2026-03-01 (covers report year 2025)
 *   now=2026-03-01 → 2026-03-01 (today is the deadline)
 *   now=2026-03-02 → 2028-03-01 (next cycle)
 *   now=2027-08-01 → 2028-03-01 (mid-odd-year — next even March 1)
 */
export function nextBiennialDueDate(now: Date | string): Date {
  const n = toDate(now)
  if (!n) throw new Error('nextBiennialDueDate: invalid `now`')

  const year = n.getUTCFullYear()
  const month = n.getUTCMonth() // 0-indexed; March = 2
  const day = n.getUTCDate()

  // Find candidate even year: round current year up to the next even year.
  let candidate = year + (year % 2 === 0 ? 0 : 1)
  // If we're already past March 1 of an even year, jump to the next even cycle.
  if (candidate === year && (month > 2 || (month === 2 && day > 1))) {
    candidate += 2
  }
  return new Date(Date.UTC(candidate, 2, 1, 0, 0, 0, 0))
}
