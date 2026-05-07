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
  created_at:        string
  updated_at:        string
}

export interface FiveWhysNodeInput {
  ordinal:    number
  question?:  string | null
  answer:     string
  is_root?:   boolean
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

// Closure check: investigation can only be marked completed when an
// RCA node tree exists AND a root has been identified. Used by the
// API close handler before it sets completed_at.
export function canCompleteInvestigation(opts: {
  rca_method: RcaMethod
  has_nodes:  boolean
  has_root:   boolean
}): { ok: true } | { ok: false; reason: string } {
  if (opts.rca_method === 'none_yet')
    return { ok: false, reason: 'Pick an RCA method first' }
  if (!opts.has_nodes)
    return { ok: false, reason: 'Add at least one RCA node before completing' }
  if (!opts.has_root)
    return { ok: false, reason: 'Mark one node as the identified root before completing' }
  return { ok: true }
}
