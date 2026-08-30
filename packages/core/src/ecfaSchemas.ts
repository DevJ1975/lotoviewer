// Events & Causal Factors Analysis (ECFA) — types, validators, and pure
// layout/analysis helpers shared across web + mobile.
//
// ECFA charts the chronological "story" of an incident: a primary line of
// EVENTS (rectangles) read left→right, CONDITIONS (ovals) attached above or
// below the event they modify, and one terminal loss/INCIDENT node
// (diamond). Nodes carry a verification_status so the chart separates
// VERIFIED fact from PRESUMPTIVE assumption (rendered solid vs dashed), and
// flagged CAUSAL FACTORS are coded (category + failed barrier + hierarchy of
// controls) so they trend across incidents.
//
// ECFA is self-contained: a causal factor turns directly into a tracked
// corrective action (incident_actions.source_ecfa_node_id) — there is no
// drill-down into a separate RCA method. See migration 244.
//
// Validators check structural minimums; the DB CHECK constraints stay
// authoritative. Layout is a pure function so the same geometry drives the
// on-screen SVG, the PDF export, and unit tests.

import { ICAM_LAYERS, ICAM_LAYER_LABEL, type IcamLayer } from './rcaSchemas'
import {
  HIERARCHY_OF_CONTROLS,
  HIERARCHY_LABEL,
  type HierarchyOfControls,
} from './incidentAction'

// Re-export the anti-blame guardrail so the ECFA editor uses the same
// HOP/Safety-II first pass as the RCA editor (no duplicate pattern table).
export { detectSymptomLanguage } from './rcaSchemas'

// ──────────────────────────────────────────────────────────────────────────
// Enums + labels
// ──────────────────────────────────────────────────────────────────────────

export const ECFA_NODE_TYPES = ['event', 'condition', 'incident'] as const
export type EcfaNodeType = typeof ECFA_NODE_TYPES[number]

export const ECFA_NODE_TYPE_LABEL: Record<EcfaNodeType, string> = {
  event:     'Event',
  condition: 'Condition',
  incident:  'Incident (loss)',
}

export const ECFA_VERIFICATION = ['presumptive', 'verified'] as const
export type EcfaVerification = typeof ECFA_VERIFICATION[number]

export const ECFA_VERIFICATION_LABEL: Record<EcfaVerification, string> = {
  presumptive: 'Presumptive',
  verified:    'Verified',
}

export const ECFA_LANES = ['above', 'below'] as const
export type EcfaLane = typeof ECFA_LANES[number]

// Causal-factor coding reuses the ICAM layer taxonomy (migration 062) so
// causal factors are trendable alongside ICAM analyses — one vocabulary,
// not two.
export const CAUSAL_FACTOR_CATEGORIES = ICAM_LAYERS
export type CausalFactorCategory = IcamLayer
export const CAUSAL_FACTOR_CATEGORY_LABEL: Record<CausalFactorCategory, string> = ICAM_LAYER_LABEL

// ──────────────────────────────────────────────────────────────────────────
// Row + input shapes (mirror the incident_ecfa_nodes columns)
// ──────────────────────────────────────────────────────────────────────────

export interface EcfaNodeRow {
  id:                   string
  tenant_id:            string
  investigation_id:     string
  node_type:            EcfaNodeType
  sequence_index:       number
  parent_event_id:      string | null
  lane:                 EcfaLane | null
  title:                string
  description:          string | null
  occurred_at:          string | null
  verification_status:  EcfaVerification
  is_causal_factor:     boolean
  cf_category:          CausalFactorCategory | null
  failed_barrier:       string | null
  cf_hierarchy_control: HierarchyOfControls | null
  // Provenance for the AI-assisted flow (see migration 244). Optional on
  // the type so callers selecting a narrower column set still type-check.
  ai_origin?:           boolean
  ai_edited?:           boolean
  created_at:           string
  updated_at:           string
  created_by?:          string | null
}

