import { describe, expect, it } from 'vitest'
import {
  computeHazardousWasteInspectionResult,
  isHazardousWasteAreaInspectionDue,
  parseHazardousWasteDelimitedList,
} from '@soteria/core/hazardousWaste'

describe('hazardous waste inspection result', () => {
  it('passes when all area checks are completed without flags', () => {
    expect(computeHazardousWasteInspectionResult({
      areaType: 'used_oil',
      checkedIds: [
        'closed-container',
        'compatible-container',
        'label-readable',
        'secondary-containment',
      ],
      flaggedIds: [],
    })).toMatchObject({
      result: 'pass',
      total: 4,
      checked: 4,
      flagged: 0,
      flaggedCritical: 0,
    })
  })

  it('blocks when a critical check is flagged', () => {
    expect(computeHazardousWasteInspectionResult({
      areaType: 'satellite_accumulation',
      checkedIds: ['closed-container'],
      flaggedIds: ['closed-container'],
    })).toMatchObject({
      result: 'blocked',
      flaggedCritical: 1,
    })
  })

  it('marks incomplete or noncritical flagged inspections as issues found', () => {
    expect(computeHazardousWasteInspectionResult({
      areaType: 'inspection_only',
      checkedIds: ['aisle-access'],
      flaggedIds: [],
    }).result).toBe('issues_found')

    expect(computeHazardousWasteInspectionResult({
      areaType: 'inspection_only',
      checkedIds: ['aisle-access', 'emergency-info-posted'],
      flaggedIds: ['emergency-info-posted'],
    }).result).toBe('issues_found')
  })
})

describe('hazardous waste parsing and due dates', () => {
  it('normalizes comma-delimited hazards without changing display casing', () => {
    expect(parseHazardousWasteDelimitedList('D001, d001, corrosive, , Toxic')).toEqual([
      'D001',
      'corrosive',
      'Toxic',
    ])
  })

  it('treats active never-inspected areas as due', () => {
    expect(isHazardousWasteAreaInspectionDue({
      active: true,
      inspectionCadenceDays: 7,
      lastInspectedAt: null,
    }, new Date('2026-05-13T12:00:00Z'))).toBe(true)
  })

  it('honors cadence and inactive status', () => {
    const asOf = new Date('2026-05-13T12:00:00Z')
    expect(isHazardousWasteAreaInspectionDue({
      active: true,
      inspectionCadenceDays: 7,
      lastInspectedAt: '2026-05-06T11:59:59Z',
    }, asOf)).toBe(true)

    expect(isHazardousWasteAreaInspectionDue({
      active: true,
      inspectionCadenceDays: 7,
      lastInspectedAt: '2026-05-07T12:00:00Z',
    }, asOf)).toBe(false)

    expect(isHazardousWasteAreaInspectionDue({
      active: false,
      inspectionCadenceDays: 7,
      lastInspectedAt: null,
    }, asOf)).toBe(false)
  })
})
