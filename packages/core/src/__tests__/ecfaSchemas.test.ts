import { describe, it, expect } from 'vitest'
import {
  validateEcfaNode,
  layoutEcfaChart,
  buildCausalFactorActionDraft,
  assessEcfaCompleteness,
  summarizeCausalFactors,
  renumberSequence,
  reorderNodes,
  moveCondition,
  applyEcfaPatches,
  ECFA_LAYOUT,
  type EcfaLayoutNode,
  type EcfaCompletenessNode,
  type CausalFactorSummaryNode,
  type EcfaNodeRow,
} from '../ecfaSchemas'

// ── fixtures ────────────────────────────────────────────────────────────────

function ev(id: string, seq: number, extra: Partial<EcfaLayoutNode> = {}): EcfaLayoutNode {
  return {
    id, node_type: 'event', sequence_index: seq, parent_event_id: null, lane: null,
    title: `event ${id}`, verification_status: 'presumptive', is_causal_factor: false,
    cf_category: null, ...extra,
  }
}
function cond(id: string, parent: string, lane: 'above' | 'below', extra: Partial<EcfaLayoutNode> = {}): EcfaLayoutNode {
  return {
    id, node_type: 'condition', sequence_index: 0, parent_event_id: parent, lane,
    title: `condition ${id}`, verification_status: 'presumptive', is_causal_factor: false,
    cf_category: null, ...extra,
  }
}
function loss(id: string, extra: Partial<EcfaLayoutNode> = {}): EcfaLayoutNode {
  return {
    id, node_type: 'incident', sequence_index: 0, parent_event_id: null, lane: null,
    title: 'the loss', verification_status: 'verified', is_causal_factor: false,
    cf_category: null, ...extra,
  }
}

// ── validateEcfaNode ─────────────────────────────────────────────────────────

describe('validateEcfaNode', () => {
  it('accepts a well-formed event', () => {
    expect(validateEcfaNode({ node_type: 'event', title: 'Operator opened the door' })).toBeNull()
  })
  it('rejects a missing/blank title', () => {
    expect(validateEcfaNode({ node_type: 'event', title: '   ' })).toMatch(/title is required/)
  })
  it('rejects an unknown node_type', () => {
    expect(validateEcfaNode({ node_type: 'widget' as never, title: 'x' })).toMatch(/Invalid node_type/)
  })
  it('rejects an invalid causal-factor category', () => {
    expect(validateEcfaNode({ node_type: 'event', title: 'x', cf_category: 'nope' as never })).toMatch(/Invalid cf_category/)
  })
  it('rejects an invalid control level', () => {
    expect(validateEcfaNode({ node_type: 'event', title: 'x', cf_hierarchy_control: 'magic' as never })).toMatch(/cf_hierarchy_control/)
  })
})

// ── layoutEcfaChart ──────────────────────────────────────────────────────────