export interface EcfaNodeInput {
  node_type:             EcfaNodeType
  title:                 string
  sequence_index?:       number
  parent_event_id?:      string | null
  lane?:                 EcfaLane | null
  description?:          string | null
  occurred_at?:          string | null
  verification_status?:  EcfaVerification
  is_causal_factor?:     boolean
  cf_category?:          CausalFactorCategory | null
  failed_barrier?:       string | null
  cf_hierarchy_control?: HierarchyOfControls | null
  ai_origin?:            boolean
  ai_edited?:            boolean
}

export interface EcfaNodePatchInput {
  title?:                string
  sequence_index?:       number
  parent_event_id?:      string | null
  lane?:                 EcfaLane | null
  description?:          string | null
  occurred_at?:          string | null
  verification_status?:  EcfaVerification
  is_causal_factor?:     boolean
  cf_category?:          CausalFactorCategory | null
  failed_barrier?:       string | null
  cf_hierarchy_control?: HierarchyOfControls | null
  ai_edited?:            boolean
}

// ──────────────────────────────────────────────────────────────────────────
// Validators (early-feedback; DB CHECK is authoritative)
// ──────────────────────────────────────────────────────────────────────────

const TITLE_MAX = 300

export function validateEcfaNode(node: Partial<EcfaNodeInput>): string | null {
  if (!node.node_type || !(ECFA_NODE_TYPES as readonly string[]).includes(node.node_type))
    return `Invalid node_type: ${node.node_type ?? '(missing)'}`
  const title = (node.title ?? '').trim()
  if (!title) return 'title is required'
  if (title.length > TITLE_MAX) return `title must be ${TITLE_MAX} characters or fewer`
  if (node.lane && !(ECFA_LANES as readonly string[]).includes(node.lane))
    return `Invalid lane: ${node.lane}`
  if (node.verification_status
      && !(ECFA_VERIFICATION as readonly string[]).includes(node.verification_status))
    return `Invalid verification_status: ${node.verification_status}`
  if (node.cf_category
      && !(CAUSAL_FACTOR_CATEGORIES as readonly string[]).includes(node.cf_category))
    return `Invalid cf_category: ${node.cf_category}`
  if (node.cf_hierarchy_control
      && !(HIERARCHY_OF_CONTROLS as readonly string[]).includes(node.cf_hierarchy_control))
    return `Invalid cf_hierarchy_control: ${node.cf_hierarchy_control}`
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// Causal factor → CAPA draft (one-click "turn this finding into an action")
// ──────────────────────────────────────────────────────────────────────────

// Seeds a corrective-action draft from a flagged causal factor. Shape
// matches IncidentActionCreateInput (see incidentAction.ts). The hierarchy
// is pre-filled from the causal factor's coding when the investigator set
// it, otherwise left null so the owner picks the strongest workable control.
export function buildCausalFactorActionDraft(opts: {
  title: string
  hierarchy_of_controls?: HierarchyOfControls | null
}): {
  action_type: 'corrective'
  description: string
  hierarchy_of_controls: HierarchyOfControls | null
} {
  const clean = (opts.title ?? '').trim()
  return {
    action_type: 'corrective',
    description: clean ? `Address causal factor: ${clean}` : 'Address identified causal factor',
    hierarchy_of_controls: opts.hierarchy_of_controls ?? null,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Pure chart layout — the geometry consumed by the SVG renderer + PDF export
// ──────────────────────────────────────────────────────────────────────────

// Minimal node shape the layout needs — decoupled from the full row so
// tests and the PDF path can build fixtures cheaply.
export type EcfaLayoutNode = Pick<
  EcfaNodeRow,
  'id' | 'node_type' | 'sequence_index' | 'parent_event_id' | 'lane'
  | 'title' | 'verification_status' | 'is_causal_factor' | 'cf_category'
>

export interface EcfaShape {
  id:          string
  kind:        EcfaNodeType
  x:           number
  y:           number
  w:           number
  h:           number
  label:       string
  dashed:      boolean               // presumptive / unverified
  highlighted: boolean               // flagged causal factor
  category:    CausalFactorCategory | null
}

export interface EcfaEdge {
  id:    string
  kind:  'sequence' | 'condition'
  fromX: number
  fromY: number
  toX:   number
  toY:   number
}

export interface EcfaGeometry {
  shapes: EcfaShape[]
  edges:  EcfaEdge[]
  width:  number
  height: number
}

// Layout constants (px). Kept here so the SVG + PDF renderers share them.
export const ECFA_LAYOUT = {
  margin:      24,
  eventW:      156,
  eventH:      66,
  gapX:        56,   // horizontal room between boxes (arrow lives here)
  incidentW:   132,
  incidentH:   96,
  condW:       148,
  condH:       54,
  condGap:     14,   // vertical gap between stacked conditions in a lane
  laneGap:     28,   // gap between an event box and the nearest condition
} as const

function orderEvents(nodes: EcfaLayoutNode[]): EcfaLayoutNode[] {
  return nodes
    .filter((n) => n.node_type === 'event')
    .slice()
    .sort((a, b) =>
      a.sequence_index !== b.sequence_index
        ? a.sequence_index - b.sequence_index
        : a.id.localeCompare(b.id),
    )
}

// Deterministic left→right timeline layout. Events sit on a horizontal
// centre line; conditions stack in their lane above/below the event they
// modify; the terminal incident is a diamond at the right end.
export function layoutEcfaChart(nodes: EcfaLayoutNode[]): EcfaGeometry {
  const C = ECFA_LAYOUT
  const rowH = C.condH + C.condGap

  const events = orderEvents(nodes)
  const incidents = nodes.filter((n) => n.node_type === 'incident')
  const incident = incidents.length ? incidents[incidents.length - 1] : null

  // Conditions grouped under their parent event, split by lane, order-stable.
  const eventIds = new Set(events.map((e) => e.id))
  const above = new Map<string, EcfaLayoutNode[]>()
  const below = new Map<string, EcfaLayoutNode[]>()
  for (const n of nodes) {
    if (n.node_type !== 'condition') continue
    if (!n.parent_event_id || !eventIds.has(n.parent_event_id)) continue // skip orphans
    const bucket = n.lane === 'below' ? below : above
    const list = bucket.get(n.parent_event_id) ?? []
    list.push(n)
    bucket.set(n.parent_event_id, list)
  }
  const stableByIndex = (a: EcfaLayoutNode, b: EcfaLayoutNode) =>
    a.sequence_index !== b.sequence_index
      ? a.sequence_index - b.sequence_index
      : a.id.localeCompare(b.id)
  for (const list of above.values()) list.sort(stableByIndex)
  for (const list of below.values()) list.sort(stableByIndex)

  const aboveMax = Math.max(0, ...events.map((e) => (above.get(e.id)?.length ?? 0)))
  const belowMax = Math.max(0, ...events.map((e) => (below.get(e.id)?.length ?? 0)))

  const topBand = aboveMax > 0 ? aboveMax * rowH + C.laneGap : 0
  const centerY = C.margin + topBand + C.eventH / 2
  const eventTop = centerY - C.eventH / 2
  const eventBottom = centerY + C.eventH / 2

  const shapes: EcfaShape[] = []
  const edges: EcfaEdge[] = []

  const xOf: number[] = []
  let cursorX = C.margin
  events.forEach((e, i) => {
    xOf[i] = cursorX
    shapes.push({
      id: e.id, kind: 'event',
      x: cursorX, y: eventTop, w: C.eventW, h: C.eventH,
      label: e.title,
      dashed: e.verification_status === 'presumptive',
      highlighted: e.is_causal_factor,
      category: e.cf_category,
    })

    // Conditions above (index 0 nearest the line, stacking upward).
    ;(above.get(e.id) ?? []).forEach((c, ci) => {
      const y = eventTop - C.laneGap - ci * rowH - C.condH
      const cx = cursorX + C.eventW / 2 - C.condW / 2
      shapes.push({
        id: c.id, kind: 'condition', x: cx, y, w: C.condW, h: C.condH,
        label: c.title,
        dashed: c.verification_status === 'presumptive',
        highlighted: c.is_causal_factor,
        category: c.cf_category,
      })
      edges.push({
        id: `c-${c.id}`, kind: 'condition',
        fromX: cursorX + C.eventW / 2, fromY: y + C.condH,
        toX: cursorX + C.eventW / 2, toY: eventTop,
      })
    })

    // Conditions below (index 0 nearest the line, stacking downward).
    ;(below.get(e.id) ?? []).forEach((c, ci) => {
      const y = eventBottom + C.laneGap + ci * rowH
      const cx = cursorX + C.eventW / 2 - C.condW / 2
      shapes.push({
        id: c.id, kind: 'condition', x: cx, y, w: C.condW, h: C.condH,
        label: c.title,
        dashed: c.verification_status === 'presumptive',
        highlighted: c.is_causal_factor,
        category: c.cf_category,
      })
      edges.push({
        id: `c-${c.id}`, kind: 'condition',
        fromX: cursorX + C.eventW / 2, fromY: y,
        toX: cursorX + C.eventW / 2, toY: eventBottom,
      })
    })

    // Sequence arrow to the next event.
    if (i < events.length - 1) {
      const nextX = cursorX + C.eventW + C.gapX
      edges.push({
        id: `s-${e.id}`, kind: 'sequence',
        fromX: cursorX + C.eventW, fromY: centerY, toX: nextX, toY: centerY,
      })
    }
    cursorX += C.eventW + C.gapX
  })

  // Terminal incident diamond after the last event.
  let rightEdge = events.length ? xOf[events.length - 1] + C.eventW : C.margin
  if (incident) {
    const ix = events.length ? cursorX : C.margin
    const iy = centerY - C.incidentH / 2
    if (events.length) {
      edges.push({
        id: `s-incident`, kind: 'sequence',
        fromX: xOf[events.length - 1] + C.eventW, fromY: centerY, toX: ix, toY: centerY,
      })
    }
    shapes.push({
      id: incident.id, kind: 'incident',
      x: ix, y: iy, w: C.incidentW, h: C.incidentH,
      label: incident.title,
      dashed: incident.verification_status === 'presumptive',
      highlighted: incident.is_causal_factor,
      category: incident.cf_category,
    })
    rightEdge = ix + C.incidentW
  }

  const belowBand = belowMax > 0 ? C.laneGap + belowMax * rowH : 0
  const width = Math.max(rightEdge + C.margin, C.margin * 2 + C.eventW)
  const height = centerY + C.eventH / 2 + belowBand + C.margin

  return { shapes, edges, width, height }
}

// ──────────────────────────────────────────────────────────────────────────
// Reorder / move math — the pure engine behind the drag-and-drop editor
// ──────────────────────────────────────────────────────────────────────────
//
// The editor moves nodes by dragging; these helpers turn a drop into the
// MINIMAL set of { id, patch } changes to persist. They renumber per
// (event, lane) bucket to match layoutEcfaChart, which sorts each bucket
// independently — so cross-lane sequence_index overlap is harmless and never
// needs reconciling. Every helper is pure + deterministic (same inputs →
// same patches) so the same math drives the optimistic UI update and the
// unit tests.

/** A node reduced to what ordering needs. */
type SeqNode = { id: string; sequence_index: number }

// Assign contiguous sequence_index (1-based by default) across an
// already-ordered list, returning ONLY the ids whose index actually changes.
// This is what keeps a drag from rewriting every sibling — an adjacent move on
// contiguous indices touches just the leapfrogged span.
export function renumberSequence<T extends SeqNode>(
  ordered: readonly T[],
  base = 1,
): Array<{ id: string; sequence_index: number }> {
  const out: Array<{ id: string; sequence_index: number }> = []
  ordered.forEach((n, i) => {
    const next = base + i
    if (n.sequence_index !== next) out.push({ id: n.id, sequence_index: next })
  })
  return out
}

// Reorder one flat list (the event sequence, or a single condition lane) by
// dropping `movedId` before/after `targetId`, then renumber. `current` is the
// list in its present display order. Returns the minimal sequence_index
// patches, or [] for a no-op (drop onto self, or unknown ids).
export function reorderNodes(
  current: readonly SeqNode[],
  movedId: string,
  targetId: string,
  position: 'before' | 'after',
): Array<{ id: string; patch: { sequence_index: number } }> {
  if (movedId === targetId) return []
  const moved = current.find((n) => n.id === movedId)
  if (!moved) return []
  const without = current.filter((n) => n.id !== movedId)
  const targetIdx = without.findIndex((n) => n.id === targetId)
  if (targetIdx === -1) return []
  const insertAt = position === 'before' ? targetIdx : targetIdx + 1
  const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)]
  return renumberSequence(next).map((c) => ({ id: c.id, patch: { sequence_index: c.sequence_index } }))
}

// Move a condition to a (possibly different) event / lane at a given insert
// index. Emits the moved node's changed structure fields (parent_event_id only
// when the event changes, lane only when the lane changes) plus the renumber
// of the destination lane and — when the node left its original lane — the
// compaction of the source lane. `siblings` lists EXCLUDE the moved node and
// are in display order. Merges to at most one patch per id; [] on a true
// no-op.
export function moveCondition(args: {
  moved: { id: string; parent_event_id: string | null; lane: EcfaLane | null; sequence_index: number }
  from:  { siblings: SeqNode[] }
  to:    { eventId: string; lane: EcfaLane; siblings: SeqNode[]; index: number }
}): Array<{ id: string; patch: EcfaNodePatchInput }> {
  const { moved, from, to } = args
  const sameLocation = to.eventId === moved.parent_event_id && to.lane === moved.lane

  const changes = new Map<string, EcfaNodePatchInput>()
  const put = (id: string, p: EcfaNodePatchInput) =>
    changes.set(id, { ...(changes.get(id) ?? {}), ...p })

  // Destination lane renumber, with the moved node spliced in at `index`.
  const clampedIndex = Math.max(0, Math.min(to.index, to.siblings.length))
  const destOrder: SeqNode[] = [
    ...to.siblings.slice(0, clampedIndex),
    { id: moved.id, sequence_index: moved.sequence_index },
    ...to.siblings.slice(clampedIndex),
  ]
  for (const c of renumberSequence(destOrder)) put(c.id, { sequence_index: c.sequence_index })

  // Source lane compaction (only when the node actually left it).
  if (!sameLocation) {
    for (const c of renumberSequence(from.siblings)) put(c.id, { sequence_index: c.sequence_index })
  }

  // The moved node's structural change — event/lane, only when they differ.
  const movedPatch: EcfaNodePatchInput = {}
  if (to.eventId !== moved.parent_event_id) movedPatch.parent_event_id = to.eventId
  if (to.lane !== moved.lane) movedPatch.lane = to.lane
  if (Object.keys(movedPatch).length > 0) put(moved.id, movedPatch)

  return [...changes.entries()].map(([id, patch]) => ({ id, patch }))
}

// Apply a change set optimistically to a node array (also the rollback aid).
// Pure: returns a new array; unknown ids are left untouched.
export function applyEcfaPatches(
  nodes: readonly EcfaNodeRow[],
  changes: ReadonlyArray<{ id: string; patch: Partial<EcfaNodeRow> }>,
): EcfaNodeRow[] {
  if (changes.length === 0) return nodes.slice()
  const byId = new Map(changes.map((c) => [c.id, c.patch]))
  return nodes.map((n) => {
    const p = byId.get(n.id)
    return p ? { ...n, ...p } : n
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Completeness / quality assessment (add-on 3; advisory)
// ──────────────────────────────────────────────────────────────────────────

export type EcfaCompletenessNode = Pick<
  EcfaNodeRow,
  'id' | 'node_type' | 'verification_status' | 'is_causal_factor' | 'cf_category'
>

export interface EcfaCompleteness {
  score:                    number      // 0..100 (advisory)
  issues:                   string[]
  eventCount:               number
  hasIncident:              boolean
  causalFactorCount:        number
  causalFactorsCoded:       number
  causalFactorsWithAction:  number
  presumptiveCount:         number
}

// Scores an ECFA against the CSP investigation rubric. Advisory only — the
// UI surfaces the gaps; it never blocks completion. Returns 0..100 with the
// specific issues to resolve.
export function assessEcfaCompleteness(opts: {
  nodes: EcfaCompletenessNode[]
  actionSourceEcfaIds: readonly string[]
}): EcfaCompleteness {
  const { nodes, actionSourceEcfaIds } = opts
  const withAction = new Set(actionSourceEcfaIds)

  const eventCount = nodes.filter((n) => n.node_type === 'event').length
  const hasIncident = nodes.some((n) => n.node_type === 'incident')
  const causalFactors = nodes.filter((n) => n.is_causal_factor)
  const causalFactorCount = causalFactors.length
  const causalFactorsCoded = causalFactors.filter((n) => n.cf_category != null).length
  const causalFactorsWithAction = causalFactors.filter((n) => withAction.has(n.id)).length
  const presumptiveCount = nodes.filter((n) => n.verification_status === 'presumptive').length

  const issues: string[] = []
  if (eventCount < 2) issues.push('Add at least two events to the primary sequence.')
  if (!hasIncident) issues.push('Add the terminal loss / incident node.')
  if (causalFactorCount === 0) issues.push('Flag at least one causal factor.')
  if (causalFactorCount > causalFactorsCoded)
    issues.push(`${causalFactorCount - causalFactorsCoded} causal factor(s) still need a category.`)
  if (causalFactorCount > causalFactorsWithAction)
    issues.push(`${causalFactorCount - causalFactorsWithAction} causal factor(s) have no corrective action yet.`)
  if (presumptiveCount > 0)
    issues.push(`${presumptiveCount} item(s) are still presumptive — verify or mark them.`)

  // Weighted rubric (structure + the two self-contained CSP loops).
  const cf = causalFactorCount
  const parts: number[] = [
    eventCount >= 2 ? 15 : 0,
    hasIncident ? 10 : 0,
    cf > 0 ? 20 : 0,
    cf > 0 ? 25 * (causalFactorsCoded / cf) : 0,
    cf > 0 ? 25 * (causalFactorsWithAction / cf) : 0,
    nodes.length > 0 ? 5 * ((nodes.length - presumptiveCount) / nodes.length) : 0,
  ]
  const score = Math.round(parts.reduce((a, b) => a + b, 0))

  return {
    score,
    issues,
    eventCount,
    hasIncident,
    causalFactorCount,
    causalFactorsCoded,
    causalFactorsWithAction,
    presumptiveCount,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Causal-factor trend summary (add-on 2; powers the scorecard panel)
// ──────────────────────────────────────────────────────────────────────────

export type CausalFactorSummaryNode = Pick<
  EcfaNodeRow,
  'is_causal_factor' | 'cf_category' | 'failed_barrier' | 'cf_hierarchy_control'
>

export interface CausalFactorSummary {
  total:        number
  byCategory:   Record<CausalFactorCategory, number>
  uncategorized: number
  byControl:    Record<HierarchyOfControls, number>
  noControl:    number
  withBarrier:  number
}

// Aggregates flagged causal factors into trendable buckets. Feeds the
// scorecard's "what kinds of causal factors recur / how strong are our
// fixes" panel — a systemic leading indicator.
export function summarizeCausalFactors(nodes: CausalFactorSummaryNode[]): CausalFactorSummary {
  const byCategory = Object.fromEntries(
    CAUSAL_FACTOR_CATEGORIES.map((c) => [c, 0]),
  ) as Record<CausalFactorCategory, number>
  const byControl = Object.fromEntries(
    HIERARCHY_OF_CONTROLS.map((h) => [h, 0]),
  ) as Record<HierarchyOfControls, number>

  let total = 0
  let uncategorized = 0
  let noControl = 0
  let withBarrier = 0

  for (const n of nodes) {
    if (!n.is_causal_factor) continue
    total++
    if (n.cf_category) byCategory[n.cf_category]++
    else uncategorized++
    if (n.cf_hierarchy_control) byControl[n.cf_hierarchy_control]++
    else noControl++
    if (n.failed_barrier && n.failed_barrier.trim()) withBarrier++
  }

  return { total, byCategory, uncategorized, byControl, noControl, withBarrier }
}

// Re-export the shared hierarchy-of-controls value maps + type so the ECFA
// UI + scorecard render consistent names without importing from two modules.
export { HIERARCHY_LABEL, HIERARCHY_OF_CONTROLS }
export type { HierarchyOfControls }
