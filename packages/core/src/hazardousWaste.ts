import {
  GHS_PICTOGRAMS,
  GHS_SIGNAL_WORDS,
  type GhsPictogram,
  type GhsSignalWord,
} from './chemicals'
import {
  DOT_PACKING_GROUPS,
  NFPA_SPECIAL_SYMBOLS,
  isValidDotHazardClass,
  isValidNfpaRating,
  type DotPackingGroup,
} from './hazardSymbols'

export const HAZARDOUS_WASTE_AREA_TYPES = [
  'satellite_accumulation',
  'central_accumulation',
  'universal_waste',
  'used_oil',
  'inspection_only',
] as const
export type HazardousWasteAreaType = (typeof HAZARDOUS_WASTE_AREA_TYPES)[number]

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
  {
    id: 'rcra-personnel-training',
    title: 'RCRA personnel hazardous waste training',
    cadence: 'Annually (per employee)',
    dueRule: 'LQG: within 6 months of assignment, then annually (40 CFR 262.17(a)(7)); SQG personnel must be thoroughly familiar (262.16(b)(9)(iii))',
    ownerHint: 'Environmental manager with Training Records',
    notes: 'Anniversary-based per employee, not a single facility date. Distinct from Cal/OSHA HAZWOPER training. Track in the Training Records module.',
  },
  {
    id: 'hazwoper-refresher',
    title: 'Cal/OSHA HAZWOPER 8-hour refresher',
    cadence: 'Annually (per worker, if HAZWOPER applies)',
    dueRule: 'Within 12 months of the prior HAZWOPER training (8 CCR 5192(e)(8))',
    ownerHint: 'Safety manager',
    notes: 'Only for workers doing HAZWOPER-covered work (TSD, corrective action/cleanup, or emergency response). Routine generator accumulation is not HAZWOPER — confirm applicability first.',
  },
  {
    id: 'lqg-contingency-plan-review',
    title: 'LQG contingency plan review + Quick Reference Guide',
    cadence: 'On amendment; review at least annually',
    dueRule: 'Maintain the contingency plan and submit/refresh the Quick Reference Guide to local emergency responders whenever it is amended (40 CFR 262 Subpart M, 262.262)',
    ownerHint: 'Emergency coordinator or EHS manager',
    notes: 'LQG only. The Quick Reference Guide goes to local fire/LEPC responders. Re-submit on any amendment.',
  },
  {
    id: 'ldr-determination',
    title: 'Land Disposal Restriction determination + one-time notice',
    cadence: 'Per waste stream (one-time, re-issue on change)',
    dueRule: 'Make the LDR determination and send the one-time LDR notification/certification to the TSDF with the first shipment of each restricted stream (40 CFR 268.7)',
    ownerHint: 'Environmental manager',
    notes: 'A frequent audit finding. Re-issue if the waste or treatment standard changes. Keep a copy in the shipment record.',
  },
  {
    id: 'ca-epa-id-verification',
    title: 'California EPA ID verification and generator fee',
    cadence: 'Annually (California)',
    dueRule: 'Confirm current DTSC EPA ID verification and the hazardous waste generation/handling fee cycle for the facility',
    ownerHint: 'California hazardous waste program owner',
    notes: 'California-specific; cycle and amounts are set by DTSC/CDTFA. Confirm current instructions — defaults are only defaults.',
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
    id: 'ldr-notice',
    title: 'Land Disposal Restriction notice / certification',
    officialSource: '40 CFR 268.7(a)',
    systemOutput: 'One-time LDR notice per restricted stream: EPA + California waste codes, generator EPA ID, manifest tracking number, and the LDR certification statement.',
    submissionMode: 'pdf_record',
    caution: 'The generator must send a certified notice to the receiving facility with the first shipment of each restricted stream and re-issue it when the waste or treatment standard changes. This packet is a preparation record.',
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
  photo_urls:           string[]
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

/**
 * Regulatory jurisdiction whose rules govern a waste stream. The module is
 * California-forward, so `california` is the default everywhere a jurisdiction
 * is not explicitly known.
 *
 * The decisive difference for accumulation: California adopted the federal
 * Generator Improvements Rule but did NOT adopt the federal VSQG conditional
 * exemption — a California VSQG must meet Small Quantity Generator requirements,
 * including the SQG accumulation-time limit (22 CCR 66262.16). Under federal
 * rules a VSQG has no accumulation-time limit (40 CFR 262.14).
 */
export type WasteJurisdiction = 'federal' | 'california'

export const WASTE_JURISDICTIONS = ['federal', 'california'] as const

/**
 * Acute-hazard classification of a waste stream. This drives the satellite
 * accumulation cap (40 CFR 262.15) and the generator-category acute thresholds.
 *
 * - `none`                — ordinary (non-acute) hazardous waste.
 * - `acute`               — federal acute hazardous waste (the P-list and the
 *                           acute F-wastes); SAA cap is 1 qt liquid / 1 kg solid.
 * - `extremely_hazardous` — California "extremely hazardous waste" (22 CCR
 *                           66261.110/.113); treated like acute for the SAA cap.
 */
export type AcuteClass = 'none' | 'acute' | 'extremely_hazardous'

export const ACUTE_CLASSES = ['none', 'acute', 'extremely_hazardous'] as const

/** True when the class is acute-equivalent for the 1 qt / 1 kg satellite cap. */
export function isAcuteEquivalent(acuteClass: AcuteClass): boolean {
  return acuteClass === 'acute' || acuteClass === 'extremely_hazardous'
}

// `not_time_limited` is distinct from `unknown`: the container HAS a start
// date, but its area type is not governed by a dated accumulation clock
// (satellite accumulation below the volume cap, used oil, inspection-only).
// `unknown` means "we can't compute the clock" (no/invalid/future date, or a
// federal VSQG with no federal time limit).
export type ContainerAgeStatus = 'unknown' | 'ok' | 'approaching' | 'over_limit' | 'not_time_limited'

export interface ContainerAgeOptions {
  /** Generator category that determines the baseline limit. */
  category: RcraGeneratorCategory
  /** SQG only: set true when the TSDF is &gt; 200 miles, extending to 270 days. */
  longHaul?: boolean
  /**
   * Jurisdiction whose accumulation rules apply. Defaults to `federal` so the
   * primitive's behavior is unchanged for callers that don't specify it.
   * Under `california`, a VSQG is held to the SQG limit (22 CCR 66262.16).
   */
  jurisdiction?: WasteJurisdiction
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
  // vsqg: no FEDERAL accumulation-time limit, but California holds a VSQG to
  // the SQG limit (it did not adopt the federal VSQG exemption).
  if (opts.jurisdiction === 'california') return opts.longHaul ? 270 : 180
  return null
}

/**
 * Core aging math shared by every accumulation clock. Given a start date and
 * an explicit limit (in days), classify the container as ok / approaching /
 * over_limit. A `null` limit means "no time clock applies" and yields
 * `unknown` (the caller decides whether that is a federal-VSQG or some other
 * no-limit case).
 *
 * Edge cases handled once, here, for all clocks:
 * - `startedAt` null/invalid → ageDays:null, status:'unknown'
 * - `startedAt` in the future (data-entry error) → ageDays:0, status:'unknown'
 * - DST/TZ → math is in UTC ms; status flips on day boundaries, not hours
 */
function ageStatusAgainstLimit(
  startedAt: Date | string | null | undefined,
  now: Date | string,
  limitDays: number | null,
  warnDaysBeforeLimit = 14,
): ContainerAgeResult {
  const start = toDate(startedAt)
  const nowDate = toDate(now)

  if (!start || !nowDate) {
    return { ageDays: null, limitDays, daysUntilLimit: null, status: 'unknown' }
  }

  const diffMs = nowDate.getTime() - start.getTime()
  if (diffMs < 0) {
    // Future start date — almost always a data-entry mistake. Surface as
    // unknown so the UI prompts the user to correct it.
    return { ageDays: 0, limitDays, daysUntilLimit: null, status: 'unknown' }
  }

  const ageDays = Math.floor(diffMs / MS_PER_DAY)
  if (limitDays == null) {
    return { ageDays, limitDays: null, daysUntilLimit: null, status: 'unknown' }
  }

  const daysUntilLimit = limitDays - ageDays
  const warnWindow = Math.max(0, warnDaysBeforeLimit)
  let status: ContainerAgeStatus
  if (ageDays > limitDays) status = 'over_limit'
  else if (daysUntilLimit <= warnWindow) status = 'approaching'
  else status = 'ok'
  return { ageDays, limitDays, daysUntilLimit, status }
}

/**
 * Compute the age status of a CENTRAL-accumulation container against the
 * federal generator-category clock (90 / 180 / 270 days). This is the right
 * clock only for central accumulation areas — satellite, universal waste, and
 * used oil are governed by different rules (see `ageStatusForContainer`).
 *
 * - `category === 'vsqg'` → limit:null, status:'unknown' (no FEDERAL time
 *   limit; note California does not adopt the VSQG exemption — see the
 *   hazardous-waste regulatory evaluation doc).
 */
export function containerAgeStatus(
  startedAt: Date | string | null | undefined,
  now: Date | string,
  opts: ContainerAgeOptions,
): ContainerAgeResult {
  return ageStatusAgainstLimit(startedAt, now, baselineLimitDays(opts), opts.warnDaysBeforeLimit ?? 14)
}

/**
 * Federal + California universal-waste accumulation limit: one year from the
 * date the universal waste was generated or received (40 CFR 273.15 / 273.35;
 * 22 CCR 66273.15 / 66273.35). Independent of the RCRA generator category.
 */
export const UNIVERSAL_WASTE_LIMIT_DAYS = 365

/**
 * Compute the age status of a universal-waste container against the 1-year
 * accumulation limit. Defaults to a 30-day warning window because a yearly
 * clock deserves more lead time than a 90-day drum.
 */
export function universalWasteAgeStatus(
  startedAt: Date | string | null | undefined,
  now: Date | string,
  warnDaysBeforeLimit = 30,
): ContainerAgeResult {
  return ageStatusAgainstLimit(startedAt, now, UNIVERSAL_WASTE_LIMIT_DAYS, warnDaysBeforeLimit)
}

/**
 * Universal-waste categories. The federal program (40 CFR 273) covers five;
 * California (22 CCR 66273.1) is broader — it adds electronic devices, CRTs,
 * CRT glass, and PV modules. The handler requirements differ by category, so
 * the catalog is keyed by jurisdiction.
 */
export type UniversalWasteCategory =
  | 'batteries'
  | 'pesticides'
  | 'mercury_containing_equipment'
  | 'lamps'
  | 'aerosol_cans'
  | 'electronic_devices'
  | 'crts'
  | 'crt_glass'
  | 'pv_modules'

export const UNIVERSAL_WASTE_CATEGORY_LABEL: Record<UniversalWasteCategory, string> = {
  batteries:                    'Batteries',
  pesticides:                   'Pesticides',
  mercury_containing_equipment: 'Mercury-containing equipment',
  lamps:                        'Lamps',
  aerosol_cans:                 'Aerosol cans',
  electronic_devices:           'Electronic devices',
  crts:                         'Cathode ray tubes (CRTs)',
  crt_glass:                    'CRT glass',
  pv_modules:                   'Photovoltaic (solar) modules',
}

const FEDERAL_UNIVERSAL_WASTE: UniversalWasteCategory[] = [
  'batteries', 'pesticides', 'mercury_containing_equipment', 'lamps', 'aerosol_cans',
]

const CALIFORNIA_UNIVERSAL_WASTE: UniversalWasteCategory[] = [
  'batteries', 'electronic_devices', 'mercury_containing_equipment', 'lamps',
  'crts', 'crt_glass', 'aerosol_cans', 'pv_modules',
]

/** Universal-waste categories recognized in the given jurisdiction. */
export function universalWasteCategories(jurisdiction: WasteJurisdiction): UniversalWasteCategory[] {
  return jurisdiction === 'california' ? CALIFORNIA_UNIVERSAL_WASTE : FEDERAL_UNIVERSAL_WASTE
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
  jurisdiction:         WasteJurisdiction
  acute_class:          AcuteClass
  long_haul:            boolean
  determination_basis:  string | null
  // Land Disposal Restrictions (40 CFR 268.7): a one-time LDR notice/
  // certification accompanies the first shipment of each restricted stream.
  ldr_restricted:       boolean
  ldr_notice_sent:      boolean
  ldr_notice_date:      string | null
  status:               HazardousWasteStreamStatus
  owner_user_id:        string | null
  review_due_date:      string | null
  notes:                string | null
  // Hazard-communication symbols (migration 239). Mirror chemical_products:
  // GHS pictograms + signal word, NFPA 704 ratings, and DOT placard fields.
  // dot_hazard_class stays a plain string (not the DotHazardClass union) so a
  // legacy or partial value round-trips through the row rather than being
  // dropped — display components validate before rendering.
  ghs_pictograms:           GhsPictogram[]
  ghs_signal_word:          GhsSignalWord | null
  nfpa_health:              number | null
  nfpa_flammability:        number | null
  nfpa_instability:         number | null
  nfpa_special:             string | null
  dot_un_number:            string | null
  dot_hazard_class:         string | null
  dot_packing_group:        DotPackingGroup | null
  dot_proper_shipping_name: string | null
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
  jurisdiction:         WasteJurisdiction
  acute_class:          AcuteClass
  long_haul:            boolean
  determination_basis:  string | null
  ldr_restricted:       boolean
  ldr_notice_sent:      boolean
  ldr_notice_date:      string | null
  status:               HazardousWasteStreamStatus
  owner_user_id:        string | null
  review_due_date:      string | null
  notes:                string | null
  ghs_pictograms:           GhsPictogram[]
  ghs_signal_word:          GhsSignalWord | null
  nfpa_health:              number | null
  nfpa_flammability:        number | null
  nfpa_instability:         number | null
  nfpa_special:             string | null
  dot_un_number:            string | null
  dot_hazard_class:         string | null
  dot_packing_group:        DotPackingGroup | null
  dot_proper_shipping_name: string | null
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
  // Both columns are `not null default` in migration 272, so omitting them is
  // valid — the database supplies 'california' / 'none'. Only a value that is
  // present and wrong is an error; rejecting absence would break every caller
  // that predates these fields, including the symbol-only update path.
  if (input.jurisdiction !== undefined && !WASTE_JURISDICTIONS.includes(input.jurisdiction)) {
    errors.push({ field: 'jurisdiction', message: 'Invalid jurisdiction' })
  }
  if (input.acute_class !== undefined && !ACUTE_CLASSES.includes(input.acute_class)) {
    errors.push({ field: 'acute_class', message: 'Invalid acute class' })
  }
  if (input.ldr_notice_date) {
    const d = new Date(input.ldr_notice_date)
    if (Number.isNaN(d.getTime())) {
      errors.push({ field: 'ldr_notice_date', message: 'Invalid LDR notice date' })
    }
  }
  errors.push(...validateHazardSymbolFields(input))
  return errors
}

/**
 * Validate the hazard-communication symbol fields shared by streams and
 * (one day) other symbol-carrying records. Mirrors the chemical_products
 * check constraints from migration 239: GHS codes against the catalog,
 * signal word/NFPA/DOT against their enumerations. Trim before calling.
 */
export function validateHazardSymbolFields(input: {
  ghs_pictograms:    GhsPictogram[]
  ghs_signal_word:   GhsSignalWord | null
  nfpa_health:       number | null
  nfpa_flammability: number | null
  nfpa_instability:  number | null
  nfpa_special:      string | null
  dot_hazard_class:  string | null
  dot_packing_group: DotPackingGroup | null
}): FieldError[] {
  const errors: FieldError[] = []

  for (const code of input.ghs_pictograms) {
    if (!(GHS_PICTOGRAMS as readonly string[]).includes(code)) {
      errors.push({ field: 'ghs_pictograms', message: `Unknown GHS pictogram: ${code}` })
    }
  }

  if (input.ghs_signal_word && !(GHS_SIGNAL_WORDS as readonly string[]).includes(input.ghs_signal_word)) {
    errors.push({ field: 'ghs_signal_word', message: 'Signal word must be "danger" or "warning"' })
  }

  const nfpaFields = ['nfpa_health', 'nfpa_flammability', 'nfpa_instability'] as const
  for (const field of nfpaFields) {
    const value = input[field]
    if (value !== null && !isValidNfpaRating(value)) {
      errors.push({ field, message: 'NFPA rating must be an integer 0-4' })
    }
  }

  if (input.nfpa_special && !(NFPA_SPECIAL_SYMBOLS as readonly string[]).includes(input.nfpa_special)) {
    errors.push({ field: 'nfpa_special', message: `NFPA special symbol must be one of ${NFPA_SPECIAL_SYMBOLS.join(', ')}` })
  }

  if (input.dot_hazard_class && !isValidDotHazardClass(input.dot_hazard_class)) {
    errors.push({ field: 'dot_hazard_class', message: `Invalid DOT hazard class: ${input.dot_hazard_class}` })
  }

  if (input.dot_packing_group && !(DOT_PACKING_GROUPS as readonly string[]).includes(input.dot_packing_group)) {
    errors.push({ field: 'dot_packing_group', message: 'DOT packing group must be I, II, or III' })
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
  if (!HAZARDOUS_WASTE_AREA_TYPES.includes(input.area_type)) {
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

// ── Facility generator profile ──────────────────────────────────────────────
//
// Generator category is a FACILITY-level determination — the total hazardous
// waste a site generates in a calendar month across ALL streams (40 CFR
// 262.13), not a property of one waste stream. The accumulation clock for a
// central-accumulation container is governed by the *facility's* status.
//
// We store this profile on `facilities.settings.hazardous_waste` (the jsonb the
// facilities table already carries for per-facility module config) rather than
// adding columns to the shared platform table. Validation is at the API layer,
// consistent with how the module treats waste codes (migration 140).
//
// The per-stream generator_category / jurisdiction / long_haul stay as a
// fallback so existing data keeps working; `resolveGeneratorProfile` prefers
// the facility profile when present.

export const HAZARDOUS_WASTE_FACILITY_SETTINGS_KEY = 'hazardous_waste'

export interface HazardousWasteFacilityProfile {
  /** Facility-wide generator category. null = not yet determined. */
  generator_category: RcraGeneratorCategory | null
  /** Regulatory jurisdiction for the site. null = use the stream's. */
  jurisdiction: WasteJurisdiction | null
  /** EPA ID number (e.g. CAL000123456). */
  epa_id_number: string | null
  /** Default long-haul (>200 mi TSDF) flag for the site. */
  long_haul_default: boolean
}

export const EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE: HazardousWasteFacilityProfile = {
  generator_category: null,
  jurisdiction:       null,
  epa_id_number:      null,
  long_haul_default:  false,
}

/**
 * Read a facility profile out of a `facilities.settings` jsonb blob, tolerating
 * missing/garbage values. Always returns a complete profile (empty defaults).
 */
export function parseFacilityProfile(
  settings: Record<string, unknown> | null | undefined,
): HazardousWasteFacilityProfile {
  const raw = settings?.[HAZARDOUS_WASTE_FACILITY_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object') return { ...EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE }
  const o = raw as Record<string, unknown>
  const cat = o.generator_category
  const jur = o.jurisdiction
  return {
    generator_category:
      cat === 'lqg' || cat === 'sqg' || cat === 'vsqg' ? cat : null,
    jurisdiction:
      jur === 'federal' || jur === 'california' ? jur : null,
    epa_id_number:
      typeof o.epa_id_number === 'string' && o.epa_id_number.trim() ? o.epa_id_number.trim() : null,
    long_haul_default: o.long_haul_default === true,
  }
}

/** Validate a facility-profile input. Empty/unset values are allowed. */
export function validateHazardousWasteFacilityProfile(
  profile: HazardousWasteFacilityProfile,
): FieldError[] {
  const errors: FieldError[] = []
  if (profile.generator_category != null &&
      !(['lqg', 'sqg', 'vsqg'] as RcraGeneratorCategory[]).includes(profile.generator_category)) {
    errors.push({ field: 'generator_category', message: 'Invalid generator category' })
  }
  if (profile.jurisdiction != null && !WASTE_JURISDICTIONS.includes(profile.jurisdiction)) {
    errors.push({ field: 'jurisdiction', message: 'Invalid jurisdiction' })
  }
  if (profile.epa_id_number != null && profile.epa_id_number.length > 40) {
    errors.push({ field: 'epa_id_number', message: 'EPA ID must be 40 characters or fewer' })
  }
  return errors
}

export interface ResolvedGeneratorProfile {
  category: RcraGeneratorCategory
  jurisdiction: WasteJurisdiction
  longHaul: boolean
  /** Where the category came from — for UI transparency. */
  source: 'facility' | 'stream'
}

/**
 * Resolve the governing generator category/jurisdiction/long-haul for a
 * container's central-accumulation clock. The facility profile wins when it
 * sets a value; otherwise we fall back to the stream's own fields.
 */
export function resolveGeneratorProfile(
  facility: Partial<HazardousWasteFacilityProfile> | null | undefined,
  stream: Pick<HazardousWasteStreamRow, 'generator_category' | 'long_haul'> & {
    jurisdiction?: WasteJurisdiction
  },
): ResolvedGeneratorProfile {
  const category = facility?.generator_category ?? stream.generator_category
  const jurisdiction = facility?.jurisdiction ?? stream.jurisdiction ?? 'federal'
  const longHaul = facility?.long_haul_default ?? stream.long_haul
  return {
    category,
    jurisdiction,
    longHaul,
    source: facility?.generator_category != null ? 'facility' : 'stream',
  }
}

/**
 * Compute the age status of a persisted container row using the clock that
 * actually governs its accumulation area. This is area-aware on purpose:
 * applying the generator-category clock (90/180/270) to every area is a
 * common but incorrect simplification — different areas have different rules.
 *
 *   central_accumulation → generator clock (facility profile, else stream)
 *   universal_waste      → 1-year limit (40 CFR 273.15 / 22 CCR 66273.15)
 *   satellite_accumulation → no time clock until the volume cap is exceeded
 *                            (40 CFR 262.15); the 55 gal / 1 qt / 1 kg limit is
 *                            checked separately on the inspection checklist
 *   used_oil             → managed under 40 CFR 279 / 22 CCR 66279, no
 *                          dated accumulation clock
 *   inspection_only      → not an accumulation point
 *
 * For the non-clock areas we still surface `ageDays` (informational) but
 * return `not_time_limited` so the UI never renders a false OVER-LIMIT or a
 * false OK against a clock that does not apply.
 *
 * `facility` is optional: pass the facility's generator profile to use the
 * facility-level category (the regulatorily-correct source); omit it to fall
 * back to the stream's own category.
 */
export function ageStatusForContainer(
  container: Pick<HazardousWasteContainerRow, 'accumulation_started_at' | 'status' | 'area_type'>,
  stream: Pick<HazardousWasteStreamRow, 'generator_category' | 'long_haul'> & {
    jurisdiction?: WasteJurisdiction
  },
  now: Date | string,
  facility?: Partial<HazardousWasteFacilityProfile> | null,
): ContainerAgeResult {
  // Disposed and in-shipment containers no longer accumulate.
  if (container.status === 'disposed' || container.status === 'in_shipment') {
    return { ageDays: null, limitDays: null, daysUntilLimit: null, status: 'unknown' }
  }

  switch (container.area_type) {
    case 'central_accumulation': {
      const resolved = resolveGeneratorProfile(facility, stream)
      return containerAgeStatus(container.accumulation_started_at, now, {
        category: resolved.category,
        longHaul: resolved.longHaul,
        jurisdiction: resolved.jurisdiction,
      })
    }
    case 'universal_waste':
      return universalWasteAgeStatus(container.accumulation_started_at, now)
    case 'satellite_accumulation':
    case 'used_oil':
    case 'inspection_only':
    default: {
      const start = toDate(container.accumulation_started_at)
      const nowDate = toDate(now)
      const ageDays =
        start && nowDate && nowDate.getTime() >= start.getTime()
          ? Math.floor((nowDate.getTime() - start.getTime()) / MS_PER_DAY)
          : null
      return { ageDays, limitDays: null, daysUntilLimit: null, status: 'not_time_limited' }
    }
  }
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

// ── Unit conversion ─────────────────────────────────────────────────────────
// Regulatory caps are stated in gallons (volume) or kilograms (mass). Converting
// between volume and mass requires a density we don't have, so each converter
// only handles units of its own dimension and returns null otherwise. Callers
// must treat null as "cannot evaluate this cap from this unit".

const GALLONS_PER_UNIT: Partial<Record<HazardousWasteVolumeUnit, number>> = {
  gallons: 1,
  quarts:  0.25,
  liters:  0.2641720524,
}

const KILOGRAMS_PER_UNIT: Partial<Record<HazardousWasteVolumeUnit, number>> = {
  kilograms: 1,
  grams:     0.001,
  pounds:    0.45359237,
}

/** Convert a volumetric quantity to US gallons. null for mass units. */
export function toGallons(quantity: number, unit: HazardousWasteVolumeUnit): number | null {
  const factor = GALLONS_PER_UNIT[unit]
  return factor == null ? null : quantity * factor
}

/** Convert a mass quantity to kilograms. null for volume units. */
export function toKilograms(quantity: number, unit: HazardousWasteVolumeUnit): number | null {
  const factor = KILOGRAMS_PER_UNIT[unit]
  return factor == null ? null : quantity * factor
}

/** Whether a unit measures volume (gallons/liters/quarts) or mass. */
export function isVolumeUnit(unit: HazardousWasteVolumeUnit): boolean {
  return unit in GALLONS_PER_UNIT
}

// ── Satellite accumulation caps (40 CFR 262.15) ─────────────────────────────
//
// A satellite accumulation area may hold, at or near the point of generation:
//   - non-acute hazardous waste:        up to 55 gallons
//   - acute / extremely hazardous waste: up to 1 quart of LIQUID, or 1 kg of SOLID
//
// We infer liquid vs solid from the container's unit (volume → liquid,
// mass → solid). When the unit's dimension doesn't match the applicable cap
// (e.g. a non-acute waste measured in kg, whose cap is volumetric), we return
// `unknown` rather than guess.

export const SAA_NON_ACUTE_GALLONS = 55
export const SAA_ACUTE_LIQUID_GALLONS = 0.25 // 1 quart
export const SAA_ACUTE_SOLID_KG = 1

export type SatelliteCapStatus = 'unknown' | 'within_cap' | 'at_or_over_cap'

export interface SatelliteCapResult {
  status: SatelliteCapStatus
  /** Applicable cap, human-readable (e.g. "55 gallons"). */
  capLabel: string
  /** The quantity normalized into the cap's unit. null when not evaluable. */
  normalizedQuantity: number | null
  /** The cap value in the same unit as normalizedQuantity. */
  capValue: number | null
}

/**
 * Evaluate a satellite container's quantity against the applicable 40 CFR
 * 262.15 cap. `at_or_over_cap` means the generator must mark the excess with a
 * date and start the 3-day move clock (see `satelliteMoveClockStatus`).
 */
export function evaluateSatelliteCap(
  acuteClass: AcuteClass,
  quantity: number | null,
  unit: HazardousWasteVolumeUnit | null,
): SatelliteCapResult {
  if (quantity == null || unit == null || quantity < 0) {
    return { status: 'unknown', capLabel: '—', normalizedQuantity: null, capValue: null }
  }

  if (isAcuteEquivalent(acuteClass)) {
    if (isVolumeUnit(unit)) {
      const gal = toGallons(quantity, unit)!
      return {
        status: gal >= SAA_ACUTE_LIQUID_GALLONS ? 'at_or_over_cap' : 'within_cap',
        capLabel: '1 quart (liquid acute)',
        normalizedQuantity: gal,
        capValue: SAA_ACUTE_LIQUID_GALLONS,
      }
    }
    const kg = toKilograms(quantity, unit)!
    return {
      status: kg >= SAA_ACUTE_SOLID_KG ? 'at_or_over_cap' : 'within_cap',
      capLabel: '1 kg (solid acute)',
      normalizedQuantity: kg,
      capValue: SAA_ACUTE_SOLID_KG,
    }
  }

  // Non-acute: the cap is volumetric (55 gallons). A mass unit can't be
  // compared without a density, so report unknown.
  if (!isVolumeUnit(unit)) {
    return { status: 'unknown', capLabel: '55 gallons', normalizedQuantity: null, capValue: SAA_NON_ACUTE_GALLONS }
  }
  const gal = toGallons(quantity, unit)!
  return {
    status: gal >= SAA_NON_ACUTE_GALLONS ? 'at_or_over_cap' : 'within_cap',
    capLabel: '55 gallons',
    normalizedQuantity: gal,
    capValue: SAA_NON_ACUTE_GALLONS,
  }
}

/**
 * The 3-consecutive-calendar-day clock that starts once a satellite container
 * exceeds its cap (40 CFR 262.15(a)(6)): the excess must be dated and moved to
 * a central accumulation area (or off site) within three days. `excessDatedAt`
 * is the date the generator marked on the excess.
 */
export const SAA_MOVE_LIMIT_DAYS = 3

export function satelliteMoveClockStatus(
  excessDatedAt: Date | string | null | undefined,
  now: Date | string,
): ContainerAgeResult {
  return ageStatusAgainstLimit(excessDatedAt, now, SAA_MOVE_LIMIT_DAYS, 1)
}

// ── On-site quantity caps ───────────────────────────────────────────────────
//
// Generator status is also bounded by how much waste is on site at once:
//   - SQG:  may never exceed 6,000 kg of hazardous waste on site (40 CFR 262.16)
//   - VSQG: may never exceed 1,000 kg (or 1 kg acute) on site (40 CFR 262.14)
//   - LQG:  no on-site quantity cap (gated by 90-day time instead)
//
// We can only sum containers reported in mass units; volume-unit containers
// need a density to convert and are surfaced as `unconvertibleCount` so the UI
// can warn the total is incomplete rather than silently under-count.

export const ON_SITE_CAP_KG: Record<RcraGeneratorCategory, number | null> = {
  lqg:  null,
  sqg:  6000,
  vsqg: 1000,
}

export interface OnSiteCapResult {
  totalKg: number
  capKg: number | null
  status: ContainerAgeStatus
  /** Containers whose volume units couldn't be converted to mass. */
  unconvertibleCount: number
}

/**
 * Roll up the on-site mass of a set of containers and compare to the
 * category cap. `warnFractionOfCap` (default 0.9) flips the status to
 * `approaching`. Containers in volume units are counted as unconvertible.
 */
export function evaluateOnSiteQuantity(
  containers: ReadonlyArray<Pick<HazardousWasteContainerRow, 'volume_quantity' | 'volume_unit' | 'status'>>,
  category: RcraGeneratorCategory,
  warnFractionOfCap = 0.9,
): OnSiteCapResult {
  const cap = ON_SITE_CAP_KG[category]
  let totalKg = 0
  let unconvertibleCount = 0

  for (const c of containers) {
    // Only waste physically on site counts; shipped/disposed does not.
    if (c.status === 'in_shipment' || c.status === 'disposed') continue
    if (c.volume_quantity == null || c.volume_unit == null) continue
    const kg = toKilograms(c.volume_quantity, c.volume_unit)
    if (kg == null) { unconvertibleCount++; continue }
    totalKg += kg
  }

  if (cap == null) {
    return { totalKg, capKg: null, status: 'not_time_limited', unconvertibleCount }
  }
  let status: ContainerAgeStatus
  if (totalKg > cap) status = 'over_limit'
  else if (totalKg >= cap * warnFractionOfCap) status = 'approaching'
  else status = 'ok'
  return { totalKg, capKg: cap, status, unconvertibleCount }
}
