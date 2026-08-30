// Root-cause-analysis (RCA) schemas — types + small validators shared
// across web + mobile.
//
// One investigation row picks one RCA method; the analysis is stored
// in the method-specific table (see migration 062). Each method has
// its own row shape (mirrors the DB columns) plus a "create input"
// shape used by the API. Validators check structural minimums; the
// DB CHECK constraints stay authoritative.

// ──────────────────────────────────────────────────────────────────────────
// Method discriminator
// ──────────────────────────────────────────────────────────────────────────

export const RCA_METHODS = ['5_whys', 'fishbone', 'taproot', 'icam', 'none_yet'] as const
export type RcaMethod = typeof RCA_METHODS[number]

export const RCA_METHOD_LABEL: Record<RcaMethod, string> = {
  '5_whys':   '5 Whys',
  fishbone:   'Fishbone (Ishikawa)',
  taproot:    'TapRooT',
  icam:       'ICAM',
  none_yet:   'Not yet selected',
}

export const RCA_METHOD_HELP: Record<RcaMethod, string> = {
  '5_whys':
    'Ask "why?" repeatedly until a root cause emerges. Lightweight; works for most operational incidents.',
  fishbone:
    'Bucket causes into six categories (people, process, equipment, environment, materials, management) — surfaces blind spots.',
  taproot:
    'Build a causal-factor tree from event to root cause to generic cause. Heavier method for serious or systemic incidents.',
  icam:
    'Layer causes from absent/failed defences through individual/team actions to task and organisational factors. Common in mining and aviation.',
  none_yet:
    'Pick a method to start the analysis.',
}

// 5 Whys is RETIRED (soft): it stays a valid stored value so existing
// investigations still render, but it is no longer offered for new
// investigations and its editor is read-only. The Events & Causal Factors
// Analysis (ECFA) tool supersedes it for causal analysis.
export const RETIRED_RCA_METHODS: readonly RcaMethod[] = ['5_whys']

export function isRetiredRcaMethod(m: RcaMethod): boolean {
  return RETIRED_RCA_METHODS.includes(m)
}

// The methods offered in the "Begin investigation" + method-switch pickers.
export const ACTIVE_RCA_METHODS: readonly RcaMethod[] = RCA_METHODS.filter(
  (m) => m !== 'none_yet' && !RETIRED_RCA_METHODS.includes(m),
)

// ──────────────────────────────────────────────────────────────────────────
// Investigation row (shared lifecycle metadata)
// ──────────────────────────────────────────────────────────────────────────

export type IncidentInvestigationRow = {
  id:                  string
  tenant_id:           string
  incident_id:         string
  rca_method:          RcaMethod
  began_at:            string | null
  target_close_at:     string | null
  completed_at:        string | null
  lead_investigator:   string | null
  team_member_ids:     string[]
  scope_summary:       string | null
  sequence_of_events:  string | null
  immediate_causes:    string | null
  underlying_causes:   string | null
  root_causes:         string | null
  lessons_learned:     string | null
  signoff_by:          string | null
  signoff_at:          string | null
  signoff_typed_name:  string | null
  // Lessons-learned library — see migration 067.
  publish_lesson?:      boolean
  lesson_summary?:      string | null
  lesson_published_at?: string | null
  lesson_published_by?: string | null
  created_at:          string
  updated_at:          string
  created_by:          string | null
  updated_by:          string | null
}

export interface IncidentInvestigationCreateInput {
  rca_method?:          RcaMethod
  target_close_at?:     string | null
  lead_investigator?:   string | null
  team_member_ids?:     string[]
  scope_summary?:       string | null
}

export interface IncidentInvestigationPatchInput {
  rca_method?:          RcaMethod
  began_at?:            string | null
  target_close_at?:     string | null
  completed_at?:        string | null
  lead_investigator?:   string | null
  team_member_ids?:     string[]
  scope_summary?:       string | null
  sequence_of_events?:  string | null
  immediate_causes?:    string | null
  underlying_causes?:   string | null
  root_causes?:         string | null
  lessons_learned?:     string | null
  signoff_typed_name?:  string | null
  // Lessons-learned library — see migration 067. Toggling
  // publish_lesson true (with a non-empty lesson_summary) surfaces
  // the investigation in the tenant-wide library.
  publish_lesson?:      boolean
  lesson_summary?:      string | null
}

