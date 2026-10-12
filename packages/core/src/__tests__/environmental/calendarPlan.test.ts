import { describe, it, expect } from 'vitest'
import {
  firstDueDate, planLibraryObligations, applicableObligationKeys, librarySystemKey, LIBRARY_CATEGORY,
} from '../../environmental/calendarPlan'
import { resolveLibrary } from '../../environmental/resolve'
import type { JurisdictionPack, ObligationDef } from '../../environmental/content'
import { EMPTY_SITE_PROFILE } from '../../environmental/siteProfile'

const at = (iso: string) => new Date(`${iso}T09:00:00Z`)
const FACILITY = 'f0000000-0000-0000-0000-000000000001'

describe('firstDueDate', () => {
  it('annual: the next occurrence, today included', () => {
    expect(firstDueDate({ kind: 'annual', month: 7, day: 15 }, 'annual', undefined, at('2026-10-07'))).toBe('2027-07-15')
    expect(firstDueDate({ kind: 'annual', month: 7, day: 15 }, 'annual', undefined, at('2026-03-01'))).toBe('2026-07-15')
    expect(firstDueDate({ kind: 'annual', month: 10, day: 7 }, 'annual', undefined, at('2026-10-07'))).toBe('2026-10-07')
  })

  it('period_end month: the last day of this month, leap February included', () => {
    expect(firstDueDate({ kind: 'period_end', period: 'month' }, 'monthly', undefined, at('2026-10-07'))).toBe('2026-10-31')
    expect(firstDueDate({ kind: 'period_end', period: 'month' }, 'monthly', undefined, at('2028-02-10'))).toBe('2028-02-29')
    expect(firstDueDate({ kind: 'period_end', period: 'month' }, 'monthly', undefined, at('2027-02-10'))).toBe('2027-02-28')
  })

  it('period_end quarter: Mar 31, Jun 30, Sep 30 or Dec 31', () => {
    const q = (d: string) => firstDueDate({ kind: 'period_end', period: 'quarter' }, 'quarterly', undefined, at(d))
    expect([q('2026-01-01'), q('2026-03-31'), q('2026-04-01'), q('2026-08-15'), q('2026-10-07'), q('2026-12-31')])
      .toEqual(['2026-03-31', '2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31', '2026-12-31'])
  })

  it('period_end half: Jun 30 or Dec 31 (California reporting half-years)', () => {
    const h = (d: string) => firstDueDate({ kind: 'period_end', period: 'half' }, 'semiannual', undefined, at(d))
    expect([h('2026-01-15'), h('2026-06-30'), h('2026-07-01'), h('2026-12-31')]).toEqual(['2026-06-30', '2026-06-30', '2026-12-31', '2026-12-31'])
  })

  it('period_end year: Dec 31', () => {
    expect(firstDueDate({ kind: 'period_end', period: 'year' }, 'annual', undefined, at('2026-02-01'))).toBe('2026-12-31')
  })

  it('a deadline on the last day of its period is due that day, not the next period', () => {
    expect(firstDueDate({ kind: 'period_end', period: 'quarter' }, 'quarterly', undefined, at('2026-09-30'))).toBe('2026-09-30')
  })

  it('rolling: one cadence from today, clamped to the month end', () => {
    expect(firstDueDate({ kind: 'rolling' }, 'monthly', undefined, at('2026-10-07'))).toBe('2026-11-07')
    expect(firstDueDate({ kind: 'rolling' }, 'custom_days', 90, at('2026-10-07'))).toBe('2027-01-05')
    expect(firstDueDate({ kind: 'rolling' }, 'monthly', undefined, at('2026-01-31'))).toBe('2026-02-28')
  })
})

const obligation = (id: string, over: Partial<ObligationDef> = {}): ObligationDef => ({
  id, program: 'stormwater', title: `T ${id}`, description: 'd', cadence: 'annual',
  anchor: { kind: 'annual', month: 1, day: 30 }, leadDays: 30,
  citations: [{ ref: '40 CFR 122.26' }, { ref: 'MSGP Part 7' }], ...over,
})

