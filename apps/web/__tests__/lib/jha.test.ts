import { describe, it, expect } from 'vitest'
import {
  jhaReviewCadenceDays,
  highestPotentialSeverity,
  groupHazardsByStep,
  groupControlsByHazard,
  aggregateRequiredPpe,
  countPpeAloneWarnings,
  validateJhaCreateInput,
  type JhaStep,
  type JhaHazard,
  type JhaHazardControl,
} from '@soteria/core/jha'

// Pure-logic tests for the JHA helpers. These run cross-platform
// (web + mobile) so they must not reach for browser-only globals.

function step(over: Partial<JhaStep> = {}): JhaStep {
  return {
    id:          's-1',
    tenant_id:   't-1',
    jha_id:      'j-1',
    sequence:    1,
    description: 'Do the thing',
    notes:       null,
    created_at:  '2026-04-01T00:00:00Z',
    ...over,
  }
}

function hazard(over: Partial<JhaHazard> = {}): JhaHazard {
  return {
    id:                 'h-1',
    tenant_id:          't-1',
    jha_id:             'j-1',
    step_id:            's-1',
    hazard_category:    'physical',
    description:        'Could pinch',
    potential_severity: 'moderate',
    notes:              null,
    created_at:         '2026-04-01T00:00:00Z',
    ...over,
  }
}

function control(over: Partial<JhaHazardControl> = {}): JhaHazardControl {
  return {
    id:              'c-1',
    tenant_id:       't-1',
    jha_id:          'j-1',
    hazard_id:       'h-1',
    control_id:      null,
    custom_name:     'Cut-resistant gloves',
    hierarchy_level: 'ppe',
    notes:           null,
    created_at:      '2026-04-01T00:00:00Z',
    ...over,
  }
}

describe('jhaReviewCadenceDays', () => {
  // Spot-check a couple — the table itself is the source of truth.
  it('returns 90 for continuous tasks', () => {
    expect(jhaReviewCadenceDays('continuous')).toBe(90)
  })

  it('returns 365 for daily/weekly/monthly', () => {
    expect(jhaReviewCadenceDays('daily')).toBe(365)
    expect(jhaReviewCadenceDays('weekly')).toBe(365)
    expect(jhaReviewCadenceDays('monthly')).toBe(365)
  })

  it('returns 730 for annually + as_needed', () => {
    expect(jhaReviewCadenceDays('annually')).toBe(730)
    expect(jhaReviewCadenceDays('as_needed')).toBe(730)
  })
})

describe('highestPotentialSeverity', () => {
  it('returns null when no hazards', () => {
    expect(highestPotentialSeverity([])).toBeNull()
  })

  it('returns the worst severity across the set', () => {
    expect(highestPotentialSeverity([
      hazard({ id: 'a', potential_severity: 'low' }),
      hazard({ id: 'b', potential_severity: 'high' }),
      hazard({ id: 'c', potential_severity: 'moderate' }),
    ])).toBe('high')
  })

  it('promotes to extreme when present', () => {
    expect(highestPotentialSeverity([
      hazard({ id: 'a', potential_severity: 'extreme' }),
      hazard({ id: 'b', potential_severity: 'high' }),
    ])).toBe('extreme')
  })
})

describe('groupHazardsByStep', () => {
  it('orders steps by sequence and bucket hazards under each', () => {
    const steps = [
      step({ id: 's2', sequence: 2 }),
      step({ id: 's1', sequence: 1 }),
    ]
    const hazards = [
      hazard({ id: 'h1', step_id: 's1' }),
      hazard({ id: 'h2', step_id: 's2' }),
      hazard({ id: 'h3', step_id: 's1' }),
    ]
    const grouped = groupHazardsByStep(steps, hazards)
    expect(grouped[0].step?.id).toBe('s1')
    expect(grouped[0].hazards.map(h => h.id)).toEqual(['h1', 'h3'])
    expect(grouped[1].step?.id).toBe('s2')
    expect(grouped[1].hazards.map(h => h.id)).toEqual(['h2'])
  })

  it('appends a "general" bucket when step_id is null on any hazard', () => {
    const steps = [step({ id: 's1', sequence: 1 })]
    const hazards = [
      hazard({ id: 'h1', step_id: 's1' }),
      hazard({ id: 'h2', step_id: null }),
    ]
    const grouped = groupHazardsByStep(steps, hazards)
    expect(grouped).toHaveLength(2)
    expect(grouped[1].step).toBeNull()
    expect(grouped[1].hazards.map(h => h.id)).toEqual(['h2'])
  })

  it('omits the general bucket when no orphan hazards exist', () => {
    const steps = [step({ id: 's1', sequence: 1 })]
    const hazards = [hazard({ id: 'h1', step_id: 's1' })]
    expect(groupHazardsByStep(steps, hazards)).toHaveLength(1)
  })
})

