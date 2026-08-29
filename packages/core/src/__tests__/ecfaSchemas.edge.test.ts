import { describe, it, expect } from 'vitest'
import {
  validateEcfaNode,
  layoutEcfaChart,
  buildCausalFactorActionDraft,
  summarizeCausalFactors,
  renumberSequence,
  reorderNodes,
  moveCondition,
  applyEcfaPatches,
  ECFA_LAYOUT,
  CAUSAL_FACTOR_CATEGORIES,
  ECFA_LANES,
  ECFA_VERIFICATION,
  HIERARCHY_OF_CONTROLS,
  type EcfaLayoutNode,
  type EcfaNodeRow,
  type EcfaLane,
} from '../ecfaSchemas'

// Edge-case coverage for the ECFA drag-and-drop engine + validators (v1.16.0).
// The happy paths live in ecfaSchemas.test.ts; this file hammers the
// boundaries the skill checklist calls out: empty / single / max input,
// numeric boundaries, every enum value, unicode + special characters, null vs
// missing fields, index clamping, and the "minimal patch" contract that keeps
// a drag from rewriting siblings it did not move.

// ── fixtures ────────────────────────────────────────────────────────────────

function ev(id: string, seq: number, extra: Partial<EcfaLayoutNode> = {}): EcfaLayoutNode {
  return {
    id, node_type: 'event', sequence_index: seq, parent_event_id: null, lane: null,
    title: `event ${id}`, verification_status: 'presumptive', is_causal_factor: false,
    cf_category: null, ...extra,
  }
}
function cond(id: string, parent: string, lane: EcfaLane | null, extra: Partial<EcfaLayoutNode> = {}): EcfaLayoutNode {
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
const sib = (id: string, i: number) => ({ id, sequence_index: i })
const patchOf = (changes: Array<{ id: string; patch: Record<string, unknown> }>, id: string) =>
  changes.find(c => c.id === id)?.patch

// ── validateEcfaNode — boundaries, enums, unicode ────────────────────────────

describe('validateEcfaNode — title boundaries', () => {
  it('accepts a title at exactly the 300-char cap', () => {
    expect(validateEcfaNode({ node_type: 'event', title: 'a'.repeat(300) })).toBeNull()
  })
  it('rejects a title one character over the cap', () => {
    expect(validateEcfaNode({ node_type: 'event', title: 'a'.repeat(301) }))
      .toMatch(/300 characters or fewer/)
  })
  it('accepts a single-character title', () => {
    expect(validateEcfaNode({ node_type: 'event', title: 'x' })).toBeNull()
  })
  it('trims surrounding whitespace before the empty check', () => {
    expect(validateEcfaNode({ node_type: 'event', title: '   ok   ' })).toBeNull()
  })
  it('rejects tabs-and-newlines-only as blank', () => {
    expect(validateEcfaNode({ node_type: 'event', title: '\t\n  \r' })).toMatch(/title is required/)
  })
  it('accepts unicode subscripts (H₂S / O₂) that would break naive PDF encoders', () => {
    expect(validateEcfaNode({ node_type: 'condition', title: 'Released H₂S near the O₂ line' })).toBeNull()
  })
  it('accepts emoji and CJK titles', () => {
    expect(validateEcfaNode({ node_type: 'event', title: '💥 爆発 explosion' })).toBeNull()
  })
  it('accepts quotes, newlines and tabs inside an otherwise valid title', () => {
    expect(validateEcfaNode({ node_type: 'event', title: `He said "stop"\tthen 'left'` })).toBeNull()
  })
})

describe('validateEcfaNode — enum coverage', () => {
  it('rejects a missing node_type', () => {
    expect(validateEcfaNode({ title: 'x' })).toMatch(/Invalid node_type/)
  })
  it('accepts every node_type', () => {
    for (const t of ['event', 'condition', 'incident'] as const)
      expect(validateEcfaNode({ node_type: t, title: 'x' })).toBeNull()
  })
  it('accepts every lane and rejects an unknown one', () => {
    for (const l of ECFA_LANES) expect(validateEcfaNode({ node_type: 'condition', title: 'x', lane: l })).toBeNull()
    expect(validateEcfaNode({ node_type: 'condition', title: 'x', lane: 'sideways' as never })).toMatch(/Invalid lane/)
  })
  it('accepts every verification_status and rejects an unknown one', () => {
    for (const v of ECFA_VERIFICATION) expect(validateEcfaNode({ node_type: 'event', title: 'x', verification_status: v })).toBeNull()
    expect(validateEcfaNode({ node_type: 'event', title: 'x', verification_status: 'maybe' as never }))
      .toMatch(/Invalid verification_status/)
  })
  it('accepts every causal-factor category', () => {
    for (const c of CAUSAL_FACTOR_CATEGORIES)
      expect(validateEcfaNode({ node_type: 'event', title: 'x', cf_category: c })).toBeNull()
  })
  it('accepts every hierarchy-of-controls level', () => {
    for (const h of HIERARCHY_OF_CONTROLS)
      expect(validateEcfaNode({ node_type: 'event', title: 'x', cf_hierarchy_control: h })).toBeNull()
  })
})

// ── renumberSequence — empty / single / large / negative ─────────────────────

describe('renumberSequence — boundaries', () => {
  it('returns [] for an empty list', () => {
    expect(renumberSequence([])).toEqual([])
  })
  it('returns [] when a single node is already at base', () => {
    expect(renumberSequence([{ id: 'a', sequence_index: 1 }])).toEqual([])
  })
  it('renumbers a single out-of-place node', () => {
    expect(renumberSequence([{ id: 'a', sequence_index: 5 }])).toEqual([{ id: 'a', sequence_index: 1 }])
  })
  it('supports a 0-based base', () => {
    expect(renumberSequence([{ id: 'a', sequence_index: 1 }, { id: 'b', sequence_index: 2 }], 0))
      .toEqual([{ id: 'a', sequence_index: 0 }, { id: 'b', sequence_index: 1 }])
  })
  it('normalizes negative / zero indices to a contiguous 1..N run', () => {
    expect(renumberSequence([
      { id: 'a', sequence_index: -3 },
      { id: 'b', sequence_index: 0 },
      { id: 'c', sequence_index: 2 },
    ])).toEqual([
      { id: 'a', sequence_index: 1 },
      { id: 'b', sequence_index: 2 },
      { id: 'c', sequence_index: 3 },
    ])
  })
  it('touches nothing when a large list is already contiguous', () => {
    const list = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, sequence_index: i + 1 }))
    expect(renumberSequence(list)).toEqual([])
  })
  it('emits every id when the list is fully reversed', () => {
    const list = [
      { id: 'a', sequence_index: 3 },
      { id: 'b', sequence_index: 2 },
      { id: 'c', sequence_index: 1 },
    ]
    // a→1 and c→3 change; b→2 is unchanged.
    expect(renumberSequence(list)).toEqual([
      { id: 'a', sequence_index: 1 },
      { id: 'c', sequence_index: 3 },
    ])
  })
})

