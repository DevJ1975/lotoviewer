import { describe, it, expect } from 'vitest'
import {
  ESCALATION_CONFIDENCE_THRESHOLD,
  SEVERITY_RANK_ORDER,
  compareSeverity,
  shouldEscalate,
  type IncidentSeverity,
  type SeverityPrediction,
} from '@soteria/core/incidentEscalation'

const pred = (
  predicted_severity: IncidentSeverity,
  confidence: number,
): SeverityPrediction => ({ predicted_severity, confidence })

describe('SEVERITY_RANK_ORDER', () => {
  it('lists every level once, most-serious first', () => {
    expect([...SEVERITY_RANK_ORDER]).toEqual([
      'catastrophic', 'fatality', 'lost_time', 'medical', 'first_aid', 'none',
    ])
  })

  it('contains exactly six unique values', () => {
    expect(new Set(SEVERITY_RANK_ORDER).size).toBe(SEVERITY_RANK_ORDER.length)
    expect(SEVERITY_RANK_ORDER.length).toBe(6)
  })
})

describe('compareSeverity (rank invariant)', () => {
  it('treats catastrophic > fatality > lost_time > medical > first_aid > none', () => {
    expect(compareSeverity('catastrophic', 'fatality')).toBeGreaterThan(0)
    expect(compareSeverity('fatality',     'lost_time')).toBeGreaterThan(0)
    expect(compareSeverity('lost_time',    'medical')).toBeGreaterThan(0)
    expect(compareSeverity('medical',      'first_aid')).toBeGreaterThan(0)
    expect(compareSeverity('first_aid',    'none')).toBeGreaterThan(0)
  })

  it('returns 0 when comparing a severity to itself', () => {
    for (const lv of SEVERITY_RANK_ORDER) {
      expect(compareSeverity(lv, lv)).toBe(0)
    }
  })

  it('is anti-symmetric — compare(a,b) === -compare(b,a)', () => {
    for (const a of SEVERITY_RANK_ORDER) {
      for (const b of SEVERITY_RANK_ORDER) {
        // Normalize 0 / -0 because `-(0) === -0` in JS and Vitest's
        // strict `toBe` distinguishes them.
        const ab = compareSeverity(a, b)
        const ba = compareSeverity(b, a)
        expect(ab === -ba || (ab === 0 && ba === 0)).toBe(true)
      }
    }
  })

  it('is transitive — compare(a,b) > 0 and compare(b,c) > 0 implies compare(a,c) > 0', () => {
    // Light random check across all triples — 216 combinations.
    for (const a of SEVERITY_RANK_ORDER) {
      for (const b of SEVERITY_RANK_ORDER) {
        for (const c of SEVERITY_RANK_ORDER) {
          if (compareSeverity(a, b) > 0 && compareSeverity(b, c) > 0) {
            expect(compareSeverity(a, c)).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})

describe('shouldEscalate', () => {
  it('escalates when prediction is higher and confidence is at the threshold', () => {
    expect(shouldEscalate('first_aid', pred('medical', 0.7))).toBe(true)
  })

  it('escalates when prediction is well above and high-confidence', () => {
    expect(shouldEscalate('first_aid', pred('fatality', 0.95))).toBe(true)
    expect(shouldEscalate('medical',   pred('catastrophic', 0.9))).toBe(true)
  })

  it('does NOT escalate when prediction matches the current severity', () => {
    expect(shouldEscalate('medical', pred('medical', 0.99))).toBe(false)
  })

  it('does NOT escalate when prediction is lower than current', () => {
    expect(shouldEscalate('medical', pred('first_aid', 0.99))).toBe(false)
    expect(shouldEscalate('lost_time', pred('medical',   0.99))).toBe(false)
  })

  it('does NOT escalate when confidence is below the threshold', () => {
    expect(shouldEscalate('first_aid', pred('medical', 0.69))).toBe(false)
    expect(shouldEscalate('none',      pred('lost_time', 0.5))).toBe(false)
  })

  it('respects a custom confidence threshold', () => {
    // Stricter threshold rejects a 0.7-confidence escalation
    expect(shouldEscalate('first_aid', pred('medical', 0.7), 0.9)).toBe(false)
    expect(shouldEscalate('first_aid', pred('medical', 0.95), 0.9)).toBe(true)
  })

  it('exposes the default confidence threshold (0.7)', () => {
    expect(ESCALATION_CONFIDENCE_THRESHOLD).toBe(0.7)
  })
})

describe('shouldEscalate — boundary cases', () => {
  it('treats "none" as the floor — any prediction of higher severity escalates', () => {
    expect(shouldEscalate('none', pred('first_aid', 0.7))).toBe(true)
  })

  it('treats "catastrophic" as the ceiling — nothing escalates from there', () => {
    expect(shouldEscalate('catastrophic', pred('catastrophic', 0.99))).toBe(false)
    expect(shouldEscalate('catastrophic', pred('fatality', 0.99))).toBe(false)
  })

  it('handles confidence === 1 exactly', () => {
    expect(shouldEscalate('medical', pred('lost_time', 1))).toBe(true)
  })

  it('treats negative confidence as non-escalating (defensive)', () => {
    expect(shouldEscalate('medical', pred('lost_time', -0.5))).toBe(false)
  })
})