// ──────────────────────────────────────────────────────────────────────────
// 5 Whys
// ──────────────────────────────────────────────────────────────────────────

export interface FiveWhysRow {
  id:                string
  tenant_id:         string
  investigation_id:  string
  ordinal:           number
  question:          string | null
  answer:            string
  is_root:           boolean
  // The "why" this answer interrogates. NULL for the top-of-tree problem
  // statement and for legacy linear chains (migration 234). Lets one
  // investigation fork into several causal lines instead of one flat
  // chain. Optional on the type so callers selecting a narrower column
  // set still type-check.
  parent_id?:        string | null
  // Provenance for the AI-assisted flow: ai_origin=true when Claude
  // drafted the answer, ai_edited=true when a human changed it before
  // saving. Both default false (manual entry). See migration 234.
  ai_origin?:        boolean
  ai_edited?:        boolean
  created_at:        string
  updated_at:        string
}

export interface FiveWhysNodeInput {
  ordinal:    number
  question?:  string | null
  answer:     string
  is_root?:   boolean
  parent_id?: string | null
  ai_origin?: boolean
  ai_edited?: boolean
}

// ──────────────────────────────────────────────────────────────────────────
// Fishbone (Ishikawa)
// ──────────────────────────────────────────────────────────────────────────

export const FISHBONE_CATEGORIES = [
  'people', 'process', 'equipment', 'environment', 'materials', 'management',
] as const
export type FishboneCategory = typeof FISHBONE_CATEGORIES[number]

export const FISHBONE_CATEGORY_LABEL: Record<FishboneCategory, string> = {
  people:       'People',
  process:      'Process',
  equipment:    'Equipment',
  environment:  'Environment',
  materials:    'Materials',
  management:   'Management',
}

export interface FishboneRow {
  id:                string
  tenant_id:         string
  investigation_id:  string
  category:          FishboneCategory
  cause:             string
  ordinal:           number
  is_root:           boolean
  created_at:        string
  updated_at:        string
}

export interface FishboneNodeInput {
  category:  FishboneCategory
  cause:     string
  ordinal?:  number
  is_root?:  boolean
}

// ──────────────────────────────────────────────────────────────────────────
// TapRooT (causal-factor tree)
// ──────────────────────────────────────────────────────────────────────────

export const TAPROOT_FACTOR_TYPES = [
  'event', 'condition', 'causal_factor', 'root_cause', 'generic_cause',
] as const
export type TaprootFactorType = typeof TAPROOT_FACTOR_TYPES[number]

export const TAPROOT_FACTOR_LABEL: Record<TaprootFactorType, string> = {
  event:          'Event',
  condition:      'Condition',
  causal_factor:  'Causal factor',
  root_cause:     'Root cause',
  generic_cause:  'Generic cause',
}

export interface TaprootFactorRow {
  id:                string
  tenant_id:         string
  investigation_id:  string
  parent_id:         string | null
  factor_type:       TaprootFactorType
  description:       string
  taproot_category:  string | null
  ordinal:           number
  is_root:           boolean
  created_at:        string
  updated_at:        string
}

export interface TaprootFactorInput {
  parent_id?:        string | null
  factor_type:       TaprootFactorType
  description:       string
  taproot_category?: string | null
  ordinal?:          number
  is_root?:          boolean
}

// ──────────────────────────────────────────────────────────────────────────
// ICAM
// ──────────────────────────────────────────────────────────────────────────

export const ICAM_LAYERS = [
  'absent_failed_defences',
  'individual_team_actions',
  'task_environmental_conditions',
  'organisational_factors',
] as const
export type IcamLayer = typeof ICAM_LAYERS[number]

export const ICAM_LAYER_LABEL: Record<IcamLayer, string> = {
  absent_failed_defences:        'Absent / failed defences',
  individual_team_actions:       'Individual / team actions',
  task_environmental_conditions: 'Task / environmental conditions',
  organisational_factors:        'Organisational factors',
}

export interface IcamFactorRow {
  id:                string
  tenant_id:         string
  investigation_id:  string
  layer:             IcamLayer
  factor:            string
  evidence:          string | null
  ordinal:           number
  is_root:           boolean
  created_at:        string
  updated_at:        string
}

