import { describe, expect, it } from 'vitest'
import {
  calculateRequiredClearance,
  requiredAnchorCapacity,
  TRIGGER_HEIGHTS,
  LADDER_TYPE_RATINGS,
  FALL_PROTECTION_COMPONENT_TYPES,
} from '@soteria/core/workingAtHeights'

describe('Working at Heights — clearance calculation', () => {
  it('a standard 6-ft shock lanyard needs about 18 ft of clearance below the anchor', () => {
    // Industry-standard worked example from ANSI Z359 design guides:
    // 6 (lanyard) + 3.5 (decel) + 1.5 (stretch) + 5 (worker) + 2 (margin) = 18 ft.
    const r = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6 })
    expect(r.requiredClearanceFt).toBe(18)
    expect(r.breakdown).toHaveLength(5)
    expect(r.breakdown.map(b => b.label)).toContain('Lanyard length')
    expect(r.breakdown.map(b => b.label)).toContain('Deceleration distance')
  })

  it('a Class 1 SRL needs about 10.5 ft of clearance — half a lanyard', () => {
    // 2 (lockup) + 1.5 (stretch) + 5 (worker) + 2 (margin) = 10.5 ft.
    // This is why SRLs are preferred when clearance is constrained.
    const r = calculateRequiredClearance({ system: 'srl_class1' })
    expect(r.requiredClearanceFt).toBe(10.5)
  })

  it('restraint mode does not include free fall or deceleration', () => {
    // Restraint physically prevents reaching the fall edge — no fall,
    // no arrest forces, no shock-absorber distance.
    const r = calculateRequiredClearance({ system: 'restraint' })
    expect(r.requiredClearanceFt).toBe(7) // 5 (worker) + 2 (margin)
    expect(r.breakdown.find(b => b.label.includes('Deceleration'))).toBeUndefined()
  })

  it('swing-fall offset adds a pendulum-drop term to lanyard clearance', () => {
    // With a 4 ft horizontal offset and 6 ft lanyard, the pendulum
    // drop ≈ offset² / (2 * lanyard) = 16 / 12 ≈ 1.33 ft.
    const base = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6 })
    const swung = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6, swingFallOffsetFt: 4 })
    expect(swung.requiredClearanceFt).toBeGreaterThan(base.requiredClearanceFt)
    expect(swung.breakdown.find(b => b.label === 'Swing-fall drop')?.feet).toBeCloseTo(1.33, 1)
  })

  it('Class 2 SRL is flagged as the leading-edge option', () => {
    const r = calculateRequiredClearance({ system: 'srl_class2' })
    expect(r.notes.join(' ')).toMatch(/leading-edge|sharp-edge/i)
  })
})

describe('Working at Heights — anchor capacity', () => {
  it('default 5,000 lbf per worker', () => {
    expect(requiredAnchorCapacity(1, false)).toBe(5000)
    expect(requiredAnchorCapacity(2, false)).toBe(10000)
  })

  it('engineered anchors at 2x peak arrest force', () => {
    // Peak arrest force capped at 1,800 lbf by OSHA; 2:1 factor gives 3,600 per worker.
    expect(requiredAnchorCapacity(1, true)).toBe(3600)
    expect(requiredAnchorCapacity(2, true)).toBe(7200)
  })

  it('zero workers returns zero capacity (no division-by-zero quirks downstream)', () => {
    expect(requiredAnchorCapacity(0, false)).toBe(0)
  })
})

describe('Working at Heights — regulatory data', () => {
  it('exposes federal + Cal-OSHA trigger heights', () => {
    expect(TRIGGER_HEIGHTS.FED_GENERAL_INDUSTRY.feet).toBe(4)
    expect(TRIGGER_HEIGHTS.FED_CONSTRUCTION.feet).toBe(6)
    expect(TRIGGER_HEIGHTS.CALOSHA_CONSTRUCTION.feet).toBe(7.5)
    expect(TRIGGER_HEIGHTS.FED_SCAFFOLD.feet).toBe(10)
  })

  it('exposes all five ANSI A14 ladder type ratings in descending capacity', () => {
    expect(LADDER_TYPE_RATINGS).toHaveLength(5)
    const capacities = LADDER_TYPE_RATINGS.map(r => r.capacityLbf)
    for (let i = 1; i < capacities.length; i++) {
      expect(capacities[i]).toBeLessThan(capacities[i - 1])
    }
  })

  it('flags Type III as not-for-industrial', () => {
    const t3 = LADDER_TYPE_RATINGS.find(r => r.type === 'III')
    expect(t3?.recommendedUse).toMatch(/NOT for industrial/i)
  })

  it('enumerates the ANSI Z359 fall protection component types', () => {
    expect(FALL_PROTECTION_COMPONENT_TYPES).toContain('harness')
    expect(FALL_PROTECTION_COMPONENT_TYPES).toContain('shock_lanyard')
    expect(FALL_PROTECTION_COMPONENT_TYPES).toContain('srl_class1')
    expect(FALL_PROTECTION_COMPONENT_TYPES).toContain('trauma_strap')
  })
})
