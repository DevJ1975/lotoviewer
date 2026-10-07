import { describe, it, expect } from 'vitest'
import { reviewState, nextReviewDate, planLegalEntries, validateEvaluation } from '../../environmental/legalRegister'
import { resolveLibrary } from '../../environmental/resolve'
import type { JurisdictionPack, LegalRequirementDef } from '../../environmental/content'
import { EMPTY_SITE_PROFILE } from '../../environmental/siteProfile'

const at = (iso: string) => new Date(`${iso}T09:00:00Z`)

describe('reviewState', () => {
  it('never reviewed is its own state, not "fine"', () => {
    expect(reviewState({ lastReviewedAt: null, nextReviewDue: '2030-01-01' }, at('2026-10-07'))).toBe('never_reviewed')
  })

  it('judges the review date against today once there has been a review', () => {
    const e = (due: string | null) => ({ lastReviewedAt: '2025-10-01', nextReviewDue: due })
    expect(reviewState(e('2026-12-01'), at('2026-10-07'))).toBe('ok')
    expect(reviewState(e('2026-10-25'), at('2026-10-07'))).toBe('due_soon')
    expect(reviewState(e('2026-10-06'), at('2026-10-07'))).toBe('overdue')
    expect(reviewState(e('2026-10-07'), at('2026-10-07'))).toBe('due_soon')
    expect(reviewState(e(null), at('2026-10-07'))).toBe('ok')
  })
})

describe('nextReviewDate', () => {
  it('is a year or two after the review', () => {
    expect(nextReviewDate('2026-10-07', 'annual')).toBe('2027-10-07')
    expect(nextReviewDate('2026-10-07', 'biennial')).toBe('2028-10-07')
  })

  it('clamps Feb 29 to the end of February in a non-leap year', () => {
    expect(nextReviewDate('2028-02-29', 'annual')).toBe('2029-02-28')
    expect(nextReviewDate('2028-02-29', 'biennial')).toBe('2030-02-28')
  })

  it('has no next review without a frequency', () => {
    expect(nextReviewDate('2026-10-07', null)).toBeNull()
  })
})

const legal = (id: string, over: Partial<LegalRequirementDef> = {}): LegalRequirementDef => ({
  id, program: 'hazardous_waste', title: `T ${id}`, citation: '40 CFR 262', authority: 'US EPA', summary: 's',
  applicabilityNote: 'n', reviewFrequency: 'annual', ...over,
})
const lib = (entries: LegalRequirementDef[]) => resolveLibrary(['federal'], {
  federal: { meta: { jurisdiction: 'federal', version: '1', draftedOn: '2026-10-07', lastVerified: null, status: 'draft', reviewer: null }, legal: { add: entries } } as JurisdictionPack,
})
const ctx = (over = {}) => ({ profile: { ...EMPTY_SITE_PROFILE, ...over }, generatorCategory: null })

describe('planLegalEntries', () => {
  it('suggests applicable entries not already in the register, tagged with their source and a verify note', () => {
    const plan = planLegalEntries(lib([legal('a', { verify: 'confirm current text', sourceUrl: 'https://x.test' })]), ctx(), 'fac-1', new Set())
    expect(plan.toCreate).toEqual([{
      library_key: 'a', program: 'hazardous_waste', title: 'T a', citation: '40 CFR 262', jurisdiction: 'federal', authority: 'US EPA',
      summary: 's', applicability_note: 'n', source_url: 'https://x.test', review_frequency: 'annual', verify: 'confirm current text', facility_id: 'fac-1',
    }])
  })

  it('never overwrites an entry that is already there (a person may have evaluated it)', () => {
    const plan = planLegalEntries(lib([legal('a'), legal('b')]), ctx(), null, new Set(['a']))
    expect(plan.toCreate.map(e => e.library_key)).toEqual(['b'])
    expect(plan.existing).toEqual(['a'])
  })

  it('leaves out what does not apply and reports it', () => {
    const plan = planLegalEntries(lib([legal('tv', { appliesWhen: { airPermitType: ['title_v'] } })]), ctx(), null, new Set())
    expect(plan).toEqual({ toCreate: [], existing: [], notApplicable: ['tv'] })
  })

  it('a tenant-wide entry has no facility', () => {
    expect(planLegalEntries(lib([legal('a')]), ctx(), null, new Set()).toCreate[0]!.facility_id).toBeNull()
  })
})

describe('validateEvaluation', () => {
  const ok = (body: unknown) => { const r = validateEvaluation(body); if (!r.ok) throw new Error(r.errors.join(' | ')); return r.evaluation }
  const errors = (body: unknown) => { const r = validateEvaluation(body); return r.ok ? [] : r.errors }

  it('accepts an applicable, compliant evaluation', () => {
    expect(ok({ applicability: 'applicable', compliance_status: 'compliant' })).toEqual({ applicability: 'applicable', complianceStatus: 'compliant', note: null })
  })

  it('defaults an omitted rating to not evaluated', () => {
    expect(ok({ applicability: 'under_review' }).complianceStatus).toBe('not_evaluated')
  })

  it('a requirement that does not apply cannot also be rated', () => {
    expect(errors({ applicability: 'not_applicable', compliance_status: 'compliant' })[0]).toMatch(/cannot also be rated/)
    expect(ok({ applicability: 'not_applicable', note: 'No outfalls' }).complianceStatus).toBe('not_evaluated')
  })

  it('a rating of attention or non-compliant must say what is wrong', () => {
    expect(errors({ applicability: 'applicable', compliance_status: 'non_compliant' })[0]).toMatch(/needs a note/)
    expect(errors({ applicability: 'applicable', compliance_status: 'attention', note: '   ' })[0]).toMatch(/needs a note/)
    expect(ok({ applicability: 'applicable', compliance_status: 'attention', note: 'Log is incomplete' }).note).toBe('Log is incomplete')
  })

  it('rejects what it does not understand and bounds the note', () => {
    expect(errors({ applicability: 'maybe' })[0]).toMatch(/applicability must be one of/)
    expect(errors({ applicability: 'applicable', compliance_status: 'fine' })[0]).toMatch(/compliance_status must be one of/)
    expect(errors({ applicability: 'applicable', note: 5 })[0]).toMatch(/note must be text/)
    expect(errors({ applicability: 'applicable', note: 'x'.repeat(2001) })[0]).toMatch(/too long/)
    expect(errors('x')).toEqual(['Expected an object.'])
  })
})
