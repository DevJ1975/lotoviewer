import { describe, it, expect } from 'vitest'
import { applies } from '@soteria/core/environmental/applicability'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { EMPTY_SITE_PROFILE, type SiteProfile } from '@soteria/core/environmental/siteProfile'
import type { NonconformityInsert } from '@soteria/core/environmental/checklists'
import {
  parseSubmitBody, startChecklist, submitChecklist,
  type NewRun, type ObligationRow, type RunItem, type RunSnapshot, type RunStore, type SubmitInput,
} from '@/lib/environmental/checklistRuns'
import type { SiteContext } from '@/lib/environmental/siteContext'

const TENANT = '11111111-1111-1111-1111-111111111111'
const FACILITY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-07T15:00:00Z')

function site(profile: Partial<SiteProfile> = {}): SiteContext {
  const { jurisdiction, library } = libraryForState('CA')
  const full = {
    ...EMPTY_SITE_PROFILE, stormwaterCoverage: 'general_permit' as const, stormwaterGeneralPermit: 'ca_igp',
    airPermitType: 'minor_permit' as const, wastewaterDischarge: 'potw_indirect' as const, ...profile,
  }
  return {
    facility: { id: FACILITY, name: 'Plant 1', state: 'CA' }, profileRow: null, profile: full, jurisdiction, library,
    applicability: { profile: full, generatorCategory: 'sqg' },
  }
}

const obligation = (over: Partial<ObligationRow> = {}): ObligationRow => ({
  id: 'ob-1', title: 'Quarterly inspection', status: 'open', cadence: 'quarterly', cadence_days: null,
  next_due_at: '2026-09-30', due_anchor: 'period_end', owner_user_id: 'owner-1', facility_id: FACILITY, library_key: null, ...over,
})

const item = (over: Partial<RunItem> & { id: string }): RunItem => ({
  item_type: 'pass_fail_na', prompt: `Prompt ${over.id}`, section: 'S', sort_order: 0, required: false, weight: 1,
  fail_creates_action: true, config: {}, ...over,
})

const ITEMS: RunItem[] = [
  item({ id: 'i1', required: true, config: { critical: true, clause_ref: '9.1.1', citations: [{ ref: 'IGP §XI' }] } }),
  item({ id: 'i2' }),
  item({ id: 'ph', item_type: 'numeric', required: true, config: { min: 6, max: 9, unit: 'pH' } }),
  item({ id: 'photo', item_type: 'photo', fail_creates_action: false }),
]

interface World {
  snapshot: RunSnapshot
  obligations: Map<string, ObligationRow>
  findings: NonconformityInsert[]
  events: Array<{ obligationId: string; occurrenceAt: string; inspectionId: string }>
  log: string[]
  failOn?: string
  signatureSaved: boolean
}

function world(over: { status?: 'in_progress' | 'submitted'; domain?: string; obligation?: ObligationRow | null; occurrenceAt?: string | null } = {}): World {
  const ob = over.obligation === undefined ? obligation() : over.obligation
  return {
    snapshot: {
      inspection: {
        id: 'run-1', title: 'Outfall visual: Outfall 001', status: over.status ?? 'in_progress', domain: over.domain ?? 'environmental',
        template_id: 'tpl-1', facility_id: FACILITY, score: null, max_score: null, result: null,
      },
      run: { obligation_id: ob?.id ?? null, occurrence_at: over.occurrenceAt === undefined ? '2026-09-30' : over.occurrenceAt, subject_type: 'outfall', subject_id: 'of-1', attested: false, signature: null },
      templateName: 'Outfall visual', subjectLabel: 'Outfall 001', items: ITEMS, responses: [],
    },
    obligations: new Map(ob ? [[ob.id, ob]] : []),
    findings: [], events: [], log: [], signatureSaved: false,
  }
}

function storeFor(w: World): RunStore {
  const step = (name: string) => { w.log.push(name); if (w.failOn === name) { w.failOn = undefined; throw new Error(`${name} failed`) } }
  const unused = async () => { throw new Error('not used by this flow') }
  return {
    findSubject: unused as never, findTemplateId: unused as never, createTemplate: unused as never,
    findOpenRun: unused as never, createRun: unused as never,
    async getObligation(id) { return w.obligations.get(id) ?? null },
    async loadRun() { return w.snapshot },
    async saveResponses() { step('responses') },
    async existingFindingRefs() { return new Set(w.findings.map(f => f.source_reference)) },
    async insertFindings(rows) { step('findings'); w.findings.push(...rows) },
    async recordCompletion(args) {
      step('completion')
      // The unique link to the checklist: a second record of the same run is ignored.
      if (!w.events.some(e => e.inspectionId === args.inspectionId)) w.events.push(args)
    },
    async advanceObligation(id, update) { step('advance'); w.obligations.set(id, { ...w.obligations.get(id)!, ...update } as ObligationRow) },
    async saveSignature() { step('signature'); w.signatureSaved = true },
    async finalize() { step('finalize'); if (w.snapshot.inspection.status === 'submitted') return false; w.snapshot.inspection.status = 'submitted'; return true },
  }
}

