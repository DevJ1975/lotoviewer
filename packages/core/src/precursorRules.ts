// Precursor patterns — named combinations of conditions that plausibly precede
// an incident. Pure: no I/O, no LLM, no fitted coefficients.
//
// WHY HAND-AUTHORED RULES AND NOT A LEARNED MODEL
// A precursor is a CONJUNCTION inside a short window ("overdue corrective
// actions on the same equipment family as a near-miss reported this month").
// That event class is rarer than monthly recordables by an order of magnitude,
// so there is no tenant with enough labelled history to fit a supervised model
// against. A rule also survives the question an auditor actually asks — "why
// did you tell this crew they were at risk" — because the premise is written
// down and can be argued with.
//
// WHY EVERY RULE STILL CARRIES A VALIDATION LABEL
// Explainability and validity are orthogonal. A hand-authored threshold is
// fully explainable and, until measured, entirely unvalidated — which answers
// an auditor no better than a black box would. So each firing is labelled from
// the tenant's OWN history using the same lagged-correlation reliability gate
// leadingIndicatorSignals already applies to raw indicators.
//
// The label is a LABEL, not a firing gate. Requiring 12 months of correlated
// history before a rule may fire would mean no rule ever fires for a new
// tenant, which is precisely when the conditions matter most. Unvalidated
// rules render as "conditions to check" and never outrank validated ones.

import { discoverLeadingSignals, type LeadingSignalSeries } from './leadingIndicatorSignals'

// ──────────────────────────────────────────────────────────────────────────
// Conditions
// ──────────────────────────────────────────────────────────────────────────

// The observable facts a rule may test. Each maps to a count the caller
// gathers over a recent window. Deliberately small: a condition earns its place
// only if some rule reads it.
export interface PrecursorConditions {
  /** Corrective actions past their due date and still open. */
  capasOverdue:          number
  /** Near-misses reported in the window. */
  nearMissRecent:        number
  /** Recordable injuries in the window. */
  recordablesRecent:     number
  /** BBS at-risk observations (unsafe acts + conditions) in the window. */
  bbsUnsafe:             number
  /** BBS observations with a required follow-up still open. */
  bbsFollowupsOpen:      number
  /** Inspections graded fail in the window. */
  inspectionsFailed:     number
  /** Inspections graded pass or fail in the window (denominator). */
  inspectionsTotal:      number
  /** Required training assignments missing or overdue. */
  trainingGaps:          number
  /** Permits that ran past expiry without close-out. */
  permitExpiredOpen:     number
  /** Open high/extreme risks with no control attached. */
  highRisksUncontrolled: number
  /** Confirmed hazard signals read out of field photos in the window. */
  visionSignalsConfirmed: number
  /** …of which carry the taxonomy's highest severity weight. */
  visionSignalsSevere:    number
}

// ──────────────────────────────────────────────────────────────────────────
// Rules
// ──────────────────────────────────────────────────────────────────────────

export type PrecursorSeverity = 'watch' | 'elevated' | 'urgent'

export interface PrecursorEvidenceItem {
  label: string
  value: string
}

interface PrecursorRuleSpec {
  key:      string
  label:    string
  severity: PrecursorSeverity
  /**
   * The premise, in one sentence. REQUIRED — a rule with no stated premise is
   * an unfalsifiable number, and this string is what an auditor argues with.
   */
  basis:    string
  href:     string
  action:   string
  /** Which indicator series validates this rule against tenant history. */
  validatingSeries: keyof PrecursorConditions
  fires:    (c: PrecursorConditions) => boolean
  evidence: (c: PrecursorConditions) => PrecursorEvidenceItem[]
}

const inspectionFailRate = (c: PrecursorConditions): number =>
  c.inspectionsTotal === 0 ? 0 : c.inspectionsFailed / c.inspectionsTotal