// ── reorderNodes — positions, ends, no-ops ───────────────────────────────────

describe('reorderNodes — edges', () => {
  const list = [
    { id: 'a', sequence_index: 1 }, { id: 'b', sequence_index: 2 },
    { id: 'c', sequence_index: 3 }, { id: 'd', sequence_index: 4 },
  ]
  const byId = (out: Array<{ id: string; patch: { sequence_index: number } }>) =>
    Object.fromEntries(out.map(o => [o.id, o.patch.sequence_index]))

  it('moves an item to the very front', () => {
    expect(byId(reorderNodes(list, 'd', 'a', 'before'))).toEqual({ d: 1, a: 2, b: 3, c: 4 })
  })
  it('moves an item to the very end', () => {
    expect(byId(reorderNodes(list, 'a', 'd', 'after'))).toEqual({ b: 1, c: 2, d: 3, a: 4 })
  })
  it('moves an item backward (later → earlier)', () => {
    expect(byId(reorderNodes(list, 'd', 'b', 'before'))).toEqual({ b: 3, c: 4, d: 2 }) // [a,d,b,c]
  })
  it('before vs after on the same target differ', () => {
    const before = byId(reorderNodes(list, 'a', 'c', 'before')) // [b,a,c,d]
    const after = byId(reorderNodes(list, 'a', 'c', 'after'))   // [b,c,a,d]
    expect(before).not.toEqual(after)
  })
  it('is a no-op dropping onto self', () => {
    expect(reorderNodes(list, 'b', 'b', 'after')).toEqual([])
  })
  it('returns [] for a single-element list dropped on itself', () => {
    expect(reorderNodes([{ id: 'solo', sequence_index: 1 }], 'solo', 'solo', 'before')).toEqual([])
  })
  it('returns [] for unknown moved or target ids', () => {
    expect(reorderNodes(list, 'ghost', 'a', 'after')).toEqual([])
    expect(reorderNodes(list, 'a', 'ghost', 'after')).toEqual([])
  })
})

