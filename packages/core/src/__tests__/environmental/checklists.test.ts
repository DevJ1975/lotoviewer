import { describe, it, expect } from 'vitest'
import {
  buildTemplateRows, missingRequiredItems, failuresToNonconformities, checklistDueStatus,
  jurisdictionKey, templateInstanceKey, ENV_TEMPLATE_CATEGORY, type FailableItem,
} from '../../environmental/checklists'
import type { ChecklistItemDef, ResolvedChecklistTemplate } from '../../environmental/content'
import { EMPTY_SITE_PROFILE } from '../../environmental/siteProfile'

const at = (iso: string) => new Date(`${iso}T09:00:00Z`)

const item = (id: string, over: Partial<ChecklistItemDef> = {}) => ({
  id, section: 'Observations', prompt: `Prompt ${id}`, itemType: 'pass_fail_na' as const, weight: 1, required: true,
  failCreatesAction: true, critical: false, citations: [{ ref: 'IGP §XI.A.1' }], source: 'federal' as const, ...over,
})

const template = (items: ReturnType<typeof item>[]): ResolvedChecklistTemplate => ({
  id: 'sw-visual', program: 'stormwater', name: 'Quarterly visual assessment', description: 'Look at the discharge.',
  subjectType: 'outfall', cadence: 'quarterly', items, citations: [{ ref: 'MSGP Part 3.2' }], source: 'federal',
})

const ctx = (profile = {}) => ({ profile: { ...EMPTY_SITE_PROFILE, ...profile }, generatorCategory: null })
const version = { libraryVersion: '0.1.0', lastVerified: null }