describe('layoutEcfaChart', () => {
  it('returns an empty geometry for no nodes', () => {
    const g = layoutEcfaChart([])
    expect(g.shapes).toHaveLength(0)
    expect(g.edges).toHaveLength(0)
    expect(g.width).toBeGreaterThan(0)
    expect(g.height).toBeGreaterThan(0)
  })

  it('lays events left→right on a single centre line and links them with sequence arrows', () => {
    const g = layoutEcfaChart([ev('b', 1), ev('a', 0), loss('L')])
    const events = g.shapes.filter(s => s.kind === 'event')
    expect(events.map(e => e.id)).toEqual(['a', 'b']) // sorted by sequence_index
    // strictly increasing x, shared y (centre line)
    expect(events[0].x).toBeLessThan(events[1].x)
    expect(events[0].y).toBe(events[1].y)
    // one diamond, positioned to the right of every event
    const diamond = g.shapes.find(s => s.kind === 'incident')!
    expect(diamond).toBeTruthy()
    expect(diamond.x).toBeGreaterThan(events[1].x)
    // two sequence edges: a→b and b→loss
    expect(g.edges.filter(e => e.kind === 'sequence')).toHaveLength(2)
  })

  it('uses fixed layout constants for the first event position', () => {
    const g = layoutEcfaChart([ev('a', 0)])
    const e = g.shapes[0]
    expect(e.x).toBe(ECFA_LAYOUT.margin)
    expect(e.w).toBe(ECFA_LAYOUT.eventW)
  })

  it('maps verification + causal-factor flags onto shape styling', () => {
    const g = layoutEcfaChart([
      ev('a', 0, { verification_status: 'verified' }),
      ev('b', 1, { verification_status: 'presumptive', is_causal_factor: true, cf_category: 'organisational_factors' }),
    ])
    const a = g.shapes.find(s => s.id === 'a')!
    const b = g.shapes.find(s => s.id === 'b')!
    expect(a.dashed).toBe(false)          // verified → solid
    expect(b.dashed).toBe(true)           // presumptive → dashed
    expect(b.highlighted).toBe(true)      // causal factor
    expect(b.category).toBe('organisational_factors')
  })

  it('stacks a condition above its event, adds a connector, and grows the canvas', () => {
    const base = layoutEcfaChart([ev('a', 0)])
    const withCond = layoutEcfaChart([ev('a', 0), cond('c', 'a', 'above')])
    expect(withCond.shapes.some(s => s.kind === 'condition')).toBe(true)
    expect(withCond.edges.some(e => e.kind === 'condition')).toBe(true)
    // reserving a lane above pushes the event line (and the whole canvas) down
    const eventBase = base.shapes[0]
    const eventWith = withCond.shapes.find(s => s.id === 'a')!
    expect(eventWith.y).toBeGreaterThan(eventBase.y)
    expect(withCond.height).toBeGreaterThan(base.height)
  })

  it('drops conditions whose parent event is missing (defensive)', () => {
    const g = layoutEcfaChart([cond('orphan', 'ghost', 'below')])
    expect(g.shapes).toHaveLength(0)
  })
})

// ── buildCausalFactorActionDraft ─────────────────────────────────────────────

describe('buildCausalFactorActionDraft', () => {
  it('seeds a corrective action from the causal-factor title, passing hierarchy through', () => {
    const d = buildCausalFactorActionDraft({ title: 'guard interlock bypassed', hierarchy_of_controls: 'engineering' })
    expect(d.action_type).toBe('corrective')
    expect(d.description).toContain('guard interlock bypassed')
    expect(d.hierarchy_of_controls).toBe('engineering')
  })
  it('defaults hierarchy to null and handles blank titles', () => {
    const d = buildCausalFactorActionDraft({ title: '  ' })
    expect(d.hierarchy_of_controls).toBeNull()
    expect(d.description.length).toBeGreaterThan(0)
  })
})

// ── assessEcfaCompleteness ───────────────────────────────────────────────────

function cn(id: string, extra: Partial<EcfaCompletenessNode>): EcfaCompletenessNode {
  return { id, node_type: 'event', verification_status: 'verified', is_causal_factor: false, cf_category: null, ...extra }
}

describe('assessEcfaCompleteness', () => {
  it('scores a complete, coded, actioned investigation highly with no issues', () => {
    const nodes: EcfaCompletenessNode[] = [
      cn('e1', {}), cn('e2', {}),
      cn('loss', { node_type: 'incident' }),
      cn('cf', { is_causal_factor: true, cf_category: 'task_environmental_conditions' }),
    ]
    const r = assessEcfaCompleteness({ nodes, actionSourceEcfaIds: ['cf'] })
    expect(r.causalFactorCount).toBe(1)
    expect(r.causalFactorsWithAction).toBe(1)
    expect(r.issues).toHaveLength(0)
    expect(r.score).toBe(100)
  })

  it('flags a missing incident, no causal factors, and a low score', () => {
    const r = assessEcfaCompleteness({ nodes: [cn('e1', {}), cn('e2', {})], actionSourceEcfaIds: [] })
    expect(r.hasIncident).toBe(false)
    expect(r.issues.join(' ')).toMatch(/loss \/ incident/)
    expect(r.issues.join(' ')).toMatch(/causal factor/)
    expect(r.score).toBeLessThan(50)
  })

  it('flags causal factors that are uncoded or have no action', () => {
    const nodes: EcfaCompletenessNode[] = [
      cn('e1', {}), cn('e2', {}), cn('loss', { node_type: 'incident' }),
      cn('cf', { is_causal_factor: true, cf_category: null }),
    ]
    const r = assessEcfaCompleteness({ nodes, actionSourceEcfaIds: [] })
    expect(r.issues.join(' ')).toMatch(/need a category/)
    expect(r.issues.join(' ')).toMatch(/no corrective action/)
    expect(r.score).toBeLessThan(100)
  })
})