// ── moveCondition — clamping + the minimal-patch contract ────────────────────

describe('moveCondition — index clamping', () => {
  it('clamps an over-large index to the end of the destination lane', () => {
    const changes = moveCondition({
      moved: { id: 'm', parent_event_id: 'e2', lane: 'above', sequence_index: 5 },
      from: { siblings: [] },
      to: { eventId: 'e1', lane: 'below', siblings: [sib('c2', 1), sib('c3', 2)], index: 99 },
    })
    expect(patchOf(changes, 'm')).toMatchObject({ parent_event_id: 'e1', lane: 'below', sequence_index: 3 })
  })
  it('clamps a negative index to the front of the destination lane', () => {
    const changes = moveCondition({
      moved: { id: 'm', parent_event_id: 'e2', lane: 'above', sequence_index: 5 },
      from: { siblings: [] },
      to: { eventId: 'e1', lane: 'below', siblings: [sib('c2', 1)], index: -5 },
    })
    expect(patchOf(changes, 'm')?.sequence_index).toBe(1)
    expect(patchOf(changes, 'c2')?.sequence_index).toBe(2)
  })
})

describe('moveCondition — minimal patches', () => {
  it('emits no sequence_index for the moved node when its index is unchanged', () => {
    // Move into an empty lane at index 0; the node already carries seq 1, so
    // only its structural (event + lane) fields should change.
    const changes = moveCondition({
      moved: { id: 'm', parent_event_id: 'e1', lane: 'below', sequence_index: 1 },
      from: { siblings: [] },
      to: { eventId: 'e2', lane: 'above', siblings: [], index: 0 },
    })
    const p = patchOf(changes, 'm')!
    expect(p).toEqual({ parent_event_id: 'e2', lane: 'above' })
    expect('sequence_index' in p).toBe(false)
  })
  it('emits at most one merged patch per id', () => {
    const changes = moveCondition({
      moved: { id: 'm', parent_event_id: 'e1', lane: 'below', sequence_index: 9 },
      from: { siblings: [sib('s1', 1), sib('s2', 2)] },
      to: { eventId: 'e2', lane: 'above', siblings: [sib('d1', 1)], index: 0 },
    })
    const ids = changes.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length) // no id appears twice
    // moved lands at front of dest → seq 1, plus the structural change.
    expect(patchOf(changes, 'm')).toMatchObject({ parent_event_id: 'e2', lane: 'above', sequence_index: 1 })
  })
  it('compacts the source lane only when the node actually leaves it', () => {
    // Source had a gap (s1 at 2, s2 at 4) → compacts to 1,2 once the node leaves.
    const changes = moveCondition({
      moved: { id: 'm', parent_event_id: 'e1', lane: 'below', sequence_index: 1 },
      from: { siblings: [sib('s1', 2), sib('s2', 4)] },
      to: { eventId: 'e2', lane: 'below', siblings: [], index: 0 },
    })
    expect(patchOf(changes, 's1')?.sequence_index).toBe(1)
    expect(patchOf(changes, 's2')?.sequence_index).toBe(2)
  })
  it('does not re-parent or re-lane on a pure same-lane reorder', () => {
    const changes = moveCondition({
      moved: { id: 'm', parent_event_id: 'e1', lane: 'below', sequence_index: 1 },
      from: { siblings: [sib('s1', 2)] },
      to: { eventId: 'e1', lane: 'below', siblings: [sib('s1', 2)], index: 1 },
    })
    const p = patchOf(changes, 'm')
    expect(p?.parent_event_id).toBeUndefined()
    expect(p?.lane).toBeUndefined()
  })
  it('is effectively a no-op set when nothing moves', () => {
    // Drop back exactly where it was: same lane, index rebuilds the same order.
    const changes = moveCondition({
      moved: { id: 'm', parent_event_id: 'e1', lane: 'below', sequence_index: 1 },
      from: { siblings: [sib('s1', 2)] },
      to: { eventId: 'e1', lane: 'below', siblings: [sib('s1', 2)], index: 0 },
    })
    // m stays at index 0 (seq 1, unchanged), s1 stays at seq 2→ renumber to 2 (unchanged).
    expect(changes).toEqual([])
  })
})