const library = (obligations: ObligationDef[], state?: JurisdictionPack) => {
  const packs: Record<string, JurisdictionPack> = {
    federal: { meta: { jurisdiction: 'federal', version: '1', draftedOn: '2026-10-07', lastVerified: null, status: 'draft', reviewer: null }, obligations: { add: obligations } },
  }
  if (state) packs.CA = state
  return resolveLibrary(state ? ['federal', 'CA'] : ['federal'], packs)
}

const ctx = (over: Partial<typeof EMPTY_SITE_PROFILE> = {}) => ({ profile: { ...EMPTY_SITE_PROFILE, ...over }, generatorCategory: null })

describe('planLibraryObligations', () => {
  it('plans a row per applicable obligation with the fields the calendar needs', () => {
    const plan = planLibraryObligations(library([obligation('annual-report')]), ctx(), FACILITY, new Set(), at('2026-10-07'))
    expect(plan.toCreate).toEqual([{
      system_key: `env:annual-report:${FACILITY}`, library_key: 'annual-report', facility_id: FACILITY, program: 'stormwater',
      title: 'T annual-report', description: 'd', regulatory_ref: '40 CFR 122.26; MSGP Part 7', category: LIBRARY_CATEGORY,
      cadence: 'annual', cadence_days: null, next_due_at: '2027-01-30', lead_days: 30, due_anchor: 'fixed',
      jurisdiction: 'federal', legal_library_key: null, checklist_library_key: null,
    }])
  })

  it('is idempotent: what the site already has is reported, not planned again', () => {
    const existing = new Set([librarySystemKey('annual-report', FACILITY)])
    const plan = planLibraryObligations(library([obligation('annual-report'), obligation('other')]), ctx(), FACILITY, existing, at('2026-10-07'))
    expect(plan.toCreate.map(o => o.library_key)).toEqual(['other'])
    expect(plan.existing).toEqual(['annual-report'])
  })

  it('the same library applied to two facilities gives each its own row', () => {
    const a = planLibraryObligations(library([obligation('x')]), ctx(), FACILITY, new Set(), at('2026-10-07'))
    const b = planLibraryObligations(library([obligation('x')]), ctx(), 'f0000000-0000-0000-0000-000000000002', new Set(), at('2026-10-07'))
    expect(a.toCreate[0]!.system_key).not.toBe(b.toCreate[0]!.system_key)
  })

  it('leaves out an obligation that does not apply to the site and says so', () => {
    const lib = library([obligation('needs-permit', { appliesWhen: { stormwaterCoverage: ['general_permit'] } }), obligation('always')])
    const plan = planLibraryObligations(lib, ctx(), FACILITY, new Set(), at('2026-10-07'))
    expect(plan.toCreate.map(o => o.library_key)).toEqual(['always'])
    expect(plan.notApplicable).toEqual(['needs-permit'])
    const covered = planLibraryObligations(lib, ctx({ stormwaterCoverage: 'general_permit' }), FACILITY, new Set(), at('2026-10-07'))
    expect(covered.toCreate.map(o => o.library_key)).toEqual(['needs-permit', 'always'])
  })

  it('marks a period-end obligation so completing it keeps it on period ends', () => {
    const lib = library([obligation('visual', { cadence: 'quarterly', anchor: { kind: 'period_end', period: 'quarter' } })])
    const [row] = planLibraryObligations(lib, ctx(), FACILITY, new Set(), at('2026-10-07')).toCreate
    expect(row).toMatchObject({ due_anchor: 'period_end', next_due_at: '2026-12-31' })
  })

  it('carries the jurisdiction that defined it and the links to resolve later', () => {
    const ca: JurisdictionPack = {
      meta: { jurisdiction: 'CA', version: '1', draftedOn: '2026-10-07', lastVerified: null, status: 'draft', reviewer: null },
      obligations: { add: [obligation('ca-report', { anchor: { kind: 'annual', month: 7, day: 15 }, legalId: 'lr-ca-igp', checklistTemplateId: 'sw-ca-mvo' })] },
    }
    const plan = planLibraryObligations(library([], ca), ctx(), FACILITY, new Set(), at('2026-10-07'))
    expect(plan.toCreate[0]).toMatchObject({ jurisdiction: 'CA', legal_library_key: 'lr-ca-igp', checklist_library_key: 'sw-ca-mvo', next_due_at: '2027-07-15' })
  })

  it('caps an over-long citation list to what the column holds', () => {
    const long = obligation('long', { citations: Array.from({ length: 80 }, (_, i) => ({ ref: `Reference number ${i}` })) })
    const [row] = planLibraryObligations(library([long]), ctx(), FACILITY, new Set(), at('2026-10-07')).toCreate
    expect(row!.regulatory_ref.length).toBeLessThanOrEqual(300)
  })
})