describe('templateInstanceKey', () => {
  const gated = template([
    item('always'),
    item('air-only', { appliesWhen: { airPermitType: ['title_v'] } }),
    item('swppp-only', { appliesWhen: { stormwaterCoverage: ['general_permit'] } }),
  ])
  const chain = ['federal', 'CA'] as const

  it('is just the layers when every item applies, so ordinary sites share one instance', () => {
    const everything = ctx({ airPermitType: 'title_v', stormwaterCoverage: 'general_permit' })
    expect(templateInstanceKey(gated, everything, chain)).toBe('federal+CA')
    expect(templateInstanceKey(template([item('a'), item('b')]), ctx(), chain)).toBe('federal+CA')
  })

  it('gives sites with different applicable items different instances, so one site never inherits another\'s checklist', () => {
    const titleV = ctx({ airPermitType: 'title_v' })
    const stormwater = ctx({ stormwaterCoverage: 'general_permit' })
    const a = templateInstanceKey(gated, titleV, chain)
    const b = templateInstanceKey(gated, stormwater, chain)
    expect(a).toMatch(/^federal\+CA#[0-9a-f]{8}$/)
    expect(b).toMatch(/^federal\+CA#[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
  })

  it('is the same for sites whose profiles differ but whose applicable items do not', () => {
    // Neither site has an air permit or a general stormwater permit, so both get only 'always'.
    expect(templateInstanceKey(gated, ctx({ wastewaterDischarge: 'none' }), chain))
      .toBe(templateInstanceKey(gated, ctx({ notes: 'x', potwName: 'City POTW' }), chain))
  })

  it('is deterministic, and fits the 40-character column', () => {
    const key = templateInstanceKey(gated, ctx({ airPermitType: 'title_v' }), ['federal', 'CA'])
    expect(key).toBe(templateInstanceKey(gated, ctx({ airPermitType: 'title_v' }), ['federal', 'CA']))
    expect(key.length).toBeLessThanOrEqual(40)
  })

  it('is what the companion row records', () => {
    const rows = buildTemplateRows(gated, ctx({ airPermitType: 'title_v' }), chain, version)
    expect(rows.companion.jurisdiction_key).toBe(templateInstanceKey(gated, ctx({ airPermitType: 'title_v' }), chain))
    expect(rows.items.map(i => i.config.library_item_id)).toEqual(['always', 'air-only'])
  })
})

describe('buildTemplateRows', () => {
  it('produces ordinary engine rows in the environmental category', () => {
    const rows = buildTemplateRows(template([item('a'), item('b')]), ctx(), ['federal', 'CA'], version)
    expect(rows.template).toEqual({ name: 'Quarterly visual assessment', description: 'Look at the discharge.', category: ENV_TEMPLATE_CATEGORY, scoring_mode: 'weighted' })
    expect(rows.items.map(i => [i.sort_order, i.item_type, i.required, i.weight, i.fail_creates_action])).toEqual([
      [0, 'pass_fail_na', true, 1, true], [1, 'pass_fail_na', true, 1, true],
    ])
  })

  it('records the library origin in a companion row', () => {
    const { companion } = buildTemplateRows(template([item('a')]), ctx(), ['federal', 'CA'], { libraryVersion: '0.2.0', lastVerified: '2026-09-01' })
    expect(companion).toEqual({
      library_key: 'sw-visual', jurisdiction_key: 'federal+CA', program: 'stormwater', subject_type: 'outfall',
      cadence: 'quarterly', cadence_days: null, library_version: '0.2.0', last_verified: '2026-09-01',
    })
    expect(jurisdictionKey(['federal'])).toBe('federal')
  })

  it('carries citations, criticality and the ISO clause in each item config', () => {
    const rows = buildTemplateRows(template([item('a', {
      critical: true, clauseRef: '9.1.1', guidance: 'Look for sheen.',
      citations: [{ ref: 'X', title: 'T', verify: 'check current text' }],
    })]), ctx(), ['federal'], version)
    expect(rows.items[0]!.config).toEqual({
      library_item_id: 'a', critical: true, clause_ref: '9.1.1', guidance: 'Look for sheen.',
      citations: [{ ref: 'X', title: 'T', verify: 'check current text' }],
    })
  })

  it('puts numeric limits where the engine\'s submit route reads them', () => {
    const rows = buildTemplateRows(template([item('ph', { itemType: 'numeric', numeric: { min: 6, max: 9, unit: 'pH' } })]), ctx(), ['federal'], version)
    expect(rows.items[0]!.config).toMatchObject({ min: 6, max: 9, unit: 'pH' })
    const open = buildTemplateRows(template([item('flow', { itemType: 'numeric', numeric: { max: 5, unit: 'gpm' } })]), ctx(), ['federal'], version)
    expect(open.items[0]!.config).toMatchObject({ max: 5, unit: 'gpm' })
    expect(open.items[0]!.config).not.toHaveProperty('min')
  })

  it('leaves out an item that does not apply to this site, and numbers the rest densely', () => {
    const t = template([item('a'), item('only-ca', { appliesWhen: { stormwaterPermit: ['ca_igp'] } }), item('c')])
    const plain = buildTemplateRows(t, ctx(), ['federal'], version)
    expect(plain.items.map(i => (i.config as { library_item_id: string }).library_item_id)).toEqual(['a', 'c'])
    expect(plain.items.map(i => i.sort_order)).toEqual([0, 1])
    const ca = buildTemplateRows(t, ctx({ stormwaterGeneralPermit: 'ca_igp' }), ['federal'], version)
    expect(ca.items).toHaveLength(3)
  })
})

describe('missingRequiredItems', () => {
  const items = [
    { id: 'pf', itemType: 'pass_fail_na' as const, required: true },
    { id: 'num', itemType: 'numeric' as const, required: true },
    { id: 'txt', itemType: 'text' as const, required: true },
    { id: 'pic', itemType: 'photo' as const, required: true },
    { id: 'sig', itemType: 'signature' as const, required: true },
    { id: 'opt', itemType: 'pass_fail_na' as const, required: false },
  ]

  it('lists every required item with no answer', () => {
    expect(missingRequiredItems(items, [])).toEqual(['pf', 'num', 'txt', 'pic', 'sig'])
  })

  it('accepts the right kind of answer for each item type', () => {
    const answers = [
      { itemId: 'pf', result: 'na' as const }, { itemId: 'num', result: null, value: 0 },
      { itemId: 'txt', result: null, value: 'ok' }, { itemId: 'pic', result: null, evidenceId: 'e1' },
      { itemId: 'sig', result: null, value: 'Pat Doe' },
    ]
    expect(missingRequiredItems(items, answers)).toEqual([])
  })

  it('a skipped question never reads as a pass: blank, whitespace, NaN and an empty photo are unanswered', () => {
    const answers = [
      { itemId: 'pf', result: null }, { itemId: 'num', result: null, value: NaN },
      { itemId: 'txt', result: null, value: '   ' }, { itemId: 'pic', result: null, evidenceId: '' },
      { itemId: 'sig', result: null, value: '' },
    ]
    expect(missingRequiredItems(items, answers)).toEqual(['pf', 'num', 'txt', 'pic', 'sig'])
  })

  it('a numeric zero is an answer', () => {
    expect(missingRequiredItems([items[1]!], [{ itemId: 'num', result: null, value: 0 }])).toEqual([])
  })

  it('does not ask for optional items', () => {
    expect(missingRequiredItems([items[5]!], [])).toEqual([])
  })

  it('a signature may be drawn (evidence) or typed (value)', () => {
    expect(missingRequiredItems([items[4]!], [{ itemId: 'sig', result: null, evidenceId: 'img' }])).toEqual([])
  })
})

describe('failuresToNonconformities', () => {
  const failable = (id: string, over: Partial<FailableItem> = {}): FailableItem => ({
    id, prompt: `Is ${id} clear?`, itemType: 'pass_fail_na', failCreatesAction: true, critical: false,
    citations: [{ ref: 'IGP §XI.A.1' }, { ref: 'MSGP 3.2' }], ...over,
  })
  const base = {
    inspectionId: 'insp-1', templateName: 'Outfall inspection', facilityId: 'fac-1',
    identifiedAt: '2026-10-07', identifiedBy: 'user-1', ownerUserId: null as string | null,
  }

  it('raises one finding per failed action item, traceable to the inspection and item', () => {
    const rows = failuresToNonconformities({
      ...base, subjectLabel: 'OF-002', items: [failable('sheen'), failable('marker')],
      answers: [{ itemId: 'sheen', result: 'fail', note: 'Rainbow sheen at weir' }, { itemId: 'marker', result: 'pass' }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      title: 'Outfall inspection: Is sheen clear?', source_type: 'inspection', source_reference: 'env-checklist:insp-1:sheen',
      classification: 'observation', clause_ref: '8.1', identified_at: '2026-10-07', identified_by: 'user-1', facility_id: 'fac-1',
    })
    expect(rows[0]!.description).toContain('Failed on "Outfall inspection" (OF-002): Is sheen clear?')
    expect(rows[0]!.description).toContain('Note: Rainbow sheen at weir')
    expect(rows[0]!.description).toContain('Basis: IGP §XI.A.1; MSGP 3.2')
  })

  it('never raises a finding as MAJOR on its own: a critical failure is a MINOR, anything else an observation', () => {
    const rows = failuresToNonconformities({
      ...base, items: [failable('critical', { critical: true }), failable('ordinary')],
      answers: [{ itemId: 'critical', result: 'fail' }, { itemId: 'ordinary', result: 'fail' }],
    })
    expect(rows.map(r => r.classification)).toEqual(['minor', 'observation'])
    expect(rows.some(r => r.classification === 'major')).toBe(false)
    expect(rows[0]!.description).toContain('marked critical')
  })

  it('raises nothing for a pass, an n/a, an unanswered item, or a fail on an item that does not create an action', () => {
    const rows = failuresToNonconformities({
      ...base, items: [failable('a'), failable('b'), failable('c'), failable('d', { failCreatesAction: false })],
      answers: [{ itemId: 'a', result: 'pass' }, { itemId: 'b', result: 'na' }, { itemId: 'd', result: 'fail' }],
    })
    expect(rows).toEqual([])
  })

  it('ignores a "fail" recorded on a text or photo item, as the engine does', () => {
    const rows = failuresToNonconformities({
      ...base, items: [failable('note', { itemType: 'text' }), failable('pic', { itemType: 'photo' })],
      answers: [{ itemId: 'note', result: 'fail' }, { itemId: 'pic', result: 'fail' }],
    })
    expect(rows).toEqual([])
  })

  it('is deterministic, so submitting twice raises the same reference and cannot duplicate a finding', () => {
    const args = { ...base, items: [failable('sheen')], answers: [{ itemId: 'sheen', result: 'fail' as const }] }
    expect(failuresToNonconformities(args)).toEqual(failuresToNonconformities(args))
    expect(failuresToNonconformities(args)[0]!.source_reference).toBe('env-checklist:insp-1:sheen')
  })

  it('uses the item\'s ISO clause when it has one, and keeps long titles within the limit', () => {
    const rows = failuresToNonconformities({
      ...base, items: [failable('x', { clauseRef: '9.1.1', prompt: 'p'.repeat(400) })], answers: [{ itemId: 'x', result: 'fail' }],
    })
    expect(rows[0]!.clause_ref).toBe('9.1.1')
    expect(rows[0]!.title.length).toBe(200)
  })

  it('notes an attached photo without exposing its path', () => {
    const rows = failuresToNonconformities({
      ...base, items: [failable('x')], answers: [{ itemId: 'x', result: 'fail', evidenceId: 'tenant/secret/path.jpg' }],
    })
    expect(rows[0]!.description).toContain('A photo was attached')
    expect(rows[0]!.description).not.toContain('secret')
  })
})

describe('checklistDueStatus', () => {
  it('is "never" for a template nobody has run', () => {
    expect(checklistDueStatus(null, 'quarterly', null, at('2026-10-07'))).toEqual({ status: 'never', dueOn: null, daysUntil: null })
  })

  it('is ok, due_soon or overdue relative to the cadence', () => {
    expect(checklistDueStatus('2026-09-01', 'quarterly', null, at('2026-10-07')).status).toBe('ok')           // next 2026-12-01
    expect(checklistDueStatus('2026-07-20', 'quarterly', null, at('2026-10-07'))).toMatchObject({ status: 'due_soon', dueOn: '2026-10-20', daysUntil: 13 })
    expect(checklistDueStatus('2026-06-01', 'quarterly', null, at('2026-10-07'))).toMatchObject({ status: 'overdue', dueOn: '2026-09-01' })
  })

  it('keeps month-end cadences on month ends', () => {
    expect(checklistDueStatus('2026-01-31', 'monthly', null, at('2026-02-01')).dueOn).toBe('2026-02-28')
  })

  it('supports a custom interval', () => {
    expect(checklistDueStatus('2026-10-01', 'custom_days', 10, at('2026-10-07')).dueOn).toBe('2026-10-11')
  })
})