// ── applyEcfaPatches — identity, merge, unknowns ─────────────────────────────

describe('applyEcfaPatches — edges', () => {
  const row = (id: string, extra: Partial<EcfaNodeRow> = {}): EcfaNodeRow => ({
    id, tenant_id: 't', investigation_id: 'i', node_type: 'condition', sequence_index: 0,
    parent_event_id: 'e1', lane: 'below', title: id, description: null, occurred_at: null,
    verification_status: 'presumptive', is_causal_factor: false, cf_category: null,
    failed_barrier: null, cf_hierarchy_control: null, created_at: '', updated_at: '', ...extra,
  })

  it('returns a fresh copy (not the same reference) when changes are empty', () => {
    const nodes = [row('a')]
    const out = applyEcfaPatches(nodes, [])
    expect(out).not.toBe(nodes)
    expect(out).toEqual(nodes)
  })
  it('applies several patches in one pass and preserves order', () => {
    const nodes = [row('a', { sequence_index: 1 }), row('b', { sequence_index: 2 }), row('c', { sequence_index: 3 })]
    const out = applyEcfaPatches(nodes, [
      { id: 'c', patch: { sequence_index: 1 } },
      { id: 'a', patch: { sequence_index: 3 } },
    ])
    expect(out.map(n => n.id)).toEqual(['a', 'b', 'c']) // array order is stable
    expect(out.find(n => n.id === 'a')!.sequence_index).toBe(3)
    expect(out.find(n => n.id === 'c')!.sequence_index).toBe(1)
  })
  it('merges a partial patch without dropping untouched fields', () => {
    const [out] = applyEcfaPatches([row('a', { lane: 'below', title: 'keep' })], [{ id: 'a', patch: { lane: 'above' } }])
    expect(out.lane).toBe('above')
    expect(out.title).toBe('keep')
  })
  it('ignores unknown ids and leaves every row intact', () => {
    const nodes = [row('a'), row('b')]
    const out = applyEcfaPatches(nodes, [{ id: 'ghost', patch: { sequence_index: 9 } }])
    expect(out.map(n => n.id)).toEqual(['a', 'b'])
    expect(out.every((n, i) => n.sequence_index === nodes[i].sequence_index)).toBe(true)
  })
})

// ── layoutEcfaChart — bands, null lane, incident-only, passthrough ───────────

