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
  isCalendarDate,
  registerDisciplines,
  registerHealth,
  registerHealthFromCounts,
  requiredCommitments,
  scopeAndPolicyHealth,
  validateContextIssueInput,
  validateInterestedPartyInput,
  validatePolicyInput,
  validateRetirementReason,
  validateScopeStatementInput,
  type ContextIssueInput,
  type InterestedPartyInput,
  type PolicyInput,
  type RegisterRow,
  type ScopeStatementInput,
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

describe('registerDisciplines', () => {
  it('shows a standard its own records plus the integrated ones', () => {
    expect(registerDisciplines('ems')).toEqual(['ems', 'integrated'])
    expect(registerDisciplines('ohs')).toEqual(['ohs', 'integrated'])
  })
})

describe('isCalendarDate', () => {
  it.each(['2026-10-01', '2028-02-29', '2026-12-31'])('accepts %s', date => {
    expect(isCalendarDate(date)).toBe(true)
  })

  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '2026-10-01T00:00:00Z', ''])('rejects %j', date => {
    expect(isCalendarDate(date)).toBe(false)
  })
})

const fieldsOf = (errors: { field: string }[]) => errors.map(e => e.field)

describe('validateRetirementReason', () => {
  it('requires a reason, because retired rows keep their history', () => {
    expect(fieldsOf(validateRetirementReason('   '))).toEqual(['retiredReason'])
    expect(validateRetirementReason('Process moved to the new plant')).toEqual([])
  })

  it('names the field it was asked to', () => {
    expect(fieldsOf(validateRetirementReason('', 'obsoleteReason'))).toEqual(['obsoleteReason'])
  })

  it('caps the reason at 2000 characters', () => {
    expect(validateRetirementReason('x'.repeat(2000))).toEqual([])
    expect(fieldsOf(validateRetirementReason('x'.repeat(2001)))).toEqual(['retiredReason'])
  })
})

describe('validateContextIssueInput', () => {
  const valid: ContextIssueInput = {
    discipline: 'ems', kind: 'climate', description: 'Hotter summers raise cooling-water demand',
    relevance: null, effect: 'risk',
  }

  it('accepts a complete issue, with or without an effect', () => {
    expect(validateContextIssueInput(valid)).toEqual([])
    expect(validateContextIssueInput({ ...valid, effect: null })).toEqual([])
  })

  it('reports every problem at once', () => {
    const errors = validateContextIssueInput({
      discipline: 'quality' as never, kind: 'political' as never, description: ' ',
      relevance: 'x'.repeat(2001), effect: 'threat' as never,
    })
    expect(fieldsOf(errors)).toEqual(['discipline', 'kind', 'description', 'relevance', 'effect'])
  })

  it('caps the description at 2000 characters', () => {
    expect(validateContextIssueInput({ ...valid, description: 'x'.repeat(2000) })).toEqual([])
    expect(fieldsOf(validateContextIssueInput({ ...valid, description: 'x'.repeat(2001) }))).toEqual(['description'])
  })
})

describe('validateInterestedPartyInput', () => {
  const valid: InterestedPartyInput = {
    discipline: 'ems', name: 'County water district', needsExpectations: 'Discharge within permit limits',
    becomesObligation: true, obligationId: '22222222-2222-4222-8222-222222222222',
  }

  it('accepts a party whose need becomes a linked obligation', () => {
    expect(validateInterestedPartyInput(valid)).toEqual([])
  })

  it('accepts a need adopted as an obligation before the obligation is linked', () => {
    expect(validateInterestedPartyInput({ ...valid, obligationId: null })).toEqual([])
  })

  it('refuses an obligation link on a need that is not adopted, as the database does', () => {
    expect(fieldsOf(validateInterestedPartyInput({ ...valid, becomesObligation: false }))).toEqual(['obligationId'])
  })

  it('requires a name and the needs', () => {
    expect(fieldsOf(validateInterestedPartyInput({ ...valid, name: '', needsExpectations: '' })))
      .toEqual(['name', 'needsExpectations'])
  })
})

describe('validateScopeStatementInput', () => {
  const valid: ScopeStatementInput = {
    discipline: 'ems', legalEntity: 'Northfield Forge & Finish LLC', physicalBoundary: 'The Northfield, TX site',
    activities: 'Forging, machining, powder coating', productsServices: 'Forged steel brackets',
    effectiveFrom: '2026-10-01',
  }

  it('accepts a complete scope', () => {
    expect(validateScopeStatementInput(valid)).toEqual([])
  })

  it('requires all four statements and a real effective date', () => {
    const errors = validateScopeStatementInput({
      ...valid, legalEntity: '', physicalBoundary: '', activities: '', productsServices: '', effectiveFrom: '2026-02-30',
    })
    expect(fieldsOf(errors)).toEqual(['legalEntity', 'physicalBoundary', 'activities', 'productsServices', 'effectiveFrom'])
  })
})

