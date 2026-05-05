// Risk-wizard state types + step validators.
//
// Shared between the RiskWizard shell, every step component, and
// the unit tests. Each validator is pure (state → string|null) so
// the wizard's "Next" gate, the inline error UI, and the test
// suite all agree on what counts as a valid step.

import type { HazardCategory, RiskStatus } from '@soteria/core/queries/risks'
import type { HierarchyLevel } from '@soteria/core/risk'

// ──────────────────────────────────────────────────────────────────────────
// Wizard state shape
// ──────────────────────────────────────────────────────────────────────────

export interface WizardControl {
  /** Local-only stable key for the form rows. */
  localId:         string
  /** library row id; null when this is a free-text custom control. */
  control_id:      string | null
  hierarchy_level: HierarchyLevel
  /** Human-readable name. Always present — either copied from the
      library entry the user clicked, or typed by hand. */
  display_name:    string
  /** Optional free-text. */
  notes:           string
}

export interface WizardState {
  // Step 1: Identify
  title:                  string
  description:            string
  source:                 'inspection' | 'jsa' | 'incident' | 'worker_report' | 'audit' | 'moc' | 'other'
  source_ref_id:          string

  // Step 2: Categorize
  hazard_category:        HazardCategory | ''
  location:               string
  process:                string
  activity_type:          'routine' | 'non_routine' | 'emergency'
  affected_personnel:     {
    workers:     boolean
    contractors: boolean
    visitors:    boolean
    public:      boolean
  }
  exposure_frequency:     'continuous' | 'daily' | 'weekly' | 'monthly' | 'rare'

  // Step 3: Inherent score (0 = unset)
  inherent_severity:      0 | 1 | 2 | 3 | 4 | 5
  inherent_likelihood:    0 | 1 | 2 | 3 | 4 | 5

  // Step 4: Controls
  controls:               WizardControl[]
  ppe_only_justification: string

  // Step 5: Residual score (null = not yet scored — skippable)
  residual_severity:      0 | 1 | 2 | 3 | 4 | 5
  residual_likelihood:    0 | 1 | 2 | 3 | 4 | 5

  // Step 6: Assign
  assigned_to:            string
  reviewer:               string
  approver:               string

  // Step 7: Review schedule
  next_review_date:       string  // YYYY-MM-DD
}

// ──────────────────────────────────────────────────────────────────────────
// Step ordering + labels — used by the step indicator + nav
// ──────────────────────────────────────────────────────────────────────────

export type WizardStepId =
  | 'identify' | 'categorize' | 'inherent' | 'controls'
  | 'residual' | 'assign'    | 'review'   | 'confirm'

export const WIZARD_STEPS: { id: WizardStepId; label: string; subtitle: string }[] = [
  { id: 'identify',   label: 'Identify',   subtitle: 'What is the hazard?' },
  { id: 'categorize', label: 'Categorize', subtitle: 'Where + when does it occur?' },
  { id: 'inherent',   label: 'Inherent',   subtitle: 'Score with no controls' },
  { id: 'controls',   label: 'Controls',   subtitle: 'Hierarchy of Controls' },
  { id: 'residual',   label: 'Residual',   subtitle: 'Score with controls' },
  { id: 'assign',     label: 'Assign',     subtitle: 'Owner + reviewers' },
  { id: 'review',     label: 'Review',     subtitle: 'Cadence' },
  { id: 'confirm',    label: 'Confirm',    subtitle: 'Review + submit' },
]

// ──────────────────────────────────────────────────────────────────────────
// Initial state
// ──────────────────────────────────────────────────────────────────────────

