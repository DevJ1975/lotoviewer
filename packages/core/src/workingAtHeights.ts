// Regulatory constants for the Working at Heights module.
//
// Pure data + pure functions — no I/O, no React, no Node. Both the
// web app (clearance calculator, permit pre-checks) and the eventual
// mobile shell will import from here. The wiki manual at
// /wiki/working-at-heights references these by name; if you change a
// number here, update the manual too (the wiki-sync gate enforces it).
//
// References:
//   29 CFR 1910 Subpart D (Walking-Working Surfaces) — general industry
//   29 CFR 1926 Subpart M (Fall Protection) — construction
//   ANSI Z359 family (Fall Arrest Systems standards)
//   Cal/OSHA Title 8 §3210, §3270-3299, §1670-1671

// ─── Trigger heights (in feet) ─────────────────────────────────────────────

export interface TriggerHeight {
  /** Plain-language label shown in the UI. */
  label:    string
  /** Trigger height in feet — at or above this height, fall protection is required. */
  feet:     number
  /** Regulatory citation. */
  citation: string
}

export const TRIGGER_HEIGHTS = {
  FED_GENERAL_INDUSTRY: {
    label:    'Federal OSHA — General Industry',
    feet:     4,
    citation: '29 CFR 1910.28',
  },
  FED_CONSTRUCTION: {
    label:    'Federal OSHA — Construction',
    feet:     6,
    citation: '29 CFR 1926.501',
  },
  FED_SCAFFOLD: {
    label:    'Federal OSHA — Scaffold work',
    feet:     10,
    citation: '29 CFR 1926.451',
  },
  FED_STEEL_ERECTION: {
    label:    'Federal OSHA — Steel erection',
    feet:     15,
    citation: '29 CFR 1926.760',
  },
  CALOSHA_CONSTRUCTION: {
    label:    'Cal/OSHA — Construction unprotected sides',
    feet:     7.5,
    citation: 'Cal/OSHA T8 §1670',
  },
  CALOSHA_GENERAL_INDUSTRY: {
    label:    'Cal/OSHA — General industry',
    feet:     4,
    citation: 'Cal/OSHA T8 §3210',
  },
} as const satisfies Record<string, TriggerHeight>

export type TriggerHeightKey = keyof typeof TRIGGER_HEIGHTS

// ─── Ladder type ratings (ANSI A14) ────────────────────────────────────────

export interface LadderTypeRating {
  type:        'IAA' | 'IA' | 'I' | 'II' | 'III'
  label:       string
  capacityLbf: number
  recommendedUse: string
}

export const LADDER_TYPE_RATINGS: readonly LadderTypeRating[] = [
  { type: 'IAA', label: 'Special Duty',     capacityLbf: 375, recommendedUse: 'Industrial, with worker + tools + materials' },
  { type: 'IA',  label: 'Extra Heavy Duty', capacityLbf: 300, recommendedUse: 'Industrial, default for most field crews' },
  { type: 'I',   label: 'Heavy Duty',       capacityLbf: 250, recommendedUse: 'Industrial light — verify worker + tools <250 lbf' },
  { type: 'II',  label: 'Medium Duty',      capacityLbf: 225, recommendedUse: 'Commercial — not recommended for industrial use' },
  { type: 'III', label: 'Light Duty',       capacityLbf: 200, recommendedUse: 'Household — NOT for industrial use' },
]

// ─── Fall clearance calculation ────────────────────────────────────────────
//
// Required clearance is the distance below the anchor a worker needs
// before the arrest system fully completes — including free fall,
// deceleration, harness stretch, the worker below their dorsal D-ring,
// and a safety margin. If the available clearance is less than the
// required clearance, the system cannot safely arrest the fall.
//
// Defaults below are the industry-standard values used by ANSI Z359
// design guides; manufacturer-specific values may differ (longer
// shock absorbers, larger workers, etc).

