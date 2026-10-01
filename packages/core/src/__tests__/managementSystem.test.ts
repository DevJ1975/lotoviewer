import { describe, it, expect } from 'vitest'
import {
  DEFAULT_REVIEW_CADENCE_DAYS,
  DISCIPLINES,
  REQUIRED_POLICY_COMMITMENTS,
  addCalendarDays,
  contextRegisterHealth,
  nextReviewDue,
  policyIsComplete,
  policySignatoryStale,
  registerHealth,
  requiredCommitments,
  type RegisterRow,
} from '../managementSystem'

const TODAY = '2026-10-01'

function row(nextReviewDue: string, active = true): RegisterRow {
  return { active, nextReviewDue }
}

describe('DISCIPLINES', () => {
  it('lists the environmental, OH&S, and combined management systems', () => {
    expect(DISCIPLINES).toEqual(['ems', 'ohs', 'integrated'])
  })
})

describe('registerHealth', () => {
  it('is red for an empty register: an auditor has nothing to sample', () => {
    expect(registerHealth([], TODAY)).toBe('red')
  })

  it('is red when every row is retired', () => {
    expect(registerHealth([row('2027-01-01', false), row('2027-06-01', false)], TODAY)).toBe('red')
  })

  it('is green when every active row is reviewed ahead of its due date', () => {
    expect(registerHealth([row('2026-10-02'), row('2027-03-15')], TODAY)).toBe('green')
  })

  it('is green for a row due today (due is not overdue)', () => {
    expect(registerHealth([row(TODAY)], TODAY)).toBe('green')
  })

  it('is amber for a row due yesterday', () => {
    expect(registerHealth([row('2026-09-30')], TODAY)).toBe('amber')
  })

  it('is amber when one overdue active row hides among current ones', () => {
    expect(registerHealth([row('2027-01-01'), row('2025-12-31'), row('2026-11-01')], TODAY)).toBe('amber')
  })

  it('ignores an overdue retired row: obsolete history never turns a register amber', () => {
    expect(registerHealth([row('2027-01-01'), row('2020-01-01', false)], TODAY)).toBe('green')
  })

  it('compares across a year boundary', () => {
    expect(registerHealth([row('2025-12-31')], '2026-01-01')).toBe('amber')
    expect(registerHealth([row('2026-01-01')], '2025-12-31')).toBe('green')
  })
})

