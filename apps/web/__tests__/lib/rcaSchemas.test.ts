import { describe, it, expect } from 'vitest'
import {
  RCA_METHODS,
  RCA_METHOD_LABEL,
  FISHBONE_CATEGORIES,
  TAPROOT_FACTOR_TYPES,
  ICAM_LAYERS,
  validateFiveWhys,
  validateFishbone,
  validateTaproot,
  validateIcam,
  validateRcaNode,
  canCompleteInvestigation,
} from '@soteria/core/rcaSchemas'

// Pure-logic tests for the four RCA method validators + the
// investigation completion gate.

describe('RCA method registry', () => {
  it('exposes the four real methods plus the placeholder', () => {
    expect(RCA_METHODS).toContain('5_whys')
    expect(RCA_METHODS).toContain('fishbone')
    expect(RCA_METHODS).toContain('taproot')
    expect(RCA_METHODS).toContain('icam')
    expect(RCA_METHODS).toContain('none_yet')
  })

  it('has a label for every method', () => {
    for (const m of RCA_METHODS) {
      expect(RCA_METHOD_LABEL[m]).toBeTruthy()
    }
  })
})

describe('Fishbone categories', () => {
  it('matches the six Ishikawa buckets', () => {
    expect(FISHBONE_CATEGORIES).toEqual([
      'people', 'process', 'equipment', 'environment', 'materials', 'management',
    ])
  })
})

describe('TapRooT factor types', () => {
  it('orders from event down to generic_cause', () => {
    expect(TAPROOT_FACTOR_TYPES).toEqual([
      'event', 'condition', 'causal_factor', 'root_cause', 'generic_cause',
    ])
  })
})

describe('ICAM layers', () => {
  it('matches the four-layer model', () => {
    expect(ICAM_LAYERS).toEqual([
      'absent_failed_defences',
      'individual_team_actions',
      'task_environmental_conditions',
      'organisational_factors',
    ])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Validators
// ──────────────────────────────────────────────────────────────────────────

describe('validateFiveWhys', () => {
  it('accepts a minimal valid node', () => {
    expect(validateFiveWhys({ ordinal: 1, answer: 'we slipped' })).toBeNull()
  })

  it('rejects ordinal < 1', () => {
    expect(validateFiveWhys({ ordinal: 0, answer: 'x' })).toMatch(/ordinal/i)
  })

  it('rejects missing ordinal', () => {
    expect(validateFiveWhys({ answer: 'x' })).toMatch(/ordinal/i)
  })

  it('rejects empty answer', () => {
    expect(validateFiveWhys({ ordinal: 1, answer: '   ' })).toMatch(/answer/i)
  })

  it('accepts an optional question', () => {
    expect(validateFiveWhys({ ordinal: 2, question: 'Why?', answer: 'because' })).toBeNull()
  })
})

describe('validateFishbone', () => {
  it('accepts a valid node', () => {
    expect(validateFishbone({ category: 'people', cause: 'fatigue' })).toBeNull()
  })

  it('rejects unknown category', () => {
    expect(validateFishbone({ category: 'banana' as never, cause: 'x' }))
      .toMatch(/category/i)
  })

  it('rejects empty cause', () => {
    expect(validateFishbone({ category: 'people', cause: '   ' }))
      .toMatch(/cause/i)
  })
})

describe('validateTaproot', () => {
  it('accepts an event node with no parent', () => {
    expect(validateTaproot({ factor_type: 'event', description: 'employee fell' }))
      .toBeNull()
  })

  it('accepts a condition node with a parent + generic category', () => {
    expect(validateTaproot({
      factor_type:      'condition',
      description:      'wet floor',
      taproot_category: 'environmental',
      parent_id:        'parent-uuid',
    })).toBeNull()
  })

  it('rejects unknown factor_type', () => {
    expect(validateTaproot({ factor_type: 'wat' as never, description: 'x' }))
      .toMatch(/factor_type/i)
  })

  it('rejects empty description', () => {
    expect(validateTaproot({ factor_type: 'event', description: '' }))
      .toMatch(/description/i)
  })
})

describe('validateIcam', () => {
  it('accepts a node in any layer', () => {
    for (const layer of ICAM_LAYERS) {
      expect(validateIcam({ layer, factor: 'something' })).toBeNull()
    }
  })

  it('rejects unknown layer', () => {
    expect(validateIcam({ layer: 'rogue' as never, factor: 'x' }))
      .toMatch(/layer/i)
  })

  it('rejects empty factor', () => {
    expect(validateIcam({ layer: 'organisational_factors', factor: '' }))
      .toMatch(/factor/i)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Dispatch validator
// ──────────────────────────────────────────────────────────────────────────

describe('validateRcaNode', () => {
  it('dispatches to the right method validator', () => {
    expect(validateRcaNode({
      method: '5_whys',
      node:   { ordinal: 1, answer: 'x' },
    })).toBeNull()
    expect(validateRcaNode({
      method: 'fishbone',
      node:   { category: 'people', cause: 'fatigue' },
    })).toBeNull()
    expect(validateRcaNode({
      method: 'taproot',
      node:   { factor_type: 'event', description: 'event happened' },
    })).toBeNull()
    expect(validateRcaNode({
      method: 'icam',
      node:   { layer: 'individual_team_actions', factor: 'rushed' },
    })).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Completion gate
// ──────────────────────────────────────────────────────────────────────────

describe('canCompleteInvestigation', () => {
  it('blocks when no method picked', () => {
    const r = canCompleteInvestigation({ rca_method: 'none_yet', has_nodes: true, has_root: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/method/i)
  })

  it('blocks when no nodes exist', () => {
    const r = canCompleteInvestigation({ rca_method: '5_whys', has_nodes: false, has_root: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/at least one/i)
  })

  it('blocks when nodes exist but no root identified', () => {
    const r = canCompleteInvestigation({ rca_method: '5_whys', has_nodes: true, has_root: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/root/i)
  })

  it('passes when method + nodes + root are all set', () => {
    const r = canCompleteInvestigation({ rca_method: 'icam', has_nodes: true, has_root: true })
    expect(r.ok).toBe(true)
  })
})