describe('applicableObligationKeys', () => {
  it('is the system keys an up-to-date site would have, for spotting rows that no longer belong', () => {
    const lib = library([obligation('a'), obligation('b', { appliesWhen: { airPermitType: ['title_v'] } })])
    expect([...applicableObligationKeys(lib, ctx(), FACILITY)]).toEqual([`env:a:${FACILITY}`])
  })
})

// ── the ISO 14001 obligations register (migration 298) ─────────────────────

describe('registerJurisdiction', () => {
  it('writes the register\'s own grammar, which EMS\'s parser reads back', async () => {
    const { registerJurisdiction } = await import('../../environmental/jurisdiction')
    const { parseJurisdiction } = await import('../../complianceEvaluation')
    expect(registerJurisdiction('federal')).toBe('federal')
    expect(registerJurisdiction('CA')).toBe('state:CA')
    expect(registerJurisdiction('TX')).toBe('state:TX')
    for (const code of ['federal', 'CA', 'TX'] as const) {
      expect(parseJurisdiction(registerJurisdiction(code)), code).not.toBeNull()
    }
  })
})

describe('registerColumns', () => {
  const plan = {
    system_key: 'env:sw-ca-qse:site', library_key: 'sw-ca-qse', facility_id: 'site', program: 'stormwater', title: 'QSE sampling',
    description: '', regulatory_ref: 'CA IGP Section XI', category: 'environmental', cadence: 'quarterly', cadence_days: null,
    next_due_at: '2026-12-31', lead_days: 14, due_anchor: 'period_end', jurisdiction: 'CA', legal_library_key: null, checklist_library_key: null,
  } as unknown as Parameters<typeof import('../../environmental/calendarPlan').registerColumns>[0]

  it('puts a library deadline in the ISO 14001 register as a legal requirement, in the register\'s jurisdiction grammar', async () => {
    const { registerColumns } = await import('../../environmental/calendarPlan')
    const { parseJurisdiction } = await import('../../complianceEvaluation')
    const columns = registerColumns(plan)
    expect(columns).toMatchObject({ discipline: 'ems', source_kind: 'law', jurisdiction: 'state:CA' })
    expect(parseJurisdiction(columns.jurisdiction)).toEqual({ level: 'state', state: 'CA' })
  })

  it('says where the deadline came from and what to do about it, naming the program and the citation', async () => {
    const { registerColumns } = await import('../../environmental/calendarPlan')
    const text = registerColumns(plan).applicability_rationale
    expect(text).toContain('California')
    expect(text).toContain('Stormwater')
    expect(text).toContain('CA IGP Section XI')
    expect(text).toMatch(/Confirm it against your permits/)
  })

  it('names the federal baseline as federal', async () => {
    const { registerColumns } = await import('../../environmental/calendarPlan')
    expect(registerColumns({ ...plan, jurisdiction: 'federal' }).applicability_rationale).toContain('federal compliance library')
  })

  it('never sets an evaluation frequency: that is a person\'s decision, because it makes the register open and email an evaluation', async () => {
    const { registerColumns } = await import('../../environmental/calendarPlan')
    expect(Object.keys(registerColumns(plan))).not.toContain('evaluation_cadence_days')
  })
})