export interface ClearanceInputs {
  /** Chosen connection system. */
  system:           'shock_lanyard' | 'srl_class1' | 'srl_class2' | 'restraint'
  /** Lanyard length in feet (lanyard only — ignored for SRL). */
  lanyardLengthFt?: number
  /** Worker height below the dorsal D-ring in feet. Default 5 ft. */
  workerBelowDringFt?: number
  /** Safety margin in feet. Default 2 ft. */
  safetyMarginFt?:  number
  /** Anchor offset horizontally from worker position (ft). Used for swing-fall. Default 0. */
  swingFallOffsetFt?: number
}

export interface ClearanceResult {
  /** Required clearance in feet below the anchor. */
  requiredClearanceFt: number
  /** Per-component breakdown so the calculator can show the math. */
  breakdown: Array<{ label: string; feet: number }>
  /** Recommendation for the operator. */
  notes: string[]
}

const DEFAULT_DECELERATION_LANYARD_FT  = 3.5
const DEFAULT_DECELERATION_SRL_FT      = 2.0
const DEFAULT_HARNESS_STRETCH_FT       = 1.5
const DEFAULT_WORKER_BELOW_DRING_FT    = 5.0
const DEFAULT_SAFETY_MARGIN_FT         = 2.0

export function calculateRequiredClearance(inputs: ClearanceInputs): ClearanceResult {
  const workerBelowDringFt = inputs.workerBelowDringFt ?? DEFAULT_WORKER_BELOW_DRING_FT
  const safetyMarginFt     = inputs.safetyMarginFt     ?? DEFAULT_SAFETY_MARGIN_FT
  const swingFallOffsetFt  = inputs.swingFallOffsetFt  ?? 0

  // Restraint never falls — clearance is just the worker length plus margin.
  if (inputs.system === 'restraint') {
    const breakdown = [
      { label: 'Worker below D-ring', feet: workerBelowDringFt },
      { label: 'Safety margin',       feet: safetyMarginFt },
    ]
    return {
      requiredClearanceFt: workerBelowDringFt + safetyMarginFt,
      breakdown,
      notes: [
        'Restraint system — the worker physically cannot reach the fall edge, so no arrest forces apply.',
        'Confirm the restraint lanyard length is shorter than the distance from the anchor to the nearest fall edge.',
      ],
    }
  }

  // Lanyard / SRL — free fall, deceleration, harness stretch, worker, margin.
  if (inputs.system === 'shock_lanyard') {
    const lanyardFt = inputs.lanyardLengthFt ?? 6
    const breakdown = [
      { label: 'Lanyard length',           feet: lanyardFt },
      { label: 'Deceleration distance',    feet: DEFAULT_DECELERATION_LANYARD_FT },
      { label: 'Harness stretch',          feet: DEFAULT_HARNESS_STRETCH_FT },
      { label: 'Worker below D-ring',      feet: workerBelowDringFt },
      { label: 'Safety margin',            feet: safetyMarginFt },
    ]
    if (swingFallOffsetFt > 0) {
      // Swing-fall — first-order pendulum approximation. The worker
      // arcs from the anchor; the lowest point of the arc is below the
      // worker's starting elevation. Distance = anchor_height -
      // sqrt(anchor_height^2 - offset^2). For small offsets relative
      // to the anchor height, this approximates to offset^2 /
      // (2 * anchor_height). We treat anchor_height as the lanyard
      // length here for a conservative estimate.
      const swingFt = (swingFallOffsetFt * swingFallOffsetFt) / (2 * lanyardFt)
      breakdown.push({ label: 'Swing-fall drop', feet: Number(swingFt.toFixed(2)) })
    }
    const totalFt = breakdown.reduce((sum, b) => sum + b.feet, 0)
    return {
      requiredClearanceFt: Number(totalFt.toFixed(2)),
      breakdown,
      notes: [
        `Required clearance is ${totalFt.toFixed(1)} ft below the anchor. If the available clearance is less, the lanyard cannot safely arrest the fall — switch to an SRL or relocate the anchor.`,
        swingFallOffsetFt > 0
          ? 'Swing-fall offset detected — verify there is no structure between the worker and the anchor pendulum arc.'
          : 'No swing-fall offset (anchor directly above worker).',
      ],
    }
  }

  // SRL — lockup distance varies by class but typical values are 2 ft
  // for Class 1 (overhead) and somewhat longer for Class 2 (any-angle).
  // We treat both as 2 ft for the conservative default; a manufacturer-
  // specific value should override at the per-component level.
  const breakdown = [
    { label: 'SRL lockup distance',  feet: DEFAULT_DECELERATION_SRL_FT },
    { label: 'Harness stretch',      feet: DEFAULT_HARNESS_STRETCH_FT },
    { label: 'Worker below D-ring',  feet: workerBelowDringFt },
    { label: 'Safety margin',        feet: safetyMarginFt },
  ]
  const totalFt = breakdown.reduce((sum, b) => sum + b.feet, 0)
  return {
    requiredClearanceFt: Number(totalFt.toFixed(2)),
    breakdown,
    notes: [
      `Required clearance is ${totalFt.toFixed(1)} ft below the anchor. SRLs reduce free fall and are the preferred choice when clearance is constrained.`,
      inputs.system === 'srl_class2'
        ? 'Class 2 SRL — rated for leading-edge / sharp-edge applications. Required when the lifeline could be loaded over an edge sharper than 0.005 in (typical structural steel).'
        : 'Class 1 SRL — rated for overhead anchor only. Do NOT use over a sharp edge; switch to Class 2.',
    ],
  }
}