// Rule catalog. Tune here — thresholds are stated, not fitted, and each one's
// justification is in `basis`.
const RULES: PrecursorRuleSpec[] = [
  {
    key:      'known_hazard_left_open',
    label:    'Known hazards left open while near-misses continue',
    severity: 'urgent',
    basis:    'Corrective actions are written because a hazard was found. Leaving three or more past their due date while workers keep reporting near-misses means the program has identified a hazard and not removed it — the sequence that precedes most repeat events.',
    href:     '/incidents',
    action:   'Close the overdue corrective actions before adding new ones.',
    validatingSeries: 'capasOverdue',
    fires:    c => c.capasOverdue >= 3 && c.nearMissRecent >= 1,
    evidence: c => [
      { label: 'Overdue corrective actions', value: `${c.capasOverdue}` },
      { label: 'Near-misses this window',    value: `${c.nearMissRecent}` },
    ],
  },
  {
    key:      'observation_without_followthrough',
    label:    'At-risk observations recorded but not followed through',
    severity: 'elevated',
    basis:    'A behavioural observation program only reduces risk at the follow-up step. Open follow-ups accumulating alongside at-risk observations means the program is measuring exposure without changing it.',
    href:     '/bbs',
    action:   'Work the open BBS follow-up queue down to zero.',
    validatingSeries: 'bbsFollowupsOpen',
    fires:    c => c.bbsFollowupsOpen >= 5 && c.bbsUnsafe >= 3,
    evidence: c => [
      { label: 'Open follow-ups',       value: `${c.bbsFollowupsOpen}` },
      { label: 'At-risk observations',  value: `${c.bbsUnsafe}` },
    ],
  },
  {
    key:      'conditions_drifting_out_of_standard',
    label:    'Inspection failures rising while training gaps persist',
    severity: 'elevated',
    basis:    'A failing inspection says conditions have drifted; a training gap says the people meant to catch that drift have not been qualified to. Together they describe a control that exists on paper only.',
    href:     '/inspections',
    action:   'Close competency-matrix gaps for the crews covering the failing inspection points.',
    validatingSeries: 'inspectionsFailed',
    fires:    c => c.inspectionsTotal >= 5 && inspectionFailRate(c) >= 0.25 && c.trainingGaps >= 1,
    evidence: c => [
      { label: 'Inspection fail rate', value: `${c.inspectionsFailed}/${c.inspectionsTotal}` },
      { label: 'Training gaps',        value: `${c.trainingGaps}` },
    ],
  },
  {
    key:      'high_energy_work_unauthorized',
    label:    'High-energy permits left open past expiry',
    severity: 'urgent',
    basis:    'A permit past expiry with no close-out means confined-space or hot work either continued without live authorization or finished without anyone confirming it. Both are the documented precursor to the events those permits exist to prevent.',
    href:     '/confined-spaces/status',
    action:   'Close out the expired permits and confirm the work actually stopped.',
    validatingSeries: 'permitExpiredOpen',
    fires:    c => c.permitExpiredOpen >= 1,
    evidence: c => [
      { label: 'Permits past expiry, open', value: `${c.permitExpiredOpen}` },
    ],
  },
  {
    key:      'uncontrolled_risk_with_field_evidence',
    label:    'Field photos show severe hazards while high risks sit uncontrolled',
    severity: 'urgent',
    basis:    'A high or extreme risk with no control attached is a stated intention to accept it. Severe hazards appearing in field photos over the same window is evidence the acceptance is not holding in practice.',
    href:     '/risk',
    action:   'Attach controls to the open high/extreme risks and verify them against the photo findings.',
    validatingSeries: 'visionSignalsSevere',
    fires:    c => c.highRisksUncontrolled >= 1 && c.visionSignalsSevere >= 2,
    evidence: c => [
      { label: 'Open high/extreme risks',   value: `${c.highRisksUncontrolled}` },
      { label: 'Severe photo findings',     value: `${c.visionSignalsSevere}` },
      { label: 'All confirmed findings',    value: `${c.visionSignalsConfirmed}` },
    ],
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Validation label
// ──────────────────────────────────────────────────────────────────────────

export type PrecursorValidation = 'validated' | 'unvalidated' | 'contradicted'

export interface PrecursorPattern {
  key:        string
  label:      string
  severity:   PrecursorSeverity
  basis:      string
  href:       string
  action:     string
  evidence:   PrecursorEvidenceItem[]
  validation: PrecursorValidation
  /**
   * Months this rule's driving indicator has historically led recordables, when
   * validated. Null when unvalidated — an unvalidated rule makes NO lead-time
   * claim, which is the whole point of the label.
   */
  leadMonths: number | null
  /** Overlapping months the validation was computed from. */
  historyMonths: number
}

/** Monthly history the validation label is computed from. */
export interface PrecursorHistory {
  /** Monthly recordable counts, oldest → newest. */
  recordablesMonthly: readonly number[]
  /**
   * Monthly series for each condition the rules validate against, index-aligned
   * with recordablesMonthly. A missing series simply yields 'unvalidated'.
   */
  seriesByCondition: Partial<Record<keyof PrecursorConditions, readonly number[]>>
}

export const PRECURSOR_MODEL_VERSION = '1.0.0'

export interface DetectPrecursorsResult {
  patterns:     PrecursorPattern[]
  modelVersion: string
}

/**
 * Evaluates every rule against the current window, then labels each firing from
 * the tenant's own history.
 *
 * Ranking is severity first, then validated ahead of unvalidated — an
 * unvalidated pattern never outranks one that has been measured. A rule whose
 * driving indicator historically moves the WRONG way is labelled
 * 'contradicted' rather than hidden: that is a finding about the rule, and
 * burying it would be the same mistake as burying a false positive.
 */
export function detectPrecursors(
  conditions: PrecursorConditions,
  history?: PrecursorHistory,
): DetectPrecursorsResult {
  const labels = history ? validationLabels(history) : new Map<string, ValidationLabel>()

  const patterns: PrecursorPattern[] = RULES
    .filter(rule => rule.fires(conditions))
    .map(rule => {
      const label = labels.get(rule.validatingSeries)
      return {
        key:           rule.key,
        label:         rule.label,
        severity:      rule.severity,
        basis:         rule.basis,
        href:          rule.href,
        action:        rule.action,
        evidence:      rule.evidence(conditions),
        validation:    label?.validation ?? 'unvalidated',
        leadMonths:    label?.validation === 'validated' ? label.leadMonths : null,
        historyMonths: label?.historyMonths ?? 0,
      }
    })

  patterns.sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    || VALIDATION_RANK[b.validation] - VALIDATION_RANK[a.validation]
    || a.key.localeCompare(b.key))

  return { patterns, modelVersion: PRECURSOR_MODEL_VERSION }
}

const SEVERITY_RANK: Record<PrecursorSeverity, number> = { urgent: 3, elevated: 2, watch: 1 }
const VALIDATION_RANK: Record<PrecursorValidation, number> = {
  validated: 3, contradicted: 2, unvalidated: 1,
}

interface ValidationLabel {
  validation:    PrecursorValidation
  leadMonths:    number
  historyMonths: number
}

// Reuses discoverLeadingSignals rather than re-deriving correlation here: the
// reliability gate (≥12 overlapping months, |r| ≥ 0.3) is already stated and
// tested there, and two thresholds for one question would drift.
function validationLabels(history: PrecursorHistory): Map<string, ValidationLabel> {
  const series: LeadingSignalSeries[] = Object.entries(history.seriesByCondition)
    .filter((entry): entry is [string, readonly number[]] => Array.isArray(entry[1]))
    .map(([key, monthly]) => ({ key, label: key, monthly: [...monthly] }))

  const out = new Map<string, ValidationLabel>()
  if (series.length === 0) return out

  for (const signal of discoverLeadingSignals(series, history.recordablesMonthly)) {
    out.set(signal.key, {
      // Every rule here is written so that MORE of the condition means MORE
      // risk. A reliable signal pointing the other way contradicts its rule.
      validation: !signal.reliable
        ? 'unvalidated'
        : signal.direction === 'predicts_more' ? 'validated' : 'contradicted',
      leadMonths:    signal.bestLag,
      historyMonths: signal.nMonths,
    })
  }
  return out
}

/** Rule metadata for docs and admin surfaces — no evaluation. */
export function precursorRuleCatalog(): ReadonlyArray<{
  key: string; label: string; severity: PrecursorSeverity; basis: string
}> {
  return RULES.map(r => ({ key: r.key, label: r.label, severity: r.severity, basis: r.basis }))
}