export interface IcamFactorInput {
  layer:     IcamLayer
  factor:    string
  evidence?: string | null
  ordinal?:  number
  is_root?:  boolean
}

// ──────────────────────────────────────────────────────────────────────────
// Discriminated union for "any RCA node input"
// ──────────────────────────────────────────────────────────────────────────

export type RcaNodeInput =
  | { method: '5_whys';  node: FiveWhysNodeInput }
  | { method: 'fishbone'; node: FishboneNodeInput }
  | { method: 'taproot';  node: TaprootFactorInput }
  | { method: 'icam';     node: IcamFactorInput }

// ──────────────────────────────────────────────────────────────────────────
// Validators (early-feedback; DB CHECK is authoritative)
// ──────────────────────────────────────────────────────────────────────────

export function validateFiveWhys(node: Partial<FiveWhysNodeInput>): string | null {
  if (typeof node.ordinal !== 'number' || node.ordinal < 1)
    return 'ordinal must be a positive integer'
  if (!node.answer || !node.answer.trim()) return 'answer is required'
  return null
}

export function validateFishbone(node: Partial<FishboneNodeInput>): string | null {
  if (!node.category || !(FISHBONE_CATEGORIES as readonly string[]).includes(node.category))
    return `Invalid fishbone category: ${node.category ?? '(missing)'}`
  if (!node.cause || !node.cause.trim()) return 'cause is required'
  return null
}

export function validateTaproot(node: Partial<TaprootFactorInput>): string | null {
  if (!node.factor_type || !(TAPROOT_FACTOR_TYPES as readonly string[]).includes(node.factor_type))
    return `Invalid taproot factor_type: ${node.factor_type ?? '(missing)'}`
  if (!node.description || !node.description.trim()) return 'description is required'
  // event nodes sit at the top of the tree — they can't have a parent.
  // Conditions, causal_factor, root_cause and generic_cause should
  // descend from something. We don't strictly enforce parent_id !=
  // null here because the API may insert root + children in any
  // order; the UI rebuilds the tree on render.
  return null
}

export function validateIcam(node: Partial<IcamFactorInput>): string | null {
  if (!node.layer || !(ICAM_LAYERS as readonly string[]).includes(node.layer))
    return `Invalid icam layer: ${node.layer ?? '(missing)'}`
  if (!node.factor || !node.factor.trim()) return 'factor is required'
  return null
}

