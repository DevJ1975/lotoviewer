import { describe, it, expect } from 'vitest'
import {
  validateEcfaNode,
  layoutEcfaChart,
  buildCausalFactorActionDraft,
  assessEcfaCompleteness,
  summarizeCausalFactors,
  ECFA_LAYOUT,
  type EcfaLayoutNode,
  type EcfaCompletenessNode,
  type CausalFactorSummaryNode,
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
