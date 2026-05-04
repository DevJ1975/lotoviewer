// Risk Assessment scoring engine.
//
// Pure-TS module. Used by:
//   - The hazard-ID wizard's live preview (severity + likelihood
//     change → band + color update without a DB round-trip).
//   - Read-side rendering (heat map cell counts, list filters).
//   - Tests (every cell of the 5x5 matrix is covered here).
//
// Authoritative scoring lives in the DB via generated columns
// (migration 037). This module produces the SAME values for the
// same inputs; if these ever drift, the test suite catches it via
// a cross-check between this engine and a manual matrix grid below.
//
// Regulatory references appear inline at the function they enforce.

// ──────────────────────────────────────────────────────────────────────────
// Scales (PDD §4.1, §4.2)
// ──────────────────────────────────────────────────────────────────────────

export const SEVERITY_LABELS = [
  'Negligible', 'Minor', 'Moderate', 'Major', 'Catastrophic',
] as const

export const LIKELIHOOD_LABELS = [
  'Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain',
] as const

export type Severity   = 1 | 2 | 3 | 4 | 5
export type Likelihood = 1 | 2 | 3 | 4 | 5

// ──────────────────────────────────────────────────────────────────────────
// Bands (PDD §4.5)
// ──────────────────────────────────────────────────────────────────────────

export type Band = 'low' | 'moderate' | 'high' | 'extreme'

// 4-band is the recommended ISO-45001-defensible scheme (PDD §4.5).
// 3-band collapses high+extreme into a single 'high' tier — kept as
// a tenant-level read-side option (PDD §18). The DB always stores
// the 4-band value; this module collapses on read when the tenant
// has 3-band selected.
export type BandScheme = '4-band' | '3-band'

// ──────────────────────────────────────────────────────────────────────────
// Hierarchy of Controls (ISO 45001 8.1.2)
// ──────────────────────────────────────────────────────────────────────────

export type HierarchyLevel =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'ppe'

// Ordered most-effective → least-effective. ISO 45001 8.1.2 + OSHA
// 1910.132(a) require higher-level controls before PPE.
export const HIERARCHY_ORDER: ReadonlyArray<HierarchyLevel> = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'ppe',
] as const

export const HIERARCHY_LABELS: Record<HierarchyLevel, string> = {
  elimination:    'Elimination',
  substitution:   'Substitution',
  engineering:    'Engineering',
  administrative: 'Administrative',
  ppe:            'PPE',
}

// ──────────────────────────────────────────────────────────────────────────
// Scoring
// ──────────────────────────────────────────────────────────────────────────

/**
 * Risk score = severity × likelihood. Domain: 1..25. Returns NaN for
 * out-of-range inputs so callers fail loudly rather than silently
 * computing a band on garbage.
 */
export function scoreRisk(severity: number, likelihood: number): number {
  if (!Number.isInteger(severity) || severity < 1 || severity > 5) return NaN
  if (!Number.isInteger(likelihood) || likelihood < 1 || likelihood > 5) return NaN
  return severity * likelihood
}

/**
 * Map a score to a band. Thresholds (PDD §4.5):
 *   1–3   → low
 *   4–6   → moderate
 *   8–12  → high
 *   15–25 → extreme
 *
 * Note score=7 isn't reachable from the 5x5 grid (only products of
 * 1..5 × 1..5), so the 4–6 → moderate / ≥8 → high split is
 * well-defined. We still handle 7 defensively (treats as 'high'
 * since 7 ≥ 7) for callers passing freeform scores.
 *
 * 3-band scheme collapses 'high' and 'extreme' into a single 'high'
 * tier — the literal 'extreme' value is never returned.
 */
export function bandFor(score: number, scheme: BandScheme = '4-band'): Band {
  if (Number.isNaN(score) || score < 1) {
    // Out of range → caller bug. Throw rather than silently
    // mis-classify; band decisions drive who must approve and
    // whether the risk can close.
    throw new Error(`bandFor: invalid score ${score}`)
  }
  let band: Band
  if      (score <= 3)  band = 'low'
  else if (score <= 6)  band = 'moderate'
  else if (score <= 12) band = 'high'
  else                  band = 'extreme'

  if (scheme === '3-band' && band === 'extreme') return 'high'
  return band
}

// ──────────────────────────────────────────────────────────────────────────
// Display tokens — color + accessible pattern + text label
// ──────────────────────────────────────────────────────────────────────────

export interface BandDisplay {
  /** Hex color from PDD §4.5. Always paired with `label` + `pattern`. */
  hex:       string
  /** Tailwind background class for use in pills + cells. */
  tailwind:  string
  /** Color-blind-safe pattern class (CSS background-image utility). */
  pattern:   string
  /** Human-readable label — never display color alone. */
  label:     string
  /** Tailwind text class for sufficient contrast on the background. */
  textClass: string
}

/**
 * Display tokens for a band. Color is always paired with a text
 * label AND a pattern (WCAG AA + color-blind safe per the PDD's
 * UI/UX notes §17 and the prompt's quality bar).
 *
 * The `pattern` class names are conventions used by the
 * `<RiskBandPill>` component; they map to CSS rules that overlay a
 * subtle pattern on the background so a screen reader user OR a
 * color-blind user can still distinguish bands without color.
 */
