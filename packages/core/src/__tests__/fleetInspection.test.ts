import { describe, it, expect } from 'vitest'
import {
  buildDefaultChecklist, evaluateInspection, validateInspection,
  type ChecklistItem,
} from '../fleetInspection'

describe('buildDefaultChecklist', () => {
  it('returns the DOT pre-trip items defaulted to pass', () => {
    const c = buildDefaultChecklist()
    expect(c.length).toBeGreaterThan(5)
    expect(c.every(i => i.status === 'pass')).toBe(true)
    expect(c.map(i => i.key)).toContain('brakes')
  })
})

describe('evaluateInspection', () => {
  const base: ChecklistItem[] = [
    { key: 'brakes', label: 'Brakes', status: 'pass' },
    { key: 'tires', label: 'Tires', status: 'pass' },
    { key: 'lights', label: 'Lights', status: 'na' },
  ]

  it('passes when nothing failed (na is non-failing)', () => {
    const r = evaluateInspection(base)
    expect(r.passed).toBe(true)
    expect(r.failedItems).toHaveLength(0)
    expect(r.defectSummary).toBeNull()
  })

  it('fails and summarizes when an item fails', () => {
    const items: ChecklistItem[] = [
      ...base,
      { key: 'fluids', label: 'Fluid leaks', status: 'fail', note: 'coolant drip' },
    ]
    const r = evaluateInspection(items)
    expect(r.passed).toBe(false)
    expect(r.failedItems.map(i => i.key)).toEqual(['fluids'])
    expect(r.defectSummary).toBe('Fluid leaks: coolant drip')
  })

  it('summarizes multiple failures without notes', () => {
    const items: ChecklistItem[] = [
      { key: 'brakes', label: 'Brakes', status: 'fail' },
      { key: 'horn', label: 'Horn', status: 'fail' },
    ]
    const r = evaluateInspection(items)
    expect(r.defectSummary).toBe('Brakes; Horn')
  })
})

describe('validateInspection', () => {
  const okItems = [{ key: 'brakes', status: 'pass' }]

  it('requires a non-empty items array', () => {
    expect(validateInspection({ items: [] })).toMatch(/non-empty/)
    expect(validateInspection({ items: okItems })).toBeNull()
  })
  it('rejects bad item status / missing key', () => {
    expect(validateInspection({ items: [{ key: 'x', status: 'maybe' }] })).toMatch(/status/)
    expect(validateInspection({ items: [{ status: 'pass' }] })).toMatch(/key/)
  })
  it('rejects bad inspection_type + odometer', () => {
    expect(validateInspection({ items: okItems, inspection_type: 'mid_trip' })).toMatch(/inspection_type/)
    expect(validateInspection({ items: okItems, odometer_miles: -1 })).toMatch(/odometer/)
  })
})