const input = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  answers: [
    { itemId: 'i1', result: 'pass', value: null, evidenceId: null, note: null },
    { itemId: 'ph', result: null, value: 7.2, evidenceId: null, note: null },
  ],
  signatureName: 'Pat Inspector', imagePath: null, ...over,
})
const ctx = { userId: 'user-1', now: NOW }

describe('submitChecklist', () => {
  it('reports an inspection that is not an environmental checklist as absent', async () => {
    expect(await submitChecklist(storeFor(world({ domain: 'safety' })), ctx, 'run-1', input())).toMatchObject({ ok: false, status: 404 })
    const w = world(); w.snapshot.run = null
    expect(await submitChecklist(storeFor(w), ctx, 'run-1', input())).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses a run that was already submitted, and writes nothing', async () => {
    const w = world({ status: 'submitted' })
    expect(await submitChecklist(storeFor(w), ctx, 'run-1', input())).toMatchObject({ ok: false, status: 409, error: 'already_submitted' })
    expect(w.log).toEqual([])
  })

  it('refuses an answer to an item that is not on the checklist, rather than dropping it', async () => {
    const w = world()
    const r = await submitChecklist(storeFor(w), ctx, 'run-1', input({ answers: [...input().answers, { itemId: 'ghost', result: 'pass', value: null, evidenceId: null, note: null }] }))
    expect(r).toMatchObject({ ok: false, status: 400, error: 'unknown_item', missing: ['ghost'] })
    expect(w.log).toEqual([])
  })

  it('refuses a submit that skips a required item, naming it, and writes nothing', async () => {
    const w = world()
    const r = await submitChecklist(storeFor(w), ctx, 'run-1', input({ answers: [{ itemId: 'i1', result: 'pass', value: null, evidenceId: null, note: null }] }))
    expect(r).toMatchObject({ ok: false, status: 400, error: 'missing_required', missing: ['ph'] })
    expect(w.log).toEqual([])
  })

  it('passes a clean run: no findings, deadline completed and moved to the next quarter end', async () => {
    const w = world()
    const r = await submitChecklist(storeFor(w), ctx, 'run-1', input())
    expect(r).toMatchObject({ ok: true, result: 'pass', findingsRaised: 0, completedObligation: true })
    expect(w.findings).toEqual([])
    expect(w.obligations.get('ob-1')!.next_due_at).toBe('2026-12-31')
    expect(w.events).toEqual([{ obligationId: 'ob-1', occurrenceAt: '2026-09-30', inspectionId: 'run-1', userId: 'user-1', note: 'Checklist passed' }])
  })

  it('keeps a quarter-end deadline on quarter ends instead of drifting (Mar 31 -> Jun 30 -> Sep 30)', async () => {
    const w = world({ obligation: obligation({ next_due_at: '2026-03-31' }), occurrenceAt: '2026-03-31' })
    await submitChecklist(storeFor(w), ctx, 'run-1', input())
    expect(w.obligations.get('ob-1')!.next_due_at).toBe('2026-06-30')
  })

  it('raises a finding for a failed item, with the basis and the critical flag, owned by the deadline owner', async () => {
    const w = world()
    const r = await submitChecklist(storeFor(w), ctx, 'run-1', input({
      answers: [{ itemId: 'i1', result: 'fail', value: null, evidenceId: `${TENANT}/sheen.jpg`, note: 'Oil sheen' }, { itemId: 'ph', result: null, value: 7, evidenceId: null, note: null }],
    }))
    expect(r).toMatchObject({ ok: true, result: 'fail', findingsRaised: 1 })
    expect(w.findings[0]).toMatchObject({
      source_type: 'inspection', source_reference: 'env-checklist:run-1:i1', classification: 'minor',
      clause_ref: '9.1.1', facility_id: FACILITY, owner_user_id: 'owner-1', identified_by: 'user-1',
    })
    expect(w.findings[0]!.description).toContain('Oil sheen')
    expect(w.findings[0]!.description).toContain('IGP §XI')
  })

  it('never raises a finding as major on its own', async () => {
    const w = world()
    await submitChecklist(storeFor(w), ctx, 'run-1', input({ answers: [{ itemId: 'i1', result: 'fail', value: null, evidenceId: null, note: 'x' }, { itemId: 'ph', result: null, value: 7, evidenceId: null, note: null }] }))
    expect(w.findings.every(f => f.classification !== 'major')).toBe(true)
  })

  it('fails a numeric reading outside its limits and raises a finding for it', async () => {
    const w = world()
    const r = await submitChecklist(storeFor(w), ctx, 'run-1', input({ answers: [{ itemId: 'i1', result: 'pass', value: null, evidenceId: null, note: null }, { itemId: 'ph', result: null, value: 9.8, evidenceId: null, note: null }] }))
    expect(r).toMatchObject({ ok: true, result: 'fail' })
    expect(w.findings.map(f => f.source_reference)).toEqual(['env-checklist:run-1:ph'])
  })

  it('still completes the occurrence when the run fails: the duty is to inspect, not to pass', async () => {
    const w = world()
    const r = await submitChecklist(storeFor(w), ctx, 'run-1', input({ answers: [{ itemId: 'i1', result: 'fail', value: null, evidenceId: null, note: 'x' }, { itemId: 'ph', result: null, value: 7, evidenceId: null, note: null }] }))
    expect(r).toMatchObject({ ok: true, result: 'fail', completedObligation: true })
    expect(w.events).toHaveLength(1)
    expect(w.obligations.get('ob-1')!.next_due_at).toBe('2026-12-31')
  })

  it('completes a once-only deadline instead of rolling it forward', async () => {
    const w = world({ obligation: obligation({ cadence: 'once' }) })
    await submitChecklist(storeFor(w), ctx, 'run-1', input())
    expect(w.obligations.get('ob-1')).toMatchObject({ status: 'completed', next_due_at: '2026-09-30' })
  })

  it('does not move a deadline that has already moved past the occurrence this run satisfies', async () => {
    const w = world({ obligation: obligation({ next_due_at: '2026-12-31' }), occurrenceAt: '2026-09-30' })
    const r = await submitChecklist(storeFor(w), ctx, 'run-1', input())
    expect(r).toMatchObject({ ok: true, completedObligation: true })
    expect(w.log).not.toContain('advance')
    expect(w.obligations.get('ob-1')!.next_due_at).toBe('2026-12-31')
  })

  it('leaves a closed deadline alone', async () => {
    const w = world({ obligation: obligation({ status: 'dismissed' }) })
    expect(await submitChecklist(storeFor(w), ctx, 'run-1', input())).toMatchObject({ ok: true, completedObligation: false })
    expect(w.events).toEqual([])
  })

  it('works for a run with no deadline attached', async () => {
    const w = world({ obligation: null })
    expect(await submitChecklist(storeFor(w), ctx, 'run-1', input())).toMatchObject({ ok: true, completedObligation: false })
  })

  it('does everything else first and flips to submitted last, so submitted means done', async () => {
    const w = world()
    await submitChecklist(storeFor(w), ctx, 'run-1', input({ answers: [{ itemId: 'i1', result: 'fail', value: null, evidenceId: null, note: 'x' }, { itemId: 'ph', result: null, value: 7, evidenceId: null, note: null }] }))
    expect(w.log).toEqual(['responses', 'findings', 'completion', 'advance', 'signature', 'finalize'])
  })

  it('can be retried after a failure part-way without duplicating findings or moving the deadline twice', async () => {
    const w = world()
    const failing = { answers: [{ itemId: 'i1', result: 'fail' as const, value: null, evidenceId: null, note: 'x' }, { itemId: 'ph', result: null, value: 7, evidenceId: null, note: null }] }
    w.failOn = 'signature'
    await expect(submitChecklist(storeFor(w), ctx, 'run-1', input(failing))).rejects.toThrow('signature failed')
    expect(w.snapshot.inspection.status).toBe('in_progress')

    const retry = await submitChecklist(storeFor(w), ctx, 'run-1', input(failing))
    expect(retry).toMatchObject({ ok: true, findingsRaised: 1 })
    expect(w.findings).toHaveLength(1)
    expect(w.events).toHaveLength(1)
    expect(w.obligations.get('ob-1')!.next_due_at).toBe('2026-12-31')
    expect(w.snapshot.inspection.status).toBe('submitted')
  })

  it('reports a lost race (someone else submitted first) as already submitted', async () => {
    const w = world()
    const store = storeFor(w)
    const racing: RunStore = { ...store, async finalize() { return false } }
    expect(await submitChecklist(racing, ctx, 'run-1', input())).toMatchObject({ ok: false, status: 409, error: 'already_submitted' })
  })

  it('records the signature with the time it was given', async () => {
    const saved: Array<Record<string, unknown>> = []
    const w = world()
    const store = storeFor(w)
    await submitChecklist({ ...store, async saveSignature(_id, signature) { saved.push(signature) } }, ctx, 'run-1', input({ imagePath: `${TENANT}/sig.png` }))
    expect(saved).toEqual([{ name: 'Pat Inspector', signed_at: NOW.toISOString(), image_path: `${TENANT}/sig.png` }])
  })
})