describe('addCalendarDays / nextReviewDue', () => {
  it('rolls over month ends and year ends', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('handles leap days', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addCalendarDays('2028-02-29', 365)).toBe('2029-02-28')
    expect(addCalendarDays('2027-02-28', 1)).toBe('2027-03-01')
  })

  it('subtracts with a negative count', () => {
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('nextReviewDue adds the cadence to the review date', () => {
    expect(nextReviewDue('2026-10-01', DEFAULT_REVIEW_CADENCE_DAYS)).toBe('2027-10-01')
    expect(DEFAULT_REVIEW_CADENCE_DAYS).toBe(365)
  })
})

describe('policyIsComplete', () => {
  const allEms = Object.fromEntries(REQUIRED_POLICY_COMMITMENTS.ems.map(c => [c.key, true]))
  const allOhs = Object.fromEntries(REQUIRED_POLICY_COMMITMENTS.ohs.map(c => [c.key, true]))
  const signed = { signatoryName: 'Plant Manager', signedAt: '2026-09-15' }

  it('is complete with all three 14001 commitments, a signatory and a date', () => {
    expect(REQUIRED_POLICY_COMMITMENTS.ems).toHaveLength(3)
    expect(policyIsComplete({ commitments: allEms, ...signed }, 'ems')).toBe(true)
  })

  for (const missing of REQUIRED_POLICY_COMMITMENTS.ems) {
    it(`is incomplete without "${missing.key}"`, () => {
      const commitments = { ...allEms, [missing.key]: false }
      expect(policyIsComplete({ commitments, ...signed }, 'ems')).toBe(false)
    })
  }

  it('is incomplete when unsigned or undated', () => {
    expect(policyIsComplete({ commitments: allEms, signatoryName: '  ', signedAt: '2026-09-15' }, 'ems')).toBe(false)
    expect(policyIsComplete({ commitments: allEms, signatoryName: 'Plant Manager', signedAt: null }, 'ems')).toBe(false)
  })

  it('reads the 45001 keys for an OH&S policy', () => {
    expect(policyIsComplete({ commitments: allEms, ...signed }, 'ohs')).toBe(false)
    expect(policyIsComplete({ commitments: allOhs, ...signed }, 'ohs')).toBe(true)
  })

  it('needs both lists for an integrated policy', () => {
    expect(requiredCommitments('integrated')).toHaveLength(REQUIRED_POLICY_COMMITMENTS.ems.length + REQUIRED_POLICY_COMMITMENTS.ohs.length)
    expect(policyIsComplete({ commitments: allEms, ...signed }, 'integrated')).toBe(false)
    expect(policyIsComplete({ commitments: { ...allEms, ...allOhs }, ...signed }, 'integrated')).toBe(true)
  })

  it('treats a commitment set to anything but true as not stated', () => {
    const commitments = { ...allEms, 'ems.protect_environment': 'yes' as unknown as boolean }
    expect(policyIsComplete({ commitments, ...signed }, 'ems')).toBe(false)
  })
})

describe('policySignatoryStale', () => {
  const v = (version: number, legalEntity: string, effectiveFrom: string) => ({ version, legalEntity, effectiveFrom })

  it('is stale when the legal entity changed after the policy was signed', () => {
    const scopes = [v(1, 'Old Owner LLC', '2024-01-01'), v(2, 'New Owner Inc', '2026-06-01')]
    expect(policySignatoryStale({ signedAt: '2025-03-01' }, scopes)).toBe(true)
  })

  it('is current when the policy was signed after the change', () => {
    const scopes = [v(1, 'Old Owner LLC', '2024-01-01'), v(2, 'New Owner Inc', '2026-06-01')]
    expect(policySignatoryStale({ signedAt: '2026-07-01' }, scopes)).toBe(false)
  })

  it('ignores scope revisions that keep the same legal entity', () => {
    const scopes = [v(1, 'Same Co', '2024-01-01'), v(2, ' same co ', '2026-06-01')]
    expect(policySignatoryStale({ signedAt: '2025-01-01' }, scopes)).toBe(false)
  })

  it('treats a first scope version as no change, in any input order', () => {
    expect(policySignatoryStale({ signedAt: '2020-01-01' }, [v(1, 'Co', '2026-01-01')])).toBe(false)
    const scopes = [v(2, 'New Owner Inc', '2026-06-01'), v(1, 'Old Owner LLC', '2024-01-01')]
    expect(policySignatoryStale({ signedAt: '2025-03-01' }, scopes)).toBe(true)
  })
})

describe('contextRegisterHealth', () => {
  const issue = (kind: 'internal' | 'external' | 'climate', active = true) =>
    ({ kind, active, nextReviewDue: '2027-01-01' })

  it('is green with a current climate determination', () => {
    expect(contextRegisterHealth([issue('external'), issue('climate')], '2026-10-01')).toBe('green')
  })

  it('is amber without a climate determination (ISO 14001 Amd 1:2024)', () => {
    expect(contextRegisterHealth([issue('internal'), issue('external')], '2026-10-01')).toBe('amber')
  })

  it('does not count a retired climate issue', () => {
    expect(contextRegisterHealth([issue('internal'), issue('climate', false)], '2026-10-01')).toBe('amber')
  })

  it('stays red when there are no active issues at all', () => {
    expect(contextRegisterHealth([], '2026-10-01')).toBe('red')
  })
})