// ── summarizeCausalFactors ───────────────────────────────────────────────────

function sn(extra: Partial<CausalFactorSummaryNode>): CausalFactorSummaryNode {
  return { is_causal_factor: true, cf_category: null, failed_barrier: null, cf_hierarchy_control: null, ...extra }
}

describe('summarizeCausalFactors', () => {
  it('buckets flagged factors by category + control and counts barriers, ignoring non-factors', () => {
    const s = summarizeCausalFactors([
      sn({ cf_category: 'organisational_factors', cf_hierarchy_control: 'engineering', failed_barrier: 'interlock' }),
      sn({ cf_category: 'organisational_factors', cf_hierarchy_control: 'ppe' }),
      sn({ cf_category: null }),                                   // counts as uncategorized + noControl
      sn({ is_causal_factor: false, cf_category: 'individual_team_actions' }), // ignored
    ])
    expect(s.total).toBe(3)
    expect(s.byCategory.organisational_factors).toBe(2)
    expect(s.uncategorized).toBe(1)
    expect(s.byControl.engineering).toBe(1)
    expect(s.byControl.ppe).toBe(1)
    expect(s.noControl).toBe(1)
    expect(s.withBarrier).toBe(1)
  })

  it('returns all-zero buckets for no causal factors', () => {
    const s = summarizeCausalFactors([])
    expect(s.total).toBe(0)
    expect(s.uncategorized).toBe(0)
  })
})

// ── reorder / move helpers (drag-and-drop engine) ────────────────────────────

describe('renumberSequence', () => {
  it('returns only the ids whose index actually changed', () => {
    expect(renumberSequence([
      { id: 'a', sequence_index: 1 },
      { id: 'b', sequence_index: 5 }, // → 2
      { id: 'c', sequence_index: 3 }, // → 3 (unchanged)
    ])).toEqual([{ id: 'b', sequence_index: 2 }])
  })
  it('normalizes gappy indices to a contiguous 1..N run', () => {
    expect(renumberSequence([
      { id: 'a', sequence_index: 2 },
      { id: 'b', sequence_index: 5 },
      { id: 'c', sequence_index: 8 },
    ])).toEqual([
      { id: 'a', sequence_index: 1 },
      { id: 'b', sequence_index: 2 },
      { id: 'c', sequence_index: 3 },
    ])
  })
  it('honours a custom base', () => {
    expect(renumberSequence([{ id: 'a', sequence_index: 0 }], 1)).toEqual([{ id: 'a', sequence_index: 1 }])
  })
})

describe('reorderNodes', () => {
  const list = [
    { id: 'a', sequence_index: 1 }, { id: 'b', sequence_index: 2 },
    { id: 'c', sequence_index: 3 }, { id: 'd', sequence_index: 4 },
    { id: 'e', sequence_index: 5 },
  ]
  const byId = (out: Array<{ id: string; patch: { sequence_index: number } }>) =>
    Object.fromEntries(out.map(o => [o.id, o.patch.sequence_index]))

  it('moves an item and touches only the leapfrogged span', () => {
    expect(byId(reorderNodes(list, 'a', 'c', 'after'))).toEqual({ b: 1, c: 2, a: 3 }) // [b,c,a,d,e]
  })
  it('handles an adjacent swap minimally', () => {
    expect(byId(reorderNodes(list, 'b', 'c', 'after'))).toEqual({ c: 2, b: 3 }) // [a,c,b,d,e]
  })
  it('is a no-op when dropping onto itself', () => {
    expect(reorderNodes(list, 'a', 'a', 'before')).toEqual([])
  })
  it('returns [] for unknown moved or target ids', () => {
    expect(reorderNodes(list, 'ghost', 'c', 'after')).toEqual([])
    expect(reorderNodes(list, 'a', 'ghost', 'after')).toEqual([])
  })
})