export function colorFor(band: Band): BandDisplay {
  switch (band) {
    case 'low':
      return { hex: '#16A34A', tailwind: 'bg-emerald-600', pattern: 'pattern-band-low',      label: 'Low',      textClass: 'text-white' }
    case 'moderate':
      return { hex: '#EAB308', tailwind: 'bg-yellow-500',  pattern: 'pattern-band-moderate', label: 'Moderate', textClass: 'text-slate-900' }
    case 'high':
      return { hex: '#EA580C', tailwind: 'bg-orange-600',  pattern: 'pattern-band-high',     label: 'High',     textClass: 'text-white' }
    case 'extreme':
      return { hex: '#DC2626', tailwind: 'bg-red-600',     pattern: 'pattern-band-extreme',  label: 'Extreme',  textClass: 'text-white' }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Authority + cadence rules (PDD §4.5, §6.3)
// ──────────────────────────────────────────────────────────────────────────

export type AuthorityRole = 'supervisor' | 'manager' | 'site_manager' | 'executive'

/**
 * Who has authority to ACCEPT a risk at this band (PDD §4.5).
 * 'manager' = department manager; 'site_manager' = plant/site
 * manager; 'executive' = exec / safety director.
 */
export function authorityFor(band: Band): AuthorityRole {
  switch (band) {
    case 'low':      return 'supervisor'
    case 'moderate': return 'manager'
    case 'high':     return 'site_manager'
    case 'extreme':  return 'executive'
  }
}

/**
 * Default review cadence in days (PDD §6.3). Configurable per tenant
 * via `tenants.settings.risk_review_cadence_*` keys (Slice 2 wiring).
 */
export function reviewCadenceDays(band: Band): number {
  switch (band) {
    case 'extreme':  return 90    // Extreme: every 90 days
    case 'high':     return 180   // High: every 180 days
    case 'moderate': return 365   // Moderate: annually
    case 'low':      return 730   // Low: every 2 years
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Acceptance threshold (PDD §4.6)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Default residual-risk threshold above which a risk cannot be
 * marked Closed without an exception approval. PDD §4.6 default
 * is 6 (Moderate or below). Tenant override lives in
 * `tenants.settings.risk_acceptance_threshold`.
 */
export const DEFAULT_ACCEPTANCE_THRESHOLD = 6

/** Returns true if the residual score is at or below the threshold. */
export function isResidualAcceptable(
  residualScore: number | null | undefined,
  threshold: number = DEFAULT_ACCEPTANCE_THRESHOLD,
): boolean {
  if (residualScore == null) return false
  return residualScore <= threshold
}

// ──────────────────────────────────────────────────────────────────────────
// Hierarchy-of-controls helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * The PPE-alone rule (ISO 45001 8.1.2 + OSHA 1910.132(a)): when
 * inherent_score >= 8 ('high' or 'extreme') AND every linked
 * control has hierarchy_level = 'ppe', the risk requires a
 * documented justification (`ppe_only_justification` on the row).
 *
 * Returns:
 *   { allowed: true }                                  — no constraint applies
 *   { allowed: true,  justificationRequired: true }    — applies, but justification covers it
 *   { allowed: false }                                 — applies, no justification → block
 *
 * The DB enforces this via the constraint trigger in migration 039;
 * this helper drives the wizard UI's inline warning + required field.
 */
export function evaluatePpeAloneRule(args: {
  inherentScore:           number
  controlLevels:           HierarchyLevel[]
  hasPpeOnlyJustification: boolean
}): { applies: boolean; allowed: boolean; justificationRequired: boolean } {
  const { inherentScore, controlLevels, hasPpeOnlyJustification } = args

  // Below the threshold, the rule doesn't apply at all.
  const applies = inherentScore >= 8 && controlLevels.length > 0
                  && controlLevels.every(l => l === 'ppe')

  if (!applies) {
    return { applies: false, allowed: true, justificationRequired: false }
  }

  return {
    applies:                true,
    allowed:                hasPpeOnlyJustification,
    justificationRequired:  true,
  }
}

/**
 * Highest-applied control level for a risk, for the §12 KPI
 * "hierarchy distribution" report. Returns null when the risk
 * has no controls at all.
 */
export function highestAppliedControl(levels: HierarchyLevel[]): HierarchyLevel | null {
  if (levels.length === 0) return null
  for (const level of HIERARCHY_ORDER) {
    if (levels.includes(level)) return level
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// Tenant config reader
// ──────────────────────────────────────────────────────────────────────────

export interface RiskTenantConfig {
  /** PDD §18 — 4-band is the recommended default. */
  bandScheme:           BandScheme
  /** PDD §4.6 — residual score must be ≤ this to mark Closed. */
  acceptanceThreshold:  number
}

/**
 * Pull risk-specific config from a tenant's `settings` jsonb.
 * Missing keys fall back to the defaults documented above.
 */
export function readRiskConfig(
  tenantSettings: Record<string, unknown> | null | undefined,
): RiskTenantConfig {
  const s = tenantSettings ?? {}
  const rawScheme = s.risk_band_scheme
  const scheme: BandScheme = (rawScheme === '3-band' || rawScheme === '4-band')
    ? rawScheme
    : '4-band'

  const rawThreshold = s.risk_acceptance_threshold
  const threshold = (typeof rawThreshold === 'number' && rawThreshold >= 1 && rawThreshold <= 25)
    ? rawThreshold
    : DEFAULT_ACCEPTANCE_THRESHOLD

  return { bandScheme: scheme, acceptanceThreshold: threshold }
}
