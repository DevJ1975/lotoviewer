import { describe, expect, it } from 'vitest'
import {
  canReleaseEquipmentToService,
  computeInspectionQualitySignals,
  computeInspectionResult,
  inferEquipmentFamily,
  readinessStatusFromInspection,
  shouldBlockInspectionForStrike,
} from '@soteria/core/equipmentReadiness'

describe('computeInspectionResult', () => {
  it('blocks equipment when a critical item fails', () => {
    expect(computeInspectionResult([
      { response: 'pass', critical: true },
      { response: 'fail', critical: true },
    ])).toEqual({
      result: 'blocked',
      failedItemCount: 1,
      failedCriticalCount: 1,
    })
  })

  it('marks non-critical failures as limited use', () => {
    expect(computeInspectionResult([
      { response: 'fail', severity: 'repair_soon' },
    ])).toMatchObject({
      result: 'limited_use',
      failedItemCount: 1,
      failedCriticalCount: 0,
    })
  })

  it('marks all-passing inspections as ready', () => {
    expect(computeInspectionResult([
      { response: 'pass', critical: true },
      { response: 'na', critical: false },
    ])).toEqual({
      result: 'ready',
      failedItemCount: 0,
      failedCriticalCount: 0,
    })
  })
})

describe('readinessStatusFromInspection', () => {
  it('maps blocked inspections to out-of-service pending review', () => {
    expect(readinessStatusFromInspection('blocked')).toBe('out_of_service_pending_review')
  })

  it('maps limited and ready results to equipment readiness states', () => {
    expect(readinessStatusFromInspection('limited_use')).toBe('limited_use')
    expect(readinessStatusFromInspection('ready')).toBe('available')
  })
})

describe('STRIKE and return-to-service gates', () => {
  it('blocks operation when STRIKE readiness is partial or blocked', () => {
    expect(shouldBlockInspectionForStrike('blocked')).toBe(true)
    expect(shouldBlockInspectionForStrike('partial')).toBe(true)
    expect(shouldBlockInspectionForStrike('ready')).toBe(false)
    expect(shouldBlockInspectionForStrike('not_required')).toBe(false)
  })

  it('only releases equipment when no other out-of-service defects remain', () => {
    expect(canReleaseEquipmentToService(0)).toBe(true)
    expect(canReleaseEquipmentToService(1)).toBe(false)
  })
})

describe('equipment family inference', () => {
  it('recognizes common PIT and lift descriptions', () => {
    expect(inferEquipmentFamily('Toyota electric forklift')).toBe('forklift_electric')
    expect(inferEquipmentFamily('Propane LPG lift truck')).toBe('forklift_ic_lpg')
    expect(inferEquipmentFamily('Scissor lift 19 ft')).toBe('aerial_lift_scissor')
    expect(inferEquipmentFamily('Powered pallet jack')).toBe('pallet_jack_powered')
  })
})

describe('inspection quality signals', () => {
  it('flags rushed inspections and missing required photos', () => {
    expect(computeInspectionQualitySignals({
      durationSeconds: 12,
      failedItemCount: 0,
      photoCount: 0,
      requiredPhotoCount: 1,
    })).toEqual({
      rushed: true,
      missingRequiredPhotos: true,
      allPassNoPhotos: true,
    })
  })
})
