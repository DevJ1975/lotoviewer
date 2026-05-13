export type HazardousWasteAreaType =
  | 'satellite_accumulation'
  | 'central_accumulation'
  | 'universal_waste'
  | 'used_oil'
  | 'inspection_only'

export type HazardousWasteGeneratorCategory = 'unknown' | 'vsqg' | 'sqg' | 'lqg'

export type HazardousWastePhysicalState = 'unknown' | 'solid' | 'liquid' | 'sludge' | 'gas' | 'mixed'

export type HazardousWasteDeterminationStatus = 'draft' | 'pending_review' | 'approved' | 'archived'

export type HazardousWasteContainerStatus =
  | 'accumulating'
  | 'ready_for_pickup'
  | 'shipped'
  | 'closed'
  | 'archived'

export type HazardousWasteInspectionResult = 'pass' | 'issues_found' | 'blocked'

export type HazardousWasteActionStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled'

export type HazardousWasteActionPriority = 'normal' | 'high' | 'critical'

export type HazardousWasteShipmentStatus = 'planned' | 'shipped' | 'return_copy_due' | 'closed' | 'cancelled'

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

export interface HazardousWasteAreaInspectionState {
  active: boolean
  inspectionCadenceDays: number
  lastInspectedAt: string | null
}

export const HAZARDOUS_WASTE_AREA_LABEL: Record<HazardousWasteAreaType, string> = {
  satellite_accumulation: 'Satellite accumulation',
  central_accumulation: 'Central accumulation',
  universal_waste: 'Universal waste',
  used_oil: 'Used oil',
  inspection_only: 'Inspection only',
}

export const HAZARDOUS_WASTE_GENERATOR_CATEGORY_LABEL: Record<HazardousWasteGeneratorCategory, string> = {
  unknown: 'Unknown',
  vsqg: 'Very small quantity generator',
  sqg: 'Small quantity generator',
  lqg: 'Large quantity generator',
}

export const HAZARDOUS_WASTE_PHYSICAL_STATE_LABEL: Record<HazardousWastePhysicalState, string> = {
  unknown: 'Unknown',
  solid: 'Solid',
  liquid: 'Liquid',
  sludge: 'Sludge',
  gas: 'Gas',
  mixed: 'Mixed',
}

export const HAZARDOUS_WASTE_DETERMINATION_STATUS_LABEL: Record<HazardousWasteDeterminationStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  approved: 'Approved',
  archived: 'Archived',
}

export const HAZARDOUS_WASTE_CONTAINER_STATUS_LABEL: Record<HazardousWasteContainerStatus, string> = {
  accumulating: 'Accumulating',
  ready_for_pickup: 'Ready for pickup',
  shipped: 'Shipped',
  closed: 'Closed',
  archived: 'Archived',
}

export const HAZARDOUS_WASTE_INSPECTION_RESULT_LABEL: Record<HazardousWasteInspectionResult, string> = {
  pass: 'Pass',
  issues_found: 'Issues found',
  blocked: 'Blocked',
}

export const HAZARDOUS_WASTE_ACTION_STATUS_LABEL: Record<HazardousWasteActionStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
}

export const HAZARDOUS_WASTE_ACTION_PRIORITY_LABEL: Record<HazardousWasteActionPriority, string> = {
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
}

export const HAZARDOUS_WASTE_SHIPMENT_STATUS_LABEL: Record<HazardousWasteShipmentStatus, string> = {
  planned: 'Planned',
  shipped: 'Shipped',
  return_copy_due: 'Return copy due',
  closed: 'Closed',
  cancelled: 'Cancelled',
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
  return {
    total: checks.length,
    checked,
    flaggedCritical,
    readyForReview: checked === checks.length && flaggedCritical === 0,
  }
}

export function parseHazardousWasteDelimitedList(value: string): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const raw of value.split(',')) {
    const item = raw.trim()
    if (!item || seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    items.push(item)
  }
  return items
}

export function computeHazardousWasteInspectionResult(args: {
  areaType: HazardousWasteAreaType
  checkedIds: readonly string[]
  flaggedIds: readonly string[]
}): {
  result: HazardousWasteInspectionResult
  total: number
  checked: number
  flagged: number
  flaggedCritical: number
} {
  const checks = getChecksForArea(args.areaType)
  const allowed = new Set(checks.map(check => check.id))
  const checked = checks.filter(check => args.checkedIds.includes(check.id)).length
  const flaggedChecks = checks.filter(check => args.flaggedIds.includes(check.id) && allowed.has(check.id))
  const flaggedCritical = flaggedChecks.filter(check => check.critical).length

  let result: HazardousWasteInspectionResult = 'pass'
  if (flaggedCritical > 0) result = 'blocked'
  else if (flaggedChecks.length > 0 || checked < checks.length) result = 'issues_found'

  return {
    result,
    total: checks.length,
    checked,
    flagged: flaggedChecks.length,
    flaggedCritical,
  }
}

export function isHazardousWasteAreaInspectionDue(
  area: HazardousWasteAreaInspectionState,
  asOf: Date = new Date(),
): boolean {
  if (!area.active) return false
  if (!area.lastInspectedAt) return true
  const lastInspected = new Date(area.lastInspectedAt)
  if (Number.isNaN(lastInspected.getTime())) return true
  const cadenceMs = area.inspectionCadenceDays * 24 * 60 * 60 * 1000
  return lastInspected.getTime() + cadenceMs <= asOf.getTime()
}