describe('parseSubmitBody', () => {
  const ok = { attested: true, signature_name: 'Pat Inspector', answers: [{ item_id: 'i1', result: 'pass' }] }

  it('accepts a complete body', () => {
    const r = parseSubmitBody(ok, TENANT)
    expect(r).toMatchObject({ ok: true, input: { signatureName: 'Pat Inspector', answers: [{ itemId: 'i1', result: 'pass', value: null, evidenceId: null, note: null }] } })
  })

  it('requires the person to attest and sign', () => {
    const r = parseSubmitBody({ ...ok, attested: false, signature_name: ' ' }, TENANT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/attested/)
  })

  it("refuses evidence that points outside the caller's tenant folder or climbs out of it", () => {
    for (const path of ['22222222-2222-2222-2222-222222222222/x.jpg', `${TENANT}/../other/x.jpg`, '/etc/passwd', 'x.jpg']) {
      const r = parseSubmitBody({ ...ok, answers: [{ item_id: 'i1', result: 'pass', evidence_id: path }] }, TENANT)
      expect(r.ok, path).toBe(false)
    }
    expect(parseSubmitBody({ ...ok, answers: [{ item_id: 'i1', result: 'pass', evidence_id: `${TENANT}/a.jpg` }] }, TENANT).ok).toBe(true)
  })

  it('refuses a bad result, a repeated item, an oversized value and too many answers', () => {
    expect(parseSubmitBody({ ...ok, answers: [{ item_id: 'i1', result: 'maybe' }] }, TENANT).ok).toBe(false)
    expect(parseSubmitBody({ ...ok, answers: [{ item_id: 'i1' }, { item_id: 'i1' }] }, TENANT).ok).toBe(false)
    expect(parseSubmitBody({ ...ok, answers: [{ item_id: 'i1', value: 'x'.repeat(2001) }] }, TENANT).ok).toBe(false)
    expect(parseSubmitBody({ ...ok, answers: Array.from({ length: 501 }, (_, i) => ({ item_id: `i${i}` })) }, TENANT).ok).toBe(false)
  })

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'x', [], 7]) expect(parseSubmitBody(body, TENANT).ok).toBe(false)
  })
})

