import { describe, expect, it } from 'vitest'
import {
  assessHazwoperApplicability,
  classifyRelease,
  HAZWOPER_REFRESHER_DAYS,
  type HazwoperActivity,
  type ReleaseFacts,
} from '@soteria/core/hazwoper'

const ROUTINE: HazwoperActivity = {
  tsdOperations: false,
  correctiveActionCleanup: false,
  voluntaryCleanup: false,
  emergencyResponse: false,
  routineGeneratorWork: true,
}

describe('assessHazwoperApplicability', () => {
  it('routine generator accumulation is NOT HAZWOPER-covered', () => {
    const a = assessHazwoperApplicability(ROUTINE)
    expect(a.covered).toBe(false)
    expect(a.annualRefresher).toBe(false)
    expect(a.suggestedTraining).toEqual(['none'])
  })

  it('emergency response is covered with the annual refresher', () => {
    const a = assessHazwoperApplicability({ ...ROUTINE, emergencyResponse: true })
    expect(a.covered).toBe(true)
    expect(a.annualRefresher).toBe(true)
    expect(a.suggestedTraining).toContain('fr_operations')
  })

  it('cleanup / corrective action requires the 40-hour tier', () => {
    const a = assessHazwoperApplicability({ ...ROUTINE, correctiveActionCleanup: true })
    expect(a.covered).toBe(true)
    expect(a.suggestedTraining).toContain('general_site_worker_40hr')
  })

  it('TSD operations are covered', () => {
    expect(assessHazwoperApplicability({ ...ROUTINE, tsdOperations: true }).covered).toBe(true)
  })

  it('coverage from another activity is not removed by the routine flag', () => {
    const a = assessHazwoperApplicability({ ...ROUTINE, emergencyResponse: true, routineGeneratorWork: true })
    expect(a.covered).toBe(true)
  })

  it('exposes the 1-year refresher cadence', () => {
    expect(HAZWOPER_REFRESHER_DAYS).toBe(365)
  })
})

describe('classifyRelease', () => {
  const CONTROLLED: ReleaseFacts = {
    uncontrolled: false,
    safetyOrHealthHazard: false,
    requiresEvacuation: false,
    beyondIncidental: false,
  }

  it('controlled small release is incidental', () => {
    expect(classifyRelease(CONTROLLED).classification).toBe('incidental')
  })

  it('any emergency signal escalates to emergency_response', () => {
    expect(classifyRelease({ ...CONTROLLED, uncontrolled: true }).classification).toBe('emergency_response')
    expect(classifyRelease({ ...CONTROLLED, safetyOrHealthHazard: true }).classification).toBe('emergency_response')
    expect(classifyRelease({ ...CONTROLLED, requiresEvacuation: true }).classification).toBe('emergency_response')
    expect(classifyRelease({ ...CONTROLLED, beyondIncidental: true }).classification).toBe('emergency_response')
  })

  it('emergency decision tells the worker not to self-clean', () => {
    const d = classifyRelease({ ...CONTROLLED, uncontrolled: true })
    expect(d.action).toMatch(/Emergency Response Plan/)
  })
})
