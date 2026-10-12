import { describe, it, expect } from 'vitest'
import {
  reviewState, nextReviewDate, planReview, planLegalEntries, validateEvaluation, validateLegalEntry, validateEvidencePath,
  toLegalRow, parseLegalRow, parseReviewFrequency, type LegalEntryInput,
} from '../../environmental/legalRegister'
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

describe('planReview', () => {
  it('records the review and sets the next one a year or two out', () => {
    expect(planReview('2026-10-07T15:30:00.000Z', 'annual')).toEqual({ last_reviewed_at: '2026-10-07T15:30:00.000Z', next_review_due: '2027-10-07' })
    expect(planReview('2026-10-07T15:30:00.000Z', 'biennial').next_review_due).toBe('2028-10-07')
  })

  it('reviews yearly an entry that has no frequency of its own, so it never drops out of the cycle', () => {
    expect(planReview('2026-10-07T15:30:00.000Z', null).next_review_due).toBe('2027-10-07')
  })

  it('clamps Feb 29 like nextReviewDate', () => {
    expect(planReview('2028-02-29T09:00:00.000Z', 'annual').next_review_due).toBe('2029-02-28')
  })
})

describe('parseReviewFrequency', () => {
  it('reads a known frequency and treats anything else in the free-text column as none', () => {
    expect(parseReviewFrequency('annual')).toBe('annual')
    expect(parseReviewFrequency('biennial')).toBe('biennial')
    expect(parseReviewFrequency('quarterly')).toBeNull()
    expect(parseReviewFrequency(null)).toBeNull()
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

const TENANT_PREFIX = '11111111-1111-1111-1111-111111111111/'
const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PERSON = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

const minimal = { title: 'County odor ordinance', citation: 'Cty Code 12.4', jurisdiction: 'CA' }

describe('validateLegalEntry', () => {
  const check = (body: unknown, current?: LegalEntryInput) => validateLegalEntry(body, { evidencePathPrefix: TENANT_PREFIX, current })
  const ok = (body: unknown, current?: LegalEntryInput) => { const r = check(body, current); if (!r.ok) throw new Error(r.errors.join(' | ')); return r.entry }
  const errors = (body: unknown, current?: LegalEntryInput) => { const r = check(body, current); return r.ok ? [] : r.errors }

  it('accepts a title, citation and jurisdiction, and leaves everything else empty (tenant-wide, no program)', () => {
    expect(ok(minimal)).toEqual({
      facilityId: null, title: 'County odor ordinance', citation: 'Cty Code 12.4', jurisdiction: 'CA', authority: null, summary: null,
      applicabilityNote: null, sourceUrl: null, effectiveDate: null, reviewFrequency: null, program: null, ownerUserId: null, tags: [], evidencePath: null,
    })
  })

  it('accepts and normalises every descriptive field', () => {
    expect(ok({
      facility_id: SITE.toUpperCase(), title: '  Clean Air Act  ', citation: '42 USC 7401', jurisdiction: 'federal', authority: 'US EPA',
      summary: 'What it says', applicability_note: 'Applies to major sources', source_url: ' https://www.epa.gov/clean-air-act ',
      effective_date: '1970-12-31', review_frequency: 'biennial', program: 'air', owner_user_id: PERSON, tags: [' air ', 'title-v'],
      evidence_path: `${TENANT_PREFIX}audit.pdf`,
    })).toEqual({
      facilityId: SITE, title: 'Clean Air Act', citation: '42 USC 7401', jurisdiction: 'federal', authority: 'US EPA', summary: 'What it says',
      applicabilityNote: 'Applies to major sources', sourceUrl: 'https://www.epa.gov/clean-air-act', effectiveDate: '1970-12-31',
      reviewFrequency: 'biennial', program: 'air', ownerUserId: PERSON, tags: ['air', 'title-v'], evidencePath: `${TENANT_PREFIX}audit.pdf`,
    })
  })

  it('lists every problem at once', () => {
    expect(errors({})).toEqual(['title is required.', 'citation is required.', 'jurisdiction is required.'])
    expect(errors({ ...minimal, title: '   ', program: 'nonsense', effective_date: 'soon' }).length).toBe(3)
    expect(errors('x')).toEqual(['Expected an object.'])
    expect(errors([])).toEqual(['Expected an object.'])
  })

  it('takes jurisdiction as "federal" or a two-letter upper-case state code', () => {
    expect(ok({ ...minimal, jurisdiction: 'federal' }).jurisdiction).toBe('federal')
    for (const bad of ['ca', 'California', 'USA', 'Federal', 'C1']) {
      expect(errors({ ...minimal, jurisdiction: bad })[0], bad).toMatch(/jurisdiction must be "federal" or a two-letter state code/)
    }
  })

  it('bounds the text fields', () => {
    const limits: Array<[string, number]> = [
      ['title', 300], ['citation', 300], ['authority', 300], ['summary', 4000], ['applicability_note', 2000],
    ]
    for (const [key, limit] of limits) {
      expect(errors({ ...minimal, [key]: 'x'.repeat(limit) }), `${key} at the limit`).toEqual([])
      expect(errors({ ...minimal, [key]: 'x'.repeat(limit + 1) })[0], `${key} over the limit`).toMatch(/too long/)
    }
    expect(errors({ ...minimal, title: 5 })[0]).toBe('title must be text.')
  })

  describe('source_url', () => {
    it('takes http and https addresses', () => {
      expect(ok({ ...minimal, source_url: 'http://example.test/rule' }).sourceUrl).toBe('http://example.test/rule')
      expect(ok({ ...minimal, source_url: 'HTTPS://Example.test/Rule?a=1#b' }).sourceUrl).toBe('HTTPS://Example.test/Rule?a=1#b')
    })

    it('refuses every other scheme, and anything that is not an absolute web address', () => {
      const unsafe = [
        'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd',
        'ftp://example.test/rule', '//example.test/rule', 'example.test/rule', 'https://', 'https:///rule', 'http://exa mple.test',
        'https://example.test/\njavascript:alert(1)', 'java\nscript:alert(1)',
      ]
      for (const url of unsafe) expect(errors({ ...minimal, source_url: url })[0], url).toBe('source_url must be a web address starting with http:// or https://.')
    })

    it('is at most 500 characters, and clearing it is allowed', () => {
      expect(errors({ ...minimal, source_url: `https://e.test/${'x'.repeat(500)}` })[0]).toMatch(/too long/)
      expect(ok({ ...minimal, source_url: null }).sourceUrl).toBeNull()
      expect(ok({ ...minimal, source_url: '' }).sourceUrl).toBeNull()
    })
  })

  it('takes only a real calendar date for effective_date', () => {
    expect(ok({ ...minimal, effective_date: '2028-02-29' }).effectiveDate).toBe('2028-02-29')
    for (const bad of ['2027-02-30', '2027-13-01', '10/07/2026', 'soon', 20270101]) {
      expect(errors({ ...minimal, effective_date: bad })[0], String(bad)).toMatch(/effective_date must be a date/)
    }
  })

  it('takes a review frequency of annual, biennial or none', () => {
    expect(ok({ ...minimal, review_frequency: 'annual' }).reviewFrequency).toBe('annual')
    expect(ok({ ...minimal, review_frequency: null }).reviewFrequency).toBeNull()
    expect(errors({ ...minimal, review_frequency: 'quarterly' })[0]).toMatch(/review_frequency must be one of: annual, biennial/)
  })

  it('takes a program from the environmental programs, or none', () => {
    expect(ok({ ...minimal, program: 'outfall' }).program).toBe('outfall')
    expect(ok({ ...minimal, program: null }).program).toBeNull()
    expect(errors({ ...minimal, program: 'other' })[0]).toMatch(/program must be one of: stormwater, outfall/)
  })

  it('takes a site and an owner as ids, or null; null site means the whole company', () => {
    expect(ok({ ...minimal, facility_id: null }).facilityId).toBeNull()
    expect(ok({ ...minimal, owner_user_id: PERSON }).ownerUserId).toBe(PERSON)
    for (const key of ['facility_id', 'owner_user_id']) {
      for (const bad of ['nope', '', 5]) expect(errors({ ...minimal, [key]: bad })[0], `${key}=${String(bad)}`).toBe(`${key} must be an id, or null.`)
    }
  })

  it('takes at most 20 short tags', () => {
    expect(ok({ ...minimal, tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }).tags).toHaveLength(20)
    expect(errors({ ...minimal, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })[0]).toMatch(/at most 20/)
    expect(errors({ ...minimal, tags: ['x'.repeat(51)] })[0]).toMatch(/Each tag must be text of 1 to 50/)
    expect(errors({ ...minimal, tags: ['ok', '  '] })[0]).toMatch(/Each tag/)
    expect(errors({ ...minimal, tags: ['ok', 3] })[0]).toMatch(/Each tag/)
    expect(errors({ ...minimal, tags: 'air' })[0]).toMatch(/tags must be a list/)
  })

  describe('evidence_path', () => {
    it('must be in the caller\'s own folder, with no way out of it, and at most 300 characters', () => {
      expect(ok({ ...minimal, evidence_path: `${TENANT_PREFIX}audit.pdf` }).evidencePath).toBe(`${TENANT_PREFIX}audit.pdf`)
      const refused = [
        '22222222-2222-2222-2222-222222222222/audit.pdf', 'audit.pdf', `/${TENANT_PREFIX}audit.pdf`,
        `${TENANT_PREFIX}../22222222-2222-2222-2222-222222222222/audit.pdf`, `${TENANT_PREFIX}${'x'.repeat(300)}`, 7,
      ]
      for (const path of refused) expect(errors({ ...minimal, evidence_path: path })[0], String(path)).toBe('evidence_path must be a file you uploaded to this account.')
    })

    it('can be cleared', () => {
      expect(ok({ ...minimal, evidence_path: null }).evidencePath).toBeNull()
      expect(ok({ ...minimal, evidence_path: '' }).evidencePath).toBeNull()
    })

    it('validateEvidencePath is the one rule behind it', () => {
      expect(validateEvidencePath(`${TENANT_PREFIX}a.pdf`, TENANT_PREFIX)).toEqual({ ok: true, path: `${TENANT_PREFIX}a.pdf` })
      expect(validateEvidencePath(null, TENANT_PREFIX)).toEqual({ ok: true, path: null })
      expect(validateEvidencePath('other/a.pdf', TENANT_PREFIX).ok).toBe(false)
    })
  })

  it('does not read the evaluation or the server-owned columns, so a body carrying them cannot change them', () => {
    const withServerFields = {
      ...minimal, applicability: 'not_applicable', compliance_status: 'non_compliant', evaluation_note: 'sneaky', library_key: 'cwa-402',
      library_version: 'federal@0.1.0', source: 'library', ai_generated: true, created_by: PERSON, tenant_id: '22222222-2222-2222-2222-222222222222',
      last_evaluated_at: '2026-01-01T00:00:00Z', last_evaluated_by: PERSON, last_reviewed_at: '2026-01-01T00:00:00Z', next_review_due: '2099-01-01',
      status: 'repealed', id: PERSON,
    }
    expect(ok(withServerFields)).toEqual(ok(minimal))
    const columns = Object.keys(toLegalRow(ok(withServerFields)))
    for (const owned of ['applicability', 'compliance_status', 'evaluation_note', 'library_key', 'library_version', 'source', 'ai_generated',
      'created_by', 'tenant_id', 'last_evaluated_at', 'last_evaluated_by', 'last_reviewed_at', 'next_review_due', 'status', 'id']) {
      expect(columns, owned).not.toContain(owned)
    }
  })

  describe('editing an existing entry', () => {
    const current: LegalEntryInput = {
      facilityId: SITE, title: 'Clean Water Act s.402', citation: '33 USC 1342', jurisdiction: 'federal', authority: 'US EPA',
      summary: 'NPDES', applicabilityNote: 'Direct dischargers', sourceUrl: 'https://www.epa.gov/npdes', effectiveDate: '1972-10-18',
      reviewFrequency: 'annual', program: 'wastewater', ownerUserId: PERSON, tags: ['npdes'], evidencePath: `${TENANT_PREFIX}npdes.pdf`,
    }

    it('keeps every field the body leaves out', () => {
      expect(ok({}, current)).toEqual(current)
      expect(ok({ summary: 'Updated' }, current)).toEqual({ ...current, summary: 'Updated' })
    })

    it('clears a field sent as null, but cannot clear a required one', () => {
      expect(ok({ authority: null, owner_user_id: null, facility_id: null, program: null }, current))
        .toMatchObject({ authority: null, ownerUserId: null, facilityId: null, program: null })
      expect(errors({ title: null }, current)).toEqual(['title is required.'])
      expect(errors({ citation: '' }, current)).toEqual(['citation is required.'])
    })

    it('can move the entry to another site', () => {
      const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      expect(ok({ facility_id: other }, current).facilityId).toBe(other)
    })

    it('does not re-judge a stored value the edit did not touch', () => {
      const legacy = { ...current, jurisdiction: 'California', sourceUrl: 'www.example.test' }
      expect(ok({ summary: 'Updated' }, legacy)).toEqual({ ...legacy, summary: 'Updated' })
      expect(errors({ jurisdiction: 'California' }, legacy)[0]).toMatch(/jurisdiction must be/)
    })
  })
})

describe('toLegalRow / parseLegalRow', () => {
  const entry: LegalEntryInput = {
    facilityId: SITE, title: 'T', citation: 'C', jurisdiction: 'TX', authority: 'A', summary: 'S', applicabilityNote: 'N',
    sourceUrl: 'https://e.test', effectiveDate: '2020-01-01', reviewFrequency: 'biennial', program: 'spcc', ownerUserId: PERSON,
    tags: ['x'], evidencePath: `${TENANT_PREFIX}e.pdf`,
  }

  it('writes only the descriptive columns, and reads them back', () => {
    const row = toLegalRow(entry)
    expect(Object.keys(row).sort()).toEqual([
      'applicability_note', 'authority', 'citation', 'effective_date', 'evidence_path', 'facility_id', 'jurisdiction', 'owner_user_id',
      'program', 'review_frequency', 'source_url', 'summary', 'tags', 'title',
    ])
    expect(parseLegalRow(row)).toEqual(entry)
  })

  it('reads a sparse stored row, including values the table does not constrain', () => {
    expect(parseLegalRow({
      title: 'T', citation: 'C', jurisdiction: 'federal', review_frequency: 'quarterly', program: 'mystery', tags: ['ok', 5, null],
    })).toEqual({
      facilityId: null, title: 'T', citation: 'C', jurisdiction: 'federal', authority: null, summary: null, applicabilityNote: null,
      sourceUrl: null, effectiveDate: null, reviewFrequency: null, program: null, ownerUserId: null, tags: ['ok'], evidencePath: null,
    })
  })
})
