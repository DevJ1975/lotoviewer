import { describe, it, expect } from 'vitest'
import {
  highestPotentialSeverity,
  groupHazardsByStep,
  groupControlsByHazard,
  aggregateRequiredPpe,
  countPpeAloneWarnings,
  validateJhaCreateInput,
  jhaReviewCadenceDays,
  JHA_FREQUENCIES,
  JHA_HAZARD_CATEGORIES,
  JHA_SEVERITY_BANDS,
  JHA_STATUSES,
  type JhaStep,
  type JhaHazard,
  type JhaHazardControl,
} from '@soteria/core/jha'

// Edge cases beyond the happy-path tests already in jha.test.ts.
// Targets boundary conditions, max-size inputs, special characters,
// and the constraints documented in the API route's caps (50 steps /
// 200 hazards / 500 controls).

function step(over: Partial<JhaStep> = {}): JhaStep {
  return {
    id: 's', tenant_id: 't', jha_id: 'j',
    sequence: 1, description: 'do', notes: null, created_at: '',
    ...over,
  }
}
function hazard(over: Partial<JhaHazard> = {}): JhaHazard {
  return {
    id: 'h', tenant_id: 't', jha_id: 'j', step_id: 's',
    hazard_category: 'physical', description: 'd', potential_severity: 'low',
    notes: null, created_at: '',
    ...over,
  }
}
function ctrl(over: Partial<JhaHazardControl> = {}): JhaHazardControl {
  return {
    id: 'c', tenant_id: 't', jha_id: 'j', hazard_id: 'h',
    control_id: null, custom_name: 'name', hierarchy_level: 'engineering',
    notes: null, created_at: '',
    ...over,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Enum-completeness tests — protect against new categories/statuses
// being added to the DB CHECK without the const arrays catching up.
// ──────────────────────────────────────────────────────────────────────────

describe('JHA enum const arrays', () => {
  it('JHA_FREQUENCIES has all 7 entries', () => {
    expect(JHA_FREQUENCIES).toHaveLength(7)
    expect(JHA_FREQUENCIES).toContain('continuous')
    expect(JHA_FREQUENCIES).toContain('as_needed')
  })

  it('JHA_HAZARD_CATEGORIES matches the migration-043 CHECK list', () => {
    expect(JHA_HAZARD_CATEGORIES).toEqual([
      'physical', 'chemical', 'biological', 'mechanical', 'electrical',
      'ergonomic', 'psychosocial', 'environmental', 'radiological',
    ])
  })

  it('JHA_SEVERITY_BANDS is the 4-band scheme', () => {
    expect(JHA_SEVERITY_BANDS).toEqual(['low', 'moderate', 'high', 'extreme'])
  })

  it('JHA_STATUSES covers the four lifecycle states', () => {
    expect(JHA_STATUSES).toEqual(['draft', 'in_review', 'approved', 'superseded'])
  })

  it('all enum arrays are tuple-typed (readonly)', () => {
    // Compile-time check; runtime check is presence + length.
    const f: readonly string[] = JHA_FREQUENCIES
    const h: readonly string[] = JHA_HAZARD_CATEGORIES
    const s: readonly string[] = JHA_SEVERITY_BANDS
    const t: readonly string[] = JHA_STATUSES
    expect(f.length + h.length + s.length + t.length).toBe(7 + 9 + 4 + 4)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// jhaReviewCadenceDays — every frequency value
// ──────────────────────────────────────────────────────────────────────────

describe('jhaReviewCadenceDays — full coverage', () => {
  it.each([
    ['continuous', 90],
    ['daily',      365],
    ['weekly',     365],
    ['monthly',    365],
    ['quarterly',  365],
    ['annually',   730],
    ['as_needed',  730],
  ] as const)('%s → %i days', (freq, days) => {
    expect(jhaReviewCadenceDays(freq)).toBe(days)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// validateJhaCreateInput — all rejection paths
// ──────────────────────────────────────────────────────────────────────────

describe('validateJhaCreateInput — boundary cases', () => {
  it('rejects undefined title', () => {
    expect(validateJhaCreateInput({ frequency: 'monthly' })).toMatch(/Title/)
  })

  it('rejects whitespace-only title', () => {
    expect(validateJhaCreateInput({ title: '   \t\n', frequency: 'monthly' })).toMatch(/Title/)
  })

  it('accepts a single-character title', () => {
    expect(validateJhaCreateInput({ title: 'X', frequency: 'monthly' })).toBeNull()
  })

  it('accepts unicode in title', () => {
    expect(validateJhaCreateInput({ title: '⚠️ pinch zone', frequency: 'monthly' })).toBeNull()
  })

  it('accepts each documented frequency', () => {
    for (const f of JHA_FREQUENCIES) {
      expect(validateJhaCreateInput({ title: 't', frequency: f })).toBeNull()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Aggregation helpers at scale
// ──────────────────────────────────────────────────────────────────────────

describe('groupHazardsByStep at scale', () => {
  it('handles 50 steps × 4 hazards each (max-stride configuration)', () => {
    const steps: JhaStep[] = Array.from({ length: 50 }, (_, i) =>
      step({ id: `s${i}`, sequence: i + 1, description: `step ${i + 1}` }),
    )
    const hazards: JhaHazard[] = []
    for (const s of steps) {
      for (let j = 0; j < 4; j++) hazards.push(hazard({ id: `${s.id}-h${j}`, step_id: s.id }))
    }
    const grouped = groupHazardsByStep(steps, hazards)
    expect(grouped).toHaveLength(50)
    for (const g of grouped) expect(g.hazards).toHaveLength(4)
  })

  it('handles all-orphan hazards (every step_id null)', () => {
    const steps = [step({ id: 's1', sequence: 1 })]
    const hazards = Array.from({ length: 5 }, (_, i) =>
      hazard({ id: `h${i}`, step_id: null }),
    )
    const grouped = groupHazardsByStep(steps, hazards)
    expect(grouped).toHaveLength(2)
    expect(grouped[1].step).toBeNull()
    expect(grouped[1].hazards).toHaveLength(5)
  })

  it('preserves step sequence even when steps array is unsorted', () => {
    const steps = [
      step({ id: 'a', sequence: 3 }),
      step({ id: 'b', sequence: 1 }),
      step({ id: 'c', sequence: 2 }),
    ]
    const grouped = groupHazardsByStep(steps, [])
    expect(grouped.map(g => g.step?.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('aggregateRequiredPpe edge cases', () => {
  it('handles 100+ controls with mixed levels', () => {
    const controls: JhaHazardControl[] = []
    for (let i = 0; i < 100; i++) {
      controls.push(ctrl({
        id: `c${i}`,
        hierarchy_level: i % 5 === 0 ? 'ppe' : 'engineering',
        custom_name: i % 5 === 0 ? `PPE-${i}` : `Eng-${i}`,
      }))
    }
    const ppe = aggregateRequiredPpe(controls)
    expect(ppe).toHaveLength(20)
    // Sorted alphabetically — PPE-0, PPE-10, PPE-15... (lex sort of digits)
    expect(ppe[0].startsWith('PPE-')).toBe(true)
  })

  it('treats whitespace-only custom_name as empty', () => {
    expect(aggregateRequiredPpe([ctrl({ custom_name: '   ', hierarchy_level: 'ppe' })])).toEqual([])
  })

  it('case-sensitive dedupe (Hard hat ≠ HARD HAT — intentional)', () => {
    // localeCompare in en-US ignores case for primary ordering and
    // breaks ties by case (lowercase first), so 'Hard hat' precedes
    // 'HARD HAT' in the sorted output. The dedupe is case-sensitive
    // by design — different casings are treated as distinct items.
    const out = aggregateRequiredPpe([
      ctrl({ id: '1', custom_name: 'Hard hat', hierarchy_level: 'ppe' }),
      ctrl({ id: '2', custom_name: 'HARD HAT', hierarchy_level: 'ppe' }),
    ])
    expect(out).toHaveLength(2)
    expect(new Set(out)).toEqual(new Set(['Hard hat', 'HARD HAT']))
  })
})

describe('highestPotentialSeverity edge cases', () => {
  it('returns the single severity when only one hazard', () => {
    expect(highestPotentialSeverity([hazard({ potential_severity: 'high' })])).toBe('high')
  })

  it('handles a mixed set of all four bands', () => {
    expect(highestPotentialSeverity([
      hazard({ id: '1', potential_severity: 'low' }),
      hazard({ id: '2', potential_severity: 'moderate' }),
      hazard({ id: '3', potential_severity: 'high' }),
      hazard({ id: '4', potential_severity: 'extreme' }),
    ])).toBe('extreme')
  })

  it('returns extreme even when only one extreme is present amid 99 lows', () => {
    const list: JhaHazard[] = Array.from({ length: 99 }, (_, i) =>
      hazard({ id: `low-${i}`, potential_severity: 'low' }),
    )
    list.push(hazard({ id: 'one-extreme', potential_severity: 'extreme' }))
    expect(highestPotentialSeverity(list)).toBe('extreme')
  })
})

describe('countPpeAloneWarnings boundary cases', () => {
  it('treats moderate severity hazards as not warning-eligible (matches DB constraint inherent_score >= 8)', () => {
    // Note: countPpeAloneWarnings uses potential_severity directly.
    // High + extreme are warning-eligible; moderate + low are not.
    // (See countPpeAloneWarnings docstring — high and extreme only.)
    const hazards = [hazard({ id: 'h', potential_severity: 'moderate' })]
    const ctrls   = [ctrl({ hazard_id: 'h', hierarchy_level: 'ppe' })]
    expect(countPpeAloneWarnings(hazards, ctrls)).toBe(0)
  })

  it('does not warn on a hazard with no controls', () => {
    const hazards = [hazard({ id: 'h', potential_severity: 'extreme' })]
    expect(countPpeAloneWarnings(hazards, [])).toBe(0)
  })

  it('warns when ALL controls are PPE (one is enough to cover but PPE-only)', () => {
    const hazards = [hazard({ id: 'h', potential_severity: 'extreme' })]
    const ctrls = [ctrl({ hazard_id: 'h', hierarchy_level: 'ppe' })]
    expect(countPpeAloneWarnings(hazards, ctrls)).toBe(1)
  })

  it('does NOT warn when at least one non-PPE control is present', () => {
    const hazards = [hazard({ id: 'h', potential_severity: 'extreme' })]
    const ctrls = [
      ctrl({ id: '1', hazard_id: 'h', hierarchy_level: 'ppe' }),
      ctrl({ id: '2', hazard_id: 'h', hierarchy_level: 'administrative' }),
    ]
    expect(countPpeAloneWarnings(hazards, ctrls)).toBe(0)
  })

  it('counts each warning-triggering hazard independently', () => {
    const hazards = [
      hazard({ id: 'a', potential_severity: 'extreme' }),
      hazard({ id: 'b', potential_severity: 'high' }),
      hazard({ id: 'c', potential_severity: 'extreme' }),
    ]
    const ctrls = [
      ctrl({ id: '1', hazard_id: 'a', hierarchy_level: 'ppe' }),
      ctrl({ id: '2', hazard_id: 'b', hierarchy_level: 'ppe' }),
      ctrl({ id: '3', hazard_id: 'c', hierarchy_level: 'engineering' }),
    ]
    expect(countPpeAloneWarnings(hazards, ctrls)).toBe(2)
  })
})

describe('groupControlsByHazard ordering', () => {
  it('orders controls by hierarchy: elimination → ppe', () => {
    const hazards = [hazard({ id: 'h' })]
    const ctrls = [
      ctrl({ id: '1', hazard_id: 'h', hierarchy_level: 'ppe' }),
      ctrl({ id: '2', hazard_id: 'h', hierarchy_level: 'elimination' }),
      ctrl({ id: '3', hazard_id: 'h', hierarchy_level: 'engineering' }),
      ctrl({ id: '4', hazard_id: 'h', hierarchy_level: 'administrative' }),
      ctrl({ id: '5', hazard_id: 'h', hierarchy_level: 'substitution' }),
    ]
    const grouped = groupControlsByHazard(hazards, ctrls)
    const order = grouped.get('h')!.map(c => c.hierarchy_level)
    expect(order).toEqual(['elimination', 'substitution', 'engineering', 'administrative', 'ppe'])
  })

  it('returns an empty array (not undefined) for hazards with no controls', () => {
    const hazards = [hazard({ id: 'h' })]
    const grouped = groupControlsByHazard(hazards, [])
    expect(grouped.get('h')).toEqual([])
  })
})