// ── start ───────────────────────────────────────────────────────────────────

interface StartWorld {
  created: NewRun[]
  templatesCreated: number
  existingTemplate: string | null
  openRun: string | null
  subjects: Set<string>
  obligation: ObligationRow | null
}

function startStore(w: StartWorld): RunStore {
  const unused = async () => { throw new Error('not used by this flow') }
  return {
    loadRun: unused as never, saveResponses: unused as never, existingFindingRefs: unused as never, insertFindings: unused as never,
    recordCompletion: unused as never, advanceObligation: unused as never, saveSignature: unused as never, finalize: unused as never,
    async findSubject(_type, id) { return w.subjects.has(id) ? { label: `Outfall ${id}` } : null },
    async getObligation() { return w.obligation },
    async findTemplateId() { return w.existingTemplate },
    async createTemplate() { w.templatesCreated += 1; return { id: 'tpl-new', created: true } },
    async findOpenRun() { return w.openRun },
    async createRun(run) { w.created.push(run); return 'run-new' },
  }
}
const startWorld = (over: Partial<StartWorld> = {}): StartWorld =>
  ({ created: [], templatesCreated: 0, existingTemplate: null, openRun: null, subjects: new Set(['of-1']), obligation: null, ...over })

const testSite = site()
const library = testSite.library
const applicable = (subjectType: string) =>
  library.checklists.find(t => t.subjectType === subjectType && applies(t.appliesWhen, testSite.applicability))!
const outfallTemplate = applicable('outfall')
const facilityTemplate = applicable('facility')

