import { describe, it, expect } from 'vitest'
import {
  isObjectiveAchieved,
  objectiveProgressPct,
} from '@soteria/core/environmentalObjective'

describe('isObjectiveAchieved', () => {
  it('decrease: achieved when latest is at or below target', () => {
    expect(isObjectiveAchieved(100, 100, 'decrease')).toBe(true)
    expect(isObjectiveAchieved(100, 90, 'decrease')).toBe(true)
    expect(isObjectiveAchieved(100, 101, 'decrease')).toBe(false)
  })

  it('increase: achieved when latest is at or above target', () => {
    expect(isObjectiveAchieved(80, 80, 'increase')).toBe(true)
    expect(isObjectiveAchieved(80, 95, 'increase')).toBe(true)
    expect(isObjectiveAchieved(80, 79, 'increase')).toBe(false)
  })

  it('is false until both a target and a reading exist', () => {
    expect(isObjectiveAchieved(null, 10, 'decrease')).toBe(false)
    expect(isObjectiveAchieved(10, null, 'decrease')).toBe(false)
  })
})

describe('objectiveProgressPct', () => {
  it('decrease: scales baseline→target as 0→100', () => {
    // Baseline 100, target 50. Latest 75 is halfway.
    expect(objectiveProgressPct(100, 50, 75, 'decrease')).toBe(50)
    expect(objectiveProgressPct(100, 50, 100, 'decrease')).toBe(0)
    expect(objectiveProgressPct(100, 50, 50, 'decrease')).toBe(100)
  })

  it('increase: scales baseline→target as 0→100', () => {
    // Baseline 20%, target 60%. Latest 40% is halfway.
    expect(objectiveProgressPct(20, 60, 40, 'increase')).toBe(50)
    expect(objectiveProgressPct(20, 60, 60, 'increase')).toBe(100)
  })

  it('clamps overshoot to 100 and regression to 0', () => {
    expect(objectiveProgressPct(100, 50, 40, 'decrease')).toBe(100)  // beyond target
    expect(objectiveProgressPct(100, 50, 120, 'decrease')).toBe(0)   // worse than baseline
  })

  it('maintain objective (baseline === target): 100 iff achieved', () => {
    expect(objectiveProgressPct(50, 50, 50, 'decrease')).toBe(100)
    expect(objectiveProgressPct(50, 50, 51, 'decrease')).toBe(0)
  })

  it('returns null until baseline, target, and a reading all exist', () => {
    expect(objectiveProgressPct(null, 50, 75, 'decrease')).toBeNull()
    expect(objectiveProgressPct(100, null, 75, 'decrease')).toBeNull()
    expect(objectiveProgressPct(100, 50, null, 'decrease')).toBeNull()
  })
})