// Dispatch helper used by the unified /api/incidents/[id]/rca POST.
export function validateRcaNode(input: RcaNodeInput): string | null {
  switch (input.method) {
    case '5_whys':   return validateFiveWhys(input.node)
    case 'fishbone': return validateFishbone(input.node)
    case 'taproot':  return validateTaproot(input.node)
    case 'icam':     return validateIcam(input.node)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Guided 5 Whys helpers (pure; power the redesigned editor + AI assist)
// ──────────────────────────────────────────────────────────────────────────

// Longest prior-answer snippet we inline into a chained prompt before
// clipping. Keeps "Why did <answer> happen?" readable.
const PROMPT_CLIP = 80

function clipForPrompt(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > PROMPT_CLIP ? clean.slice(0, PROMPT_CLIP - 1).trimEnd() + '…' : clean
}

// Builds the contextual prompt for the NEXT "why" so the chain actually
// chains: each question interrogates the answer it descends from. The
// top-of-tree node (no parent answer) gets the problem-statement prompt.
//
// This replaces the old hardcoded "Why did that happen?" that never
// echoed the prior answer — the change that made the chain read as a set
// of disconnected boxes.
export function nextWhyPrompt(parentAnswer?: string | null): string {
  const clean = (parentAnswer ?? '').trim()
  if (!clean) return 'What happened?'
  return `Why did "${clipForPrompt(clean)}" happen?`
}

// Anti-blame / anti-symptom guardrail (HOP / Safety-II aligned). Pure,
// zero-cost first pass that runs client-side as the investigator types —
// the AI route is a richer second opinion, not a prerequisite.
//
// Advisory only: it NEVER blocks saving. The point is to nudge the
// investigator past person-blaming and symptom-level answers toward the
// systemic condition, exactly the failure mode the ISO-45001 wiki warns
// about ("don't treat 'retrain the worker' as a root cause").
export type SymptomCategory = 'blame' | 'symptom'

interface SymptomPattern {
  re:       RegExp
  category: SymptomCategory
  reason:   string
}

const SYMPTOM_PATTERNS: readonly SymptomPattern[] = [
  { re: /\bhuman error\b/i, category: 'blame',
    reason: '“Human error” is where the analysis starts, not where it ends. Ask why the situation made the error likely.' },
  { re: /\b(careless|carelessness|negligent|negligence)\b/i, category: 'blame',
    reason: 'Blaming carelessness stops the inquiry. Ask what made the safe action hard or the unsafe one easy.' },
  { re: /\b(re-?train|retraining|more training|additional training|toolbox talk)\b/i, category: 'symptom',
    reason: '“Retrain the worker” is almost always a symptom-level fix. Find the systemic gap before defaulting to training.' },
  { re: /\b(not paying attention|wasn'?t paying attention|inattentive|distracted)\b/i, category: 'blame',
    reason: 'Attention lapses are predictable. Ask what in the task or environment invited the lapse.' },
  { re: /\b(complacen)/i, category: 'blame',
    reason: 'Complacency is a label, not a cause. Ask what made the hazard easy to overlook day-to-day.' },
  { re: /\b(forgot|forgetful)/i, category: 'symptom',
    reason: 'If a step was forgotten, ask why the process relied on memory instead of a barrier or check.' },
  { re: /\b(didn'?t follow|did not follow|failed to follow|ignored)\b/i, category: 'symptom',
    reason: 'Procedure not followed? Ask whether it was workable, known, available, and reinforced in practice.' },
  { re: /\b(violation|violated)\b/i, category: 'blame',
    reason: 'A “violation” framing assigns fault. Ask what made the non-compliant path the path of least resistance.' },
]

export function detectSymptomLanguage(
  answer: string,
): { flagged: boolean; reason?: string; category?: SymptomCategory } {
  if (!answer || !answer.trim()) return { flagged: false }
  for (const p of SYMPTOM_PATTERNS) {
    if (p.re.test(answer)) return { flagged: true, reason: p.reason, category: p.category }
  }
  return { flagged: false }
}

// Seeds a corrective-action draft from an identified root cause — the
// one-click "turn this root into a tracked action" path. Shape matches
// IncidentActionCreateInput (see incidentAction.ts); hierarchy is left
// null so the owner picks the strongest workable control deliberately.
export function buildRootCauseActionDraft(opts: { rootCauseText: string }): {
  action_type: 'corrective'
  description: string
  hierarchy_of_controls: null
} {
  const clean = (opts.rootCauseText ?? '').trim()
  return {
    action_type: 'corrective',
    description: clean ? `Address root cause: ${clean}` : 'Address identified root cause',
    hierarchy_of_controls: null,
  }
}

// Closure check: an investigation can only be marked completed once the
// RCA has nodes AND at least one identified root (multiple roots are now
// allowed — real incidents have several contributing causes).
//
// `require_action_per_root` is an opt-in stricter gate (ISO 45001 §10.2:
// findings must drive corrective action). It is OFF by default so
// in-flight investigations and existing callers/tests are never
// retroactively locked; a tenant that wants the stronger loop turns it on
// and supplies the root/action counts.
export function canCompleteInvestigation(opts: {
  rca_method:               RcaMethod
  has_nodes:                boolean
  has_root:                 boolean
  require_action_per_root?: boolean
  root_count?:              number
  roots_with_actions?:      number
}): { ok: true } | { ok: false; reason: string } {
  if (opts.rca_method === 'none_yet')
    return { ok: false, reason: 'Pick an RCA method first' }
  if (!opts.has_nodes)
    return { ok: false, reason: 'Add at least one RCA node before completing' }
  if (!opts.has_root)
    return { ok: false, reason: 'Mark at least one node as an identified root before completing' }
  if (opts.require_action_per_root) {
    const roots   = opts.root_count ?? 0
    const covered = opts.roots_with_actions ?? 0
    if (roots > covered)
      return { ok: false, reason: 'Every identified root cause needs at least one corrective action before completing' }
  }
  return { ok: true }
}