// ─── Anchor capacity ──────────────────────────────────────────────────────
//
// 29 CFR 1910.140(c)(13) requires every anchor to be rated at 5,000 lbf
// per attached worker OR designed and engineered with a 2:1 safety
// factor under supervision of a Qualified Person.

export const SINGLE_WORKER_ANCHOR_MIN_LBF = 5000
export const ENGINEERED_ANCHOR_SAFETY_FACTOR = 2.0

export function requiredAnchorCapacity(workers: number, engineered: boolean, peakArrestForceLbf = 1800): number {
  if (workers < 1) return 0
  if (engineered) return ENGINEERED_ANCHOR_SAFETY_FACTOR * peakArrestForceLbf * workers
  return SINGLE_WORKER_ANCHOR_MIN_LBF * workers
}

// ─── Equipment service life defaults ──────────────────────────────────────
//
// Manufacturer-specific values override these. The constants below are
// the typical service-life envelopes used in fall protection programs
// when the manufacturer documentation is unavailable.

export const DEFAULT_SERVICE_LIFE_YEARS = {
  harness:        5,
  shock_lanyard:  5,
  positioning_lanyard: 5,
  srl_class1:     5,
  srl_class2:     5,
  anchor_connector: 5,
  rope_grab:      5,
  trauma_strap:   5,
} as const

// ─── ANSI Z359 component classes ──────────────────────────────────────────

export const FALL_PROTECTION_COMPONENT_TYPES = [
  'harness',
  'shock_lanyard',
  'positioning_lanyard',
  'restraint_lanyard',
  'srl_class1',
  'srl_class2',
  'anchor_connector',
  'rope_grab',
  'trauma_strap',
  'rescue_descent_device',
] as const

export type FallProtectionComponentType = typeof FALL_PROTECTION_COMPONENT_TYPES[number]

// ─── Inspection cycle types ───────────────────────────────────────────────

export type InspectionKind = 'pre_use' | 'periodic' | 'post_event'
export type InspectionOutcome = 'pass' | 'concern' | 'condemn'

// ─── Person role designations ─────────────────────────────────────────────

export const AT_HEIGHTS_ROLES = [
  'authorized',  // worker performing at-height tasks
  'competent',   // CP — inspects and authorises
  'qualified',   // QP — engineers anchorages
] as const

export type AtHeightsRole = typeof AT_HEIGHTS_ROLES[number]
