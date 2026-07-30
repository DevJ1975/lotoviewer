import { describe, it, expect } from 'vitest'
import {
  reportingWindowHours,
  reportingDeadlineMs,
  evaluateSevereInjuryReport,
  resolveReportingJurisdiction,
  SEVERE_INJURY_TRIGGERS,
} from '@soteria/core/oshaSevereInjuryReport'

const HOUR = 3_600_000

describe('reportingWindowHours', () => {
  it('gives fatalities an 8-hour window and everything else 24, under federal 1904.39', () => {
    expect(reportingWindowHours('fatality', 'federal')).toBe(8)
    expect(reportingWindowHours('in_patient_hospitalization', 'federal')).toBe(24)
    expect(reportingWindowHours('amputation', 'federal')).toBe(24)
    expect(reportingWindowHours('loss_of_eye', 'federal')).toBe(24)
  })

  // Lab. Code §6409.1(b) + 8 CCR §342 collapse the two federal tiers into one.
  it('gives every trigger an 8-hour window under Cal/OSHA', () => {
    for (const trigger of SEVERE_INJURY_TRIGGERS) {
      expect(reportingWindowHours(trigger, 'CA')).toBe(8)
    }
  })

  it('never gives California more time than federal', () => {
    for (const trigger of SEVERE_INJURY_TRIGGERS) {
      expect(reportingWindowHours(trigger, 'CA'))
        .toBeLessThanOrEqual(reportingWindowHours(trigger, 'federal'))
    }
  })
})

describe('resolveReportingJurisdiction', () => {
  it('recognises California in any casing or padding', () => {
    expect(resolveReportingJurisdiction('CA')).toBe('CA')
    expect(resolveReportingJurisdiction('ca')).toBe('CA')
    expect(resolveReportingJurisdiction('  Ca ')).toBe('CA')
  })

  // Falling back to federal is the safe direction: federal is never the
  // shorter window, so an unresolved state can't invent time a site lacks.
  it('falls back to federal for other, empty, or missing states', () => {
    expect(resolveReportingJurisdiction('TX')).toBe('federal')
    expect(resolveReportingJurisdiction('')).toBe('federal')
    expect(resolveReportingJurisdiction(null)).toBe('federal')
    expect(resolveReportingJurisdiction(undefined)).toBe('federal')
  })
})

describe('reportingDeadlineMs', () => {
  const basis = Date.parse('2026-05-24T00:00:00Z')

  it('adds the window to the basis time', () => {
    expect(reportingDeadlineMs('fatality', basis, 'federal')).toBe(basis + 8 * HOUR)
    expect(reportingDeadlineMs('amputation', basis, 'federal')).toBe(basis + 24 * HOUR)
  })

  it('pulls the California amputation deadline 16 hours earlier than federal', () => {
    expect(reportingDeadlineMs('amputation', basis, 'CA')).toBe(basis + 8 * HOUR)
    expect(reportingDeadlineMs('amputation', basis, 'federal') -
           reportingDeadlineMs('amputation', basis, 'CA')).toBe(16 * HOUR)
  })
})

describe('evaluateSevereInjuryReport', () => {
  const basis = Date.parse('2026-05-24T00:00:00Z')

  it('is "reported" once a report time is recorded, regardless of the clock', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'fatality', jurisdiction: 'federal', basisMs: basis,
      reportedAtMs: basis + 30 * HOUR,    // even if filed late
      nowMs: basis + 40 * HOUR,
    })
    expect(s.status).toBe('reported')
    expect(s.hoursRemaining).toBeNull()
  })

  it('is "pending" with time to spare', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'fatality', jurisdiction: 'federal', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 2 * HOUR,            // 6h left of the 8h window
    })
    expect(s.status).toBe('pending')
    expect(s.hoursRemaining).toBeCloseTo(6)
  })

  it('flips to "due_soon" inside the warning threshold', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'fatality', jurisdiction: 'federal', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 7 * HOUR,            // 1h left, default threshold 2h
    })
    expect(s.status).toBe('due_soon')
  })

  it('is "overdue" past the deadline', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'amputation', jurisdiction: 'federal', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 25 * HOUR,           // 24h window blown
    })
    expect(s.status).toBe('overdue')
    expect(s.hoursRemaining).toBeLessThan(0)
  })

  it('honours a custom dueSoonHours threshold', () => {
    const s = evaluateSevereInjuryReport({
      trigger: 'amputation', jurisdiction: 'federal', basisMs: basis, reportedAtMs: null,
      nowMs: basis + 20 * HOUR,           // 4h left
      dueSoonHours: 6,
    })
    expect(s.status).toBe('due_soon')
  })

  // The defect this jurisdiction split exists to fix: at 9 hours after an
  // amputation, a California employer is already late while a federal one
  // still has 15 hours. Before migration 252 both read "pending".
  it('is overdue in California but pending federally, 9h after an amputation', () => {
    const args = { trigger: 'amputation', basisMs: basis, reportedAtMs: null, nowMs: basis + 9 * HOUR } as const

    expect(evaluateSevereInjuryReport({ ...args, jurisdiction: 'CA' }).status).toBe('overdue')
    expect(evaluateSevereInjuryReport({ ...args, jurisdiction: 'federal' }).status).toBe('pending')
  })
})

describe('trigger set', () => {
  it('covers the four 1904.39 reportable events', () => {
    expect([...SEVERE_INJURY_TRIGGERS]).toEqual([
      'fatality', 'in_patient_hospitalization', 'amputation', 'loss_of_eye',
    ])
  })
})