export function makeInitialWizardState(): WizardState {
  return {
    title:                  '',
    description:            '',
    source:                 'inspection',
    source_ref_id:          '',
    hazard_category:        '',
    location:               '',
    process:                '',
    activity_type:          'routine',
    affected_personnel:     { workers: true, contractors: false, visitors: false, public: false },
    exposure_frequency:     'daily',
    inherent_severity:      0,
    inherent_likelihood:    0,
    controls:               [],
    ppe_only_justification: '',
    residual_severity:      0,
    residual_likelihood:    0,
    assigned_to:            '',
    reviewer:               '',
    approver:               '',
    next_review_date:       '',
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-step validators — return null when valid, error string when not
// ──────────────────────────────────────────────────────────────────────────

export function validateIdentify(s: WizardState): string | null {
  if (!s.title.trim())                            return 'Title is required.'
  if (s.title.trim().length < 4)                  return 'Title is too short — give the hazard a meaningful name.'
  if (!s.description.trim())                      return 'Description is required.'
  if (s.description.trim().length < 10)           return 'Description should explain when + where the hazard occurs.'
  return null
}

export function validateCategorize(s: WizardState): string | null {
  if (!s.hazard_category)                         return 'Pick a hazard category.'
  return null
}

export function validateInherent(s: WizardState): string | null {
  if (s.inherent_severity   === 0)                return 'Pick an inherent severity (1–5).'
  if (s.inherent_likelihood === 0)                return 'Pick an inherent likelihood (1–5).'
  return null
}

/**
 * Step 4 (controls) validator. The PPE-alone rule mirrors the DB
 * trigger from migration 039: when inherent_score >= 8 AND every
 * linked control has hierarchy_level = 'ppe', a justification is
 * required. Below that threshold, no controls are mandatory yet.
 *
 * The wizard ALLOWS submitting with zero controls (a freshly-
 * identified risk often gets controls planned later), so this
 * step's "Next" button is enabled even when controls.length = 0.
 * The DB-level trigger only fires when controls exist, so the
 * empty-controls case is fine to defer.
 */
export function validateControls(s: WizardState): string | null {
  const score = s.inherent_severity * s.inherent_likelihood
  if (s.controls.length === 0) return null
  // Each control must have a name (library lookup OR custom text)
  for (const c of s.controls) {
    if (!c.display_name.trim()) return 'Every control needs a name.'
  }
  const allPpe = s.controls.every(c => c.hierarchy_level === 'ppe')
  if (score >= 8 && allPpe && !s.ppe_only_justification.trim()) {
    return 'PPE-alone rule (ISO 45001 8.1.2): document why higher-level controls are not feasible.'
  }
  return null
}

/**
 * Residual is OPTIONAL at create time. The wizard lets users skip
 * it (next_review_date defaults from inherent band when residual
 * is missing). When SOME residual fields are set, BOTH must be set.
 */
export function validateResidual(s: WizardState): string | null {
  const sevSet  = s.residual_severity   !== 0
  const likeSet = s.residual_likelihood !== 0
  if (sevSet && !likeSet) return 'Pick a residual likelihood, or clear severity to skip residual scoring.'
  if (likeSet && !sevSet) return 'Pick a residual severity, or clear likelihood to skip residual scoring.'
  return null
}

export function validateAssign(_s: WizardState): string | null {
  // All optional in slice 3 — slice 4 may require assigned_to for
  // High/Extreme risks. For now, no fields required.
  return null
}

export function validateReview(s: WizardState): string | null {
  if (!s.next_review_date) return 'Pick a next-review date.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.next_review_date)) return 'Date must be YYYY-MM-DD.'
  const t = Date.parse(s.next_review_date)
  if (!Number.isFinite(t)) return 'Invalid date.'
  // Same-day OK — past dates probably indicate a typo.
  if (t < Date.now() - 86_400_000) return 'Next-review date is in the past.'
  return null
}

export function validateConfirm(s: WizardState): string | null {
  // The confirm step re-runs every prior validator; this is the
  // belt-and-suspenders gate before submit.
  return validateIdentify(s)
      ?? validateCategorize(s)
      ?? validateInherent(s)
      ?? validateControls(s)
      ?? validateResidual(s)
      ?? validateAssign(s)
      ?? validateReview(s)
}

export function validateStep(stepId: WizardStepId, s: WizardState): string | null {
  switch (stepId) {
    case 'identify':   return validateIdentify(s)
    case 'categorize': return validateCategorize(s)
    case 'inherent':   return validateInherent(s)
    case 'controls':   return validateControls(s)
    case 'residual':   return validateResidual(s)
    case 'assign':     return validateAssign(s)
    case 'review':     return validateReview(s)
    case 'confirm':    return validateConfirm(s)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Submit-payload builder — converts wizard state to the API body
// ──────────────────────────────────────────────────────────────────────────

export interface SubmitPayload {
  risk: {
    title:                  string
    description:            string
    source:                 WizardState['source']
    source_ref_id:          string | null
    hazard_category:        HazardCategory
    location:               string | null
    process:                string | null
    activity_type:          WizardState['activity_type']
    affected_personnel:     WizardState['affected_personnel']
    exposure_frequency:     WizardState['exposure_frequency']
    inherent_severity:      number
    inherent_likelihood:    number
    residual_severity:      number | null
    residual_likelihood:    number | null
    ppe_only_justification: string | null
    assigned_to:            string | null
    reviewer:               string | null
    approver:               string | null
    next_review_date:       string
  }
  controls: Array<{
    hierarchy_level: HierarchyLevel
    control_id?:     string
    custom_name?:    string
    notes?:          string
  }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function uuidOrNull(v: string): string | null {
  return UUID_RE.test(v) ? v : null
}

export function buildSubmitPayload(s: WizardState): SubmitPayload {
  const residualSet = s.residual_severity !== 0 && s.residual_likelihood !== 0

  return {
    risk: {
      title:                  s.title.trim(),
      description:            s.description.trim(),
      source:                 s.source,
      source_ref_id:          uuidOrNull(s.source_ref_id),
      hazard_category:        s.hazard_category as HazardCategory,
      location:               s.location.trim() || null,
      process:                s.process.trim()  || null,
      activity_type:          s.activity_type,
      affected_personnel:     s.affected_personnel,
      exposure_frequency:     s.exposure_frequency,
      inherent_severity:      s.inherent_severity,
      inherent_likelihood:    s.inherent_likelihood,
      residual_severity:      residualSet ? s.residual_severity   : null,
      residual_likelihood:    residualSet ? s.residual_likelihood : null,
      ppe_only_justification: s.ppe_only_justification.trim() || null,
      assigned_to:            uuidOrNull(s.assigned_to),
      reviewer:               uuidOrNull(s.reviewer),
      approver:               uuidOrNull(s.approver),
      next_review_date:       s.next_review_date,
    },
    controls: s.controls.map(c => ({
      hierarchy_level: c.hierarchy_level,
      control_id:      c.control_id ?? undefined,
      custom_name:     c.control_id ? undefined : (c.display_name.trim() || undefined),
      notes:           c.notes.trim() || undefined,
    })),
  }
}

// Re-exports so consumers don't have to import from two places.
export type { HierarchyLevel, HazardCategory, RiskStatus }