describe('groupControlsByHazard', () => {
  it('groups controls by hazard and orders them by hierarchy', () => {
    const hazards = [hazard({ id: 'h1' })]
    const controls = [
      control({ id: 'c-ppe',          hazard_id: 'h1', hierarchy_level: 'ppe' }),
      control({ id: 'c-elim',         hazard_id: 'h1', hierarchy_level: 'elimination' }),
      control({ id: 'c-eng',          hazard_id: 'h1', hierarchy_level: 'engineering' }),
      control({ id: 'c-other-hazard', hazard_id: 'h2', hierarchy_level: 'engineering' }),
    ]
    const grouped = groupControlsByHazard(hazards, controls)
    expect(grouped.get('h1')!.map(c => c.id)).toEqual(['c-elim', 'c-eng', 'c-ppe'])
  })
})

describe('aggregateRequiredPpe', () => {
  it('dedupes and sorts PPE control names', () => {
    const ctrls = [
      control({ id: '1', custom_name: 'Hard hat',   hierarchy_level: 'ppe' }),
      control({ id: '2', custom_name: 'Hard hat',   hierarchy_level: 'ppe' }),  // duplicate
      control({ id: '3', custom_name: 'Cut gloves', hierarchy_level: 'ppe' }),
      control({ id: '4', custom_name: 'Lockout',    hierarchy_level: 'engineering' }), // not PPE
    ]
    expect(aggregateRequiredPpe(ctrls)).toEqual(['Cut gloves', 'Hard hat'])
  })

  it('returns empty array for no PPE controls', () => {
    expect(aggregateRequiredPpe([])).toEqual([])
    expect(aggregateRequiredPpe([control({ hierarchy_level: 'engineering' })])).toEqual([])
  })

  it('skips PPE controls without a custom_name (FK-only)', () => {
    expect(aggregateRequiredPpe([
      control({ id: '1', custom_name: null, control_id: 'lib-1', hierarchy_level: 'ppe' }),
    ])).toEqual([])
  })
})

describe('countPpeAloneWarnings', () => {
  it('counts high/extreme hazards covered only by PPE', () => {
    const hazards = [
      hazard({ id: 'h-low',   potential_severity: 'low' }),         // ignored
      hazard({ id: 'h-mod',   potential_severity: 'moderate' }),    // ignored
      hazard({ id: 'h-hi-eng',  potential_severity: 'high' }),      // engineering control → ok
      hazard({ id: 'h-hi-ppe',  potential_severity: 'high' }),      // ppe-only → warning
      hazard({ id: 'h-ext-mix', potential_severity: 'extreme' }),   // mixed → ok
      hazard({ id: 'h-ext-none',potential_severity: 'extreme' }),   // no controls → not counted (different problem)
    ]
    const ctrls = [
      control({ hazard_id: 'h-hi-eng',  hierarchy_level: 'engineering' }),
      control({ hazard_id: 'h-hi-ppe',  hierarchy_level: 'ppe' }),
      control({ hazard_id: 'h-hi-ppe',  hierarchy_level: 'ppe' }),
      control({ hazard_id: 'h-ext-mix', hierarchy_level: 'ppe' }),
      control({ hazard_id: 'h-ext-mix', hierarchy_level: 'engineering' }),
    ]
    expect(countPpeAloneWarnings(hazards, ctrls)).toBe(1)
  })

  it('returns zero for empty input', () => {
    expect(countPpeAloneWarnings([], [])).toBe(0)
  })
})

describe('validateJhaCreateInput', () => {
  it('returns null on a complete payload', () => {
    expect(validateJhaCreateInput({ title: 'Belt change', frequency: 'monthly' })).toBeNull()
  })

  it('rejects empty title', () => {
    expect(validateJhaCreateInput({ title: '   ', frequency: 'monthly' })).toMatch(/Title/)
  })

  it('rejects missing frequency', () => {
    expect(validateJhaCreateInput({ title: 'x' })).toMatch(/Frequency/)
  })

  it('rejects an invalid frequency', () => {
    expect(validateJhaCreateInput({ title: 'x', frequency: 'bogus' as never })).toMatch(/Invalid frequency/)
  })
})
