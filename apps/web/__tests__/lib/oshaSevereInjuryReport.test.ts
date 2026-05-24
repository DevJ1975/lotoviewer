import { describe, it, expect } from 'vitest'
import {
  reportingWindowHours,
  reportingDeadlineMs,
  evaluateSevereInjuryReport,
  SEVERE_INJURY_TRIGGERS,
} from '@soteria/core/oshaSevereInjuryReport'

const HOUR = 3_600_000

describe('reportingWindowHours', () => {
  it('gives fatalities an 8-hour window and everything else 24', () => {
    expect(reportingWindowHours('fatality')).toBe(8)
    expect(reportingWindowHours('in_patient_hospitalization')).toBe(24)
    expect(reportingWindowHours('amputation')).toBe(24)
    expect(reportingWindowHours('loss_of_eye')).toBe(24)
  })
})

describe('reportingDeadlineMs', () => {
  it('adds the window to the basis time', () => {
    const basis = Date.parse('2026-05-24T00:00:00Z')
    expect(reportingDeadlineMs('fatality', basis)).toBe(basis + 8 * HOUR)
    expect(reportingDeadlineMs('amputation', basis)).toBe(basis + 24 * HOUR)
  })
})

describe('evaluateSevereInjuryReport', () => {
  const basis = Date.parse('2026-05-24T00:00:00Z')

  it('is "reported" once a report time is recorded, regardless of the clock', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'fatality', basisMs: basis,
      reportedAtMs: basis + 30 * HOUR,    // even if filed late
      nowMs: basis + 40 * HOUR,
    })
    expect(s.status).toBe('reported')
    expect(s.hoursRemaining).toBeNull()
  })

  it('is "pending" with time to spare', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'fatality', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 2 * HOUR,            // 6h left of the 8h window
    })
    expect(s.status).toBe('pending')
    expect(s.hoursRemaining).toBeCloseTo(6)
  })

  it('flips to "due_soon" inside the warning threshold', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'fatality', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 7 * HOUR,            // 1h left, default threshold 2h
    })
    expect(s.status).toBe('due_soon')
  })

  it('is "overdue" past the deadline', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'amputation', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 25 * HOUR,           // 24h window blown
    })
    expect(s.status).toBe('overdue')
    expect(s.hoursRemaining).toBeLessThan(0)
  })

  it('honours a custom dueSoonHours threshold', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'amputation', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 20 * HOUR,           // 4h left
      dueSoonHours: 6,
    })
    expect(s.status).toBe('due_soon')
  })
})

describe('trigger set', () => {
  it('covers the four 1904.39 reportable events', () => {
    expect([...SEVERE_INJURY_TRIGGERS]).toEqual([
      'fatality', 'in_patient_hospitalization', 'amputation', 'loss_of_eye',
    ])
  })
})
