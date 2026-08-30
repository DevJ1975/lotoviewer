// Cal/OSHA worker-protection logic for hazardous-waste operations.
//
// Pure decision helpers — no I/O. They encode two of the most-confused
// distinctions in practice:
//
//   1. Does HAZWOPER (8 CCR 5192 / 29 CFR 1910.120) even apply to this
//      activity? Routine, in-control generator accumulation and inspection by
//      trained staff is generally NOT HAZWOPER; TSD operations, RCRA corrective
//      action, voluntary cleanups, and emergency response ARE.
//
//   2. Is a release an "incidental" spill staff may clean, or an "emergency
//      response" requiring an Emergency Response Plan and trained responders
//      (5192(q))?
//
// These are triage aids for the field, not a substitute for the employer's
// HAZWOPER program or a competent safety professional's judgment.

// ── HAZWOPER applicability ──────────────────────────────────────────────────

/**
 * The activities that pull work under 8 CCR 5192. `routineGeneratorWork` is
 * listed so a caller can assert the activity is ONLY routine accumulation —
 * it never, on its own, triggers coverage.
 */
export interface HazwoperActivity {
  /** Treatment, storage, or disposal under a permit or interim status (5192(a)(1)(C)). */
  tsdOperations: boolean
  /** RCRA corrective action or cleanup of a hazardous-waste site (5192(a)(1)(A)/(B)). */
  correctiveActionCleanup: boolean
  /** Voluntary cleanup at a site recognized as uncontrolled hazardous waste. */
  voluntaryCleanup: boolean
  /** Emergency response to releases of hazardous substances (5192(a)(1)(E), (q)). */
  emergencyResponse: boolean
  /** Routine generator accumulation, labeling, weekly inspection by trained staff. */
  routineGeneratorWork: boolean
}

export type HazwoperTrainingTier =
  | 'none'
  | 'general_site_worker_40hr'
  | 'occasional_or_limited_24hr'
  | 'supervisor_8hr'
  | 'fr_awareness'
  | 'fr_operations'
  | 'hazmat_technician'
  | 'hazmat_specialist'
  | 'on_scene_incident_commander'

export const HAZWOPER_TRAINING_LABEL: Record<HazwoperTrainingTier, string> = {
  none:                        'No HAZWOPER training required',
  general_site_worker_40hr:    '40-hour general site worker + 3 days supervised field experience',
  occasional_or_limited_24hr:  '24-hour (occasional / limited-exposure worker) + 1 day supervised',
  supervisor_8hr:              '8-hour supervisor/manager (in addition to the worker tier)',
  fr_awareness:                'First Responder Awareness level',
  fr_operations:               'First Responder Operations level',
  hazmat_technician:           'Hazardous Materials Technician',
  hazmat_specialist:           'Hazardous Materials Specialist',
  on_scene_incident_commander: 'On-Scene Incident Commander',
}

/** Annual 8-hour refresher requirement (8 CCR 5192(e)(8)). */
export const HAZWOPER_REFRESHER_DAYS = 365

export interface HazwoperAssessment {
  covered: boolean
  basis: string
  /** Suggested minimum training tiers; empty when not covered. */
  suggestedTraining: HazwoperTrainingTier[]
  /** True when an annual 8-hour refresher applies. */
  annualRefresher: boolean
}

/**
 * Triage whether an activity is HAZWOPER-covered and, if so, the baseline
 * training. Conservative: any covered activity returns covered=true even if
 * `routineGeneratorWork` is also set, because the routine flag never removes
 * coverage created by another activity.
 */
export function assessHazwoperApplicability(activity: HazwoperActivity): HazwoperAssessment {
  if (activity.emergencyResponse) {
    return {
      covered: true,
      basis: 'Emergency response to hazardous-substance releases (8 CCR 5192(q)).',
      suggestedTraining: ['fr_awareness', 'fr_operations'],
      annualRefresher: true,
    }
  }
  if (activity.correctiveActionCleanup || activity.voluntaryCleanup) {
    return {
      covered: true,
      basis: 'Cleanup / corrective action at an uncontrolled hazardous-waste site (8 CCR 5192(a)(1)(A)–(C)).',
      suggestedTraining: ['general_site_worker_40hr', 'supervisor_8hr'],
      annualRefresher: true,
    }
  }
  if (activity.tsdOperations) {
    return {
      covered: true,
      basis: 'Treatment, storage, or disposal operations under RCRA permit/interim status (8 CCR 5192(p)).',
      suggestedTraining: ['occasional_or_limited_24hr'],
      annualRefresher: true,
    }
  }
  return {
    covered: false,
    basis:
      'Routine generator accumulation, labeling, and inspection by trained staff is not HAZWOPER work. ' +
      'Workers still need HazCom (8 CCR 5194) and waste-handling training.',
    suggestedTraining: ['none'],
    annualRefresher: false,
  }
}

// ── Incidental release vs. emergency response (8 CCR 5192(q)) ────────────────

/**
 * Facts about a release used to decide incidental vs. emergency. The default
 * posture is cautious: if the release is uncontrolled or presents a safety/
 * health hazard, it is an emergency response.
 */
export interface ReleaseFacts {
  /** The release is uncontrolled or spreading. */
  uncontrolled: boolean
  /** It poses (or could pose) a safety or health hazard (e.g. IDLH potential). */
  safetyOrHealthHazard: boolean
  /** It requires evacuation of the area. */
  requiresEvacuation: boolean
  /**
   * It is beyond an "incidental" amount that employees in the immediate area
   * can safely absorb/clean using available equipment.
   */
  beyondIncidental: boolean
}

export type ReleaseClassification = 'incidental' | 'emergency_response' | 'needs_review'

export interface ReleaseDecision {
  classification: ReleaseClassification
  rationale: string
  /** The action the field user should take. */
  action: string
}

/**
 * Classify a release. Any one emergency signal makes it an emergency response.
 * A clearly small, controlled, safely-cleanable release is incidental. When the
 * facts are silent (no signals AND no positive "this is small/controlled"
 * confirmation), return needs_review rather than guess "incidental".
 */
export function classifyRelease(facts: ReleaseFacts): ReleaseDecision {
  const emergencySignals =
    facts.uncontrolled ||
    facts.safetyOrHealthHazard ||
    facts.requiresEvacuation ||
    facts.beyondIncidental

  if (emergencySignals) {
    return {
      classification: 'emergency_response',
      rationale:
        'At least one emergency indicator is present (uncontrolled, safety/health hazard, evacuation, ' +
        'or beyond an incidental amount). This is an emergency response under 8 CCR 5192(q).',
      action: 'Evacuate as needed, activate the Emergency Response Plan, and call trained responders. Do not attempt cleanup unless trained and authorized.',
    }
  }

  return {
    classification: 'incidental',
    rationale:
      'Controlled, within an incidental amount, no safety/health hazard, no evacuation — an incidental ' +
      'release that does not trigger 5192(q).',
    action: 'Clean up using the spill kit per the site procedure, document it, and report per the incident workflow.',
  }
}