describe('validatePolicyInput', () => {
  const valid: PolicyInput = {
    discipline: 'ems', body: 'We protect the environment and prevent pollution.',
    commitments: { 'ems.protect_environment': true, 'ems.fulfil_obligations': true, 'ems.continual_improvement': false },
    signatoryName: 'Plant Manager', signatoryTitle: null, signedAt: '2026-10-01',
  }

  it('accepts a well-formed policy, even one missing a commitment: completeness is a separate check', () => {
    expect(validatePolicyInput(valid)).toEqual([])
  })

  it('accepts OH&S commitment keys, so an integrated policy fits', () => {
    expect(validatePolicyInput({ ...valid, discipline: 'integrated', commitments: { 'ohs.continual_improvement': true } }))
      .toEqual([])
  })

  it('refuses an unknown commitment key and a non-boolean answer', () => {
    const errors = validatePolicyInput({
      ...valid, commitments: { 'ems.be_nice': true, 'ems.protect_environment': 'yes' as never },
    })
    expect(errors).toEqual([
      { field: 'commitments', message: "has an unknown commitment 'ems.be_nice'" },
      { field: 'commitments', message: "'ems.protect_environment' must be true or false" },
    ])
  })

  it('requires a body, a signatory and a real signing date', () => {
    const errors = validatePolicyInput({ ...valid, body: ' ', signatoryName: '', signedAt: '01/10/2026' })
    expect(fieldsOf(errors)).toEqual(['body', 'signatoryName', 'signedAt'])
  })
})

describe('registerHealthFromCounts', () => {
  it('is red with no active rows, whatever else is counted', () => {
    expect(registerHealthFromCounts({ active: 0, reviewOverdue: 0 })).toBe('red')
    expect(registerHealthFromCounts({ active: 0, reviewOverdue: 3, gaps: 2 })).toBe('red')
  })

  it('is amber when a review is overdue or a register-specific gap is open', () => {
    expect(registerHealthFromCounts({ active: 4, reviewOverdue: 1 })).toBe('amber')
    expect(registerHealthFromCounts({ active: 4, reviewOverdue: 0, gaps: 1 })).toBe('amber')
  })

  it('is green otherwise', () => {
    expect(registerHealthFromCounts({ active: 4, reviewOverdue: 0 })).toBe('green')
    expect(registerHealthFromCounts({ active: 4, reviewOverdue: 0, gaps: 0 })).toBe('green')
  })

  it('agrees with registerHealth on the same rows', () => {
    const rows = [row('2026-09-30'), row('2026-10-01'), row('2020-01-01', false)]
    expect(registerHealth(rows, TODAY)).toBe(registerHealthFromCounts({ active: 2, reviewOverdue: 1 }))
  })
})

describe('scopeAndPolicyHealth', () => {
  const healthy = {
    scopeNextReviewDue: '2027-01-01', policyNextReviewDue: '2027-01-01', policyComplete: true, signatoryStale: false,
  }

  it('is green with a current scope and a complete, current, validly signed policy', () => {
    expect(scopeAndPolicyHealth(healthy, TODAY)).toBe('green')
  })

  it('is red until both documents exist', () => {
    expect(scopeAndPolicyHealth({ ...healthy, scopeNextReviewDue: null }, TODAY)).toBe('red')
    expect(scopeAndPolicyHealth({ ...healthy, policyNextReviewDue: null }, TODAY)).toBe('red')
  })

  it('is amber for an incomplete policy, a prior owner\'s signature, or an overdue review', () => {
    expect(scopeAndPolicyHealth({ ...healthy, policyComplete: false }, TODAY)).toBe('amber')
    expect(scopeAndPolicyHealth({ ...healthy, signatoryStale: true }, TODAY)).toBe('amber')
    expect(scopeAndPolicyHealth({ ...healthy, scopeNextReviewDue: '2026-09-30' }, TODAY)).toBe('amber')
    expect(scopeAndPolicyHealth({ ...healthy, policyNextReviewDue: '2026-09-30' }, TODAY)).toBe('amber')
  })

  it('treats a review due today as not yet overdue', () => {
    expect(scopeAndPolicyHealth({ ...healthy, scopeNextReviewDue: TODAY, policyNextReviewDue: TODAY }, TODAY)).toBe('green')
  })
})