describe('startChecklist', () => {
  it('has library templates to exercise (outfall and site-wide)', () => {
    expect(outfallTemplate).toBeDefined()
    expect(facilityTemplate).toBeDefined()
  })

  it('refuses a template that is not in the site library', async () => {
    const r = await startChecklist(startStore(startWorld()), site(), 'user-1', { libraryKey: 'nope', subjectId: null, obligationId: null, occurrenceAt: null })
    expect(r).toMatchObject({ ok: false, status: 404, error: 'unknown_template' })
  })

  it('runs a site-wide checklist against the site itself, creating the template instance on first use', async () => {
    const w = startWorld()
    const r = await startChecklist(startStore(w), site(), 'user-1', { libraryKey: facilityTemplate.id, subjectId: null, obligationId: null, occurrenceAt: null })
    expect(r).toEqual({ ok: true, inspectionId: 'run-new', resumed: false })
    expect(w.templatesCreated).toBe(1)
    expect(w.created[0]).toMatchObject({ templateId: 'tpl-new', facilityId: FACILITY, subjectType: 'facility', subjectId: FACILITY, userId: 'user-1' })
    expect(w.created[0]!.title).toContain('Plant 1')
  })

  it('reuses the template instance that already exists', async () => {
    const w = startWorld({ existingTemplate: 'tpl-existing' })
    await startChecklist(startStore(w), site(), 'user-1', { libraryKey: facilityTemplate.id, subjectId: null, obligationId: null, occurrenceAt: null })
    expect(w.templatesCreated).toBe(0)
    expect(w.created[0]!.templateId).toBe('tpl-existing')
  })

  it('requires a subject for an outfall checklist, and refuses one that is not this site\'s', async () => {
    const none = await startChecklist(startStore(startWorld()), site(), 'user-1', { libraryKey: outfallTemplate.id, subjectId: null, obligationId: null, occurrenceAt: null })
    expect(none).toMatchObject({ ok: false, status: 400, error: 'subject_required' })
    const foreign = await startChecklist(startStore(startWorld()), site(), 'user-1', { libraryKey: outfallTemplate.id, subjectId: 'of-elsewhere', obligationId: null, occurrenceAt: null })
    expect(foreign).toMatchObject({ ok: false, status: 404, error: 'subject_not_found' })
    const mine = await startChecklist(startStore(startWorld()), site(), 'user-1', { libraryKey: outfallTemplate.id, subjectId: 'of-1', obligationId: null, occurrenceAt: null })
    expect(mine).toMatchObject({ ok: true })
  })

  it('resumes an unfinished run for the same subject instead of opening a duplicate', async () => {
    const w = startWorld({ openRun: 'run-open' })
    const r = await startChecklist(startStore(w), site(), 'user-1', { libraryKey: outfallTemplate.id, subjectId: 'of-1', obligationId: null, occurrenceAt: null })
    expect(r).toEqual({ ok: true, inspectionId: 'run-open', resumed: true })
    expect(w.created).toEqual([])
  })

  it('links a deadline from this site and takes its due date as the occurrence', async () => {
    const w = startWorld({ obligation: obligation({ next_due_at: '2026-09-30' }) })
    await startChecklist(startStore(w), site(), 'user-1', { libraryKey: outfallTemplate.id, subjectId: 'of-1', obligationId: 'ob-1', occurrenceAt: null })
    expect(w.created[0]).toMatchObject({ obligationId: 'ob-1', occurrenceAt: '2026-09-30' })
  })

  it('refuses a deadline from another site, a closed one, a malformed date, and a deadline another checklist satisfies', async () => {
    const run = (ob: ObligationRow | null, occurrenceAt: string | null = null) =>
      startChecklist(startStore(startWorld({ obligation: ob })), site(), 'user-1', { libraryKey: outfallTemplate.id, subjectId: 'of-1', obligationId: 'ob-1', occurrenceAt })
    expect(await run(obligation({ facility_id: 'another-site' }))).toMatchObject({ ok: false, status: 404, error: 'obligation_not_found' })
    expect(await run(null)).toMatchObject({ ok: false, status: 404 })
    expect(await run(obligation({ status: 'completed' }))).toMatchObject({ ok: false, status: 409, error: 'obligation_closed' })
    expect(await run(obligation(), 'next tuesday')).toMatchObject({ ok: false, status: 400, error: 'invalid_occurrence_date' })

    const other = library.obligations.find(o => o.checklistTemplateId && o.checklistTemplateId !== outfallTemplate.id)
    expect(other, 'library should have a deadline tied to a different checklist').toBeDefined()
    expect(await run(obligation({ library_key: other!.id }))).toMatchObject({ ok: false, status: 400, error: 'obligation_checklist_mismatch' })
  })
})