describe('layoutEcfaChart — structural edges', () => {
  it('reserves a below-band and grows the canvas for below-lane conditions', () => {
    const base = layoutEcfaChart([ev('a', 0)])
    const withBelow = layoutEcfaChart([ev('a', 0), cond('c', 'a', 'below')])
    expect(withBelow.shapes.some(s => s.kind === 'condition')).toBe(true)
    expect(withBelow.height).toBeGreaterThan(base.height)
    // a below condition does NOT push the event line down (that is the above band's job)
    expect(withBelow.shapes.find(s => s.id === 'a')!.y).toBe(base.shapes[0].y)
  })
  it('places conditions both above and below the same event', () => {
    const g = layoutEcfaChart([ev('a', 0), cond('up', 'a', 'above'), cond('dn', 'a', 'below')])
    const up = g.shapes.find(s => s.id === 'up')!
    const dn = g.shapes.find(s => s.id === 'dn')!
    const a = g.shapes.find(s => s.id === 'a')!
    expect(up.y).toBeLessThan(a.y)      // above the event
    expect(dn.y).toBeGreaterThan(a.y)   // below the event
  })
  it('treats a null-lane condition as the above lane (matches the editor default fallback)', () => {
    const base = layoutEcfaChart([ev('a', 0)])
    const g = layoutEcfaChart([ev('a', 0), cond('c', 'a', null)])
    expect(g.shapes.some(s => s.id === 'c')).toBe(true)
    expect(g.shapes.find(s => s.id === 'a')!.y).toBeGreaterThan(base.shapes[0].y) // above band reserved
  })
  it('renders an incident-only chart with a single diamond at the left margin', () => {
    const g = layoutEcfaChart([loss('L')])
    const diamonds = g.shapes.filter(s => s.kind === 'incident')
    expect(diamonds).toHaveLength(1)
    expect(diamonds[0].x).toBe(ECFA_LAYOUT.margin)
    expect(g.edges).toHaveLength(0) // nothing to connect
  })
  it('keeps only the last incident when several are present (defensive)', () => {
    const g = layoutEcfaChart([ev('a', 0), loss('L1'), loss('L2')])
    const diamonds = g.shapes.filter(s => s.kind === 'incident')
    expect(diamonds).toHaveLength(1)
    expect(diamonds[0].id).toBe('L2')
  })
  it('passes long labels through untouched (wrapping is the renderer\'s job)', () => {
    const long = 'A very long event title that far exceeds any single line budget the SVG renderer would wrap onto'
    const g = layoutEcfaChart([ev('a', 0, { title: long })])
    expect(g.shapes[0].label).toBe(long)
  })
  it('orders same-sequence conditions deterministically by id', () => {
    const g = layoutEcfaChart([
      ev('e', 0),
      cond('z', 'e', 'above', { sequence_index: 1 }),
      cond('a', 'e', 'above', { sequence_index: 1 }),
    ])
    const a = g.shapes.find(s => s.id === 'a')!
    const z = g.shapes.find(s => s.id === 'z')!
    // id 'a' sorts first → sits at lane index 0, nearest the event line (larger y)
    expect(a.y).toBeGreaterThan(z.y)
  })
})

// ── summarizeCausalFactors — barrier trim + full spread ──────────────────────

describe('summarizeCausalFactors — edges', () => {
  it('does not count a whitespace-only failed_barrier', () => {
    const s = summarizeCausalFactors([
      { is_causal_factor: true, cf_category: null, failed_barrier: '   ', cf_hierarchy_control: null },
    ])
    expect(s.total).toBe(1)
    expect(s.withBarrier).toBe(0)
  })
  it('buckets across every category and control level', () => {
    const nodes = [
      ...CAUSAL_FACTOR_CATEGORIES.map(c => ({ is_causal_factor: true, cf_category: c, failed_barrier: null, cf_hierarchy_control: null })),
      ...HIERARCHY_OF_CONTROLS.map(h => ({ is_causal_factor: true, cf_category: null, failed_barrier: null, cf_hierarchy_control: h })),
    ]
    const s = summarizeCausalFactors(nodes)
    expect(s.total).toBe(CAUSAL_FACTOR_CATEGORIES.length + HIERARCHY_OF_CONTROLS.length)
    for (const c of CAUSAL_FACTOR_CATEGORIES) expect(s.byCategory[c]).toBe(1)
    for (const h of HIERARCHY_OF_CONTROLS) expect(s.byControl[h]).toBe(1)
    expect(s.uncategorized).toBe(HIERARCHY_OF_CONTROLS.length) // the control-only rows have no category
  })
})

// ── buildCausalFactorActionDraft — special characters ────────────────────────

describe('buildCausalFactorActionDraft — special characters', () => {
  it('preserves unicode + quotes in the seeded description', () => {
    const d = buildCausalFactorActionDraft({ title: `guard "interlock" bypassed — O₂ sensor` })
    expect(d.description).toContain(`guard "interlock" bypassed — O₂ sensor`)
    expect(d.action_type).toBe('corrective')
  })
})