describe('moveCondition', () => {
  const sib = (id: string, i: number) => ({ id, sequence_index: i })
  const patchOf = (changes: Array<{ id: string; patch: Record<string, unknown> }>, id: string) =>
    changes.find(c => c.id === id)?.patch

  it('reorders within the same lane without a structural patch', () => {
    const changes = moveCondition({
      moved: { id: 'c1', parent_event_id: 'e1', lane: 'below', sequence_index: 1 },
      from: { siblings: [sib('c2', 2), sib('c3', 3)] },
      to:   { eventId: 'e1', lane: 'below', siblings: [sib('c2', 2), sib('c3', 3)], index: 2 },
    })
    const moved = patchOf(changes, 'c1')!
    expect(moved.parent_event_id).toBeUndefined()
    expect(moved.lane).toBeUndefined()
    expect(Object.fromEntries(changes.map(c => [c.id, c.patch.sequence_index])))
      .toMatchObject({ c2: 1, c3: 2, c1: 3 })
  })

  it('flips the lane within the same event (lane patch, no re-parent)', () => {
    const changes = moveCondition({
      moved: { id: 'c1', parent_event_id: 'e1', lane: 'below', sequence_index: 1 },
      from: { siblings: [sib('c2', 2)] },
      to:   { eventId: 'e1', lane: 'above', siblings: [sib('c9', 1)], index: 1 },
    })
    const moved = patchOf(changes, 'c1')!
    expect(moved.lane).toBe('above')
    expect(moved.parent_event_id).toBeUndefined()
    expect(patchOf(changes, 'c2')?.sequence_index).toBe(1) // source lane compacted
  })

  it('re-parents to a different event and appends into its empty lane', () => {
    const changes = moveCondition({
      moved: { id: 'c1', parent_event_id: 'e1', lane: 'below', sequence_index: 3 },
      from: { siblings: [] },
      to:   { eventId: 'e2', lane: 'above', siblings: [], index: 0 },
    })
    expect(patchOf(changes, 'c1')).toMatchObject({ parent_event_id: 'e2', lane: 'above', sequence_index: 1 })
  })
})

describe('applyEcfaPatches', () => {
  const row = (id: string, extra: Partial<EcfaNodeRow> = {}): EcfaNodeRow => ({
    id, tenant_id: 't', investigation_id: 'i', node_type: 'condition', sequence_index: 0,
    parent_event_id: 'e1', lane: 'below', title: id, description: null, occurred_at: null,
    verification_status: 'presumptive', is_causal_factor: false, cf_category: null,
    failed_barrier: null, cf_hierarchy_control: null, created_at: '', updated_at: '', ...extra,
  })

  it('merges patches by id, leaves others, and returns a new array', () => {
    const nodes = [row('a', { sequence_index: 1 }), row('b', { sequence_index: 2 })]
    const out = applyEcfaPatches(nodes, [{ id: 'b', patch: { sequence_index: 9, lane: 'above' } }])
    expect(out).not.toBe(nodes)
    const b = out.find(n => n.id === 'b')!
    expect(b.sequence_index).toBe(9)
    expect(b.lane).toBe('above')
    expect(out.find(n => n.id === 'a')!.sequence_index).toBe(1)
  })
  it('ignores unknown ids', () => {
    const out = applyEcfaPatches([row('a')], [{ id: 'ghost', patch: { sequence_index: 5 } }])
    expect(out.map(n => n.id)).toEqual(['a'])
  })
})
