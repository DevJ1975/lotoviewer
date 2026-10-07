import { describe, it, expect } from 'vitest'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { EMPTY_SITE_PROFILE, type SiteProfile } from '@soteria/core/environmental/siteProfile'
import {
  executeApply, libraryVersionLabel, oldestVerification, planApply, summarizePlan, templateStateKey,
  type ApplyState, type LibraryStore,
} from '@/lib/environmental/applyLibrary'
import type { SiteContext } from '@/lib/environmental/siteContext'

const NOW = new Date('2026-10-07T12:00:00Z')

function site(state: string | null, profile: Partial<SiteProfile> = {}): SiteContext {
  const { jurisdiction, library } = libraryForState(state)
  const full = { ...EMPTY_SITE_PROFILE, ...profile }
  return {
    facility: { id: 'facility-1', name: 'Plant 1', state },
    profileRow: null, profile: full, jurisdiction, library,
    applicability: { profile: full, generatorCategory: 'sqg' },
  }
}

const emptyState = (): ApplyState => ({ legalIds: new Map(), obligationKeys: new Set(), templateIds: new Map() })

/** An in-memory store that records every call, in order, and can be told a row already exists. */
function fakeStore(opts: { alreadyThere?: boolean; failOnLegalCall?: number } = {}) {
  const calls: string[] = []
  const templates: Array<{ id: string; libraryKey: string; instanceKey: string }> = []
  const legal: Array<{ id: string; libraryKey: string }> = []
  const obligations: Array<{ systemKey: string; legalId: string | null; templateId: string | null }> = []
  let legalCalls = 0
  const store: LibraryStore = {
    async createTemplate(rows) {
      calls.push('template')
      const id = `tpl-${templates.length + 1}`
      templates.push({ id, libraryKey: rows.companion.library_key, instanceKey: rows.companion.jurisdiction_key })
      return { id, created: !opts.alreadyThere }
    },
    async createLegal(entry) {
      calls.push('legal')
      legalCalls += 1
      if (opts.failOnLegalCall === legalCalls) throw new Error('database unavailable')
      const id = `leg-${legal.length + 1}`
      legal.push({ id, libraryKey: entry.library_key })
      return { id, created: !opts.alreadyThere }
    },
    async createObligation(obligation, links) {
      calls.push('obligation')
      obligations.push({ systemKey: obligation.system_key, ...links })
      return { created: !opts.alreadyThere }
    },
  }
  return { store, calls, templates, legal, obligations }
}

const caStormwater = () => site('CA', { stormwaterCoverage: 'general_permit', stormwaterGeneralPermit: 'ca_igp', airPermitType: 'minor_permit' })

describe('planApply', () => {
  it('plans legal entries, checklist templates and deadlines for a fresh California site', () => {
    const plan = planApply(caStormwater(), emptyState(), NOW)
    expect(plan.legal.toCreate.length).toBeGreaterThan(0)
    expect(plan.templates.toCreate.length).toBeGreaterThan(0)
    expect(plan.obligations.toCreate.length).toBeGreaterThan(0)
    expect(plan.legal.toCreate.every(e => e.facility_id === 'facility-1')).toBe(true)
    expect(plan.obligations.toCreate.every(o => o.facility_id === 'facility-1' && o.system_key.startsWith('env:'))).toBe(true)
  })

  it('records which pack versions produced the rows, within the 40-character column', () => {
    const plan = planApply(caStormwater(), emptyState(), NOW)
    expect(plan.libraryVersion).toMatch(/^federal@.+,CA@.+$/)
    expect(plan.libraryVersion.length).toBeLessThanOrEqual(40)
  })

  it('adds nothing California-specific to a site with no state, and says nothing is gated on a guess', () => {
    const unset = planApply(site(null, { stormwaterCoverage: 'general_permit' }), emptyState(), NOW)
    expect(unset.legal.toCreate.every(e => e.jurisdiction === 'federal')).toBe(true)
    expect(unset.obligations.toCreate.every(o => o.jurisdiction === 'federal')).toBe(true)
  })

  it('plans nothing for programs the site has not been evaluated for', () => {
    const blank = planApply(site('CA'), emptyState(), NOW)
    const scoped = planApply(caStormwater(), emptyState(), NOW)
    expect(blank.obligations.toCreate.length).toBeLessThan(scoped.obligations.toCreate.length)
  })

  it('leaves alone anything the site already has, so a changed owner or date is never overwritten', () => {
    const first = planApply(caStormwater(), emptyState(), NOW)
    const keep = first.obligations.toCreate[0]!
    const state: ApplyState = { ...emptyState(), obligationKeys: new Set([keep.system_key]) }
    const again = planApply(caStormwater(), state, NOW)
    expect(again.obligations.toCreate.map(o => o.system_key)).not.toContain(keep.system_key)
    expect(again.obligations.existing).toContain(keep.library_key)
  })

  it('treats a template as existing only when the same instance (layers and item set) exists', () => {
    const first = planApply(caStormwater(), emptyState(), NOW)
    const t = first.templates.toCreate[0]!
    const sameInstance: ApplyState = { ...emptyState(), templateIds: new Map([[templateStateKey(t.libraryKey, t.instanceKey), 'tpl-x']]) }
    expect(planApply(caStormwater(), sameInstance, NOW).templates.existing).toContain(t.libraryKey)

    const otherInstance: ApplyState = { ...emptyState(), templateIds: new Map([[templateStateKey(t.libraryKey, 'federal'), 'tpl-x']]) }
    expect(planApply(caStormwater(), otherInstance, NOW).templates.toCreate.map(x => x.libraryKey)).toContain(t.libraryKey)
  })
})

describe('summarizePlan', () => {
  it('carries what a person needs to decide, without the row payloads', () => {
    const summary = summarizePlan(planApply(caStormwater(), emptyState(), NOW))
    expect(summary.legal.create[0]).toEqual(expect.objectContaining({ key: expect.any(String), title: expect.any(String), citation: expect.any(String) }))
    expect(summary.obligations.create[0]).toEqual(expect.objectContaining({ title: expect.any(String), nextDueAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }))
    expect(JSON.stringify(summary)).not.toContain('"items":[')
    expect(JSON.stringify(summary)).not.toContain('rows')
  })

  it('surfaces the verify note on entries the library has not confirmed', () => {
    const summary = summarizePlan(planApply(caStormwater(), emptyState(), NOW))
    expect(summary.legal.create.some(e => typeof e.verify === 'string' && e.verify.length > 0)).toBe(true)
  })
})

describe('executeApply', () => {
  it('writes templates and legal entries before the deadlines that link to them', async () => {
    const { store, calls } = fakeStore()
    await executeApply(store, planApply(caStormwater(), emptyState(), NOW), emptyState())
    const lastNonObligation = Math.max(calls.lastIndexOf('template'), calls.lastIndexOf('legal'))
    expect(calls.indexOf('obligation')).toBeGreaterThan(lastNonObligation)
  })

  it('links each deadline to the legal entry and checklist template that were just created', async () => {
    const s = caStormwater()
    const plan = planApply(s, emptyState(), NOW)
    const linked = s.library.obligations.find(o => o.legalId && o.checklistTemplateId && plan.obligations.toCreate.some(p => p.library_key === o.id))
    expect(linked, 'the CA pack should have a deadline tied to both a legal entry and a checklist').toBeDefined()

    const { store, templates, legal, obligations } = fakeStore()
    await executeApply(store, plan, emptyState())
    const row = obligations.find(o => o.systemKey === `env:${linked!.id}:facility-1`)!
    expect(row.legalId).toBe(legal.find(l => l.libraryKey === linked!.legalId)!.id)
    expect(row.templateId).toBe(templates.find(t => t.libraryKey === linked!.checklistTemplateId)!.id)
  })

  it('reports what it created, and creates nothing the second time', async () => {
    const s = caStormwater()
    const first = fakeStore()
    const plan = planApply(s, emptyState(), NOW)
    const result = await executeApply(first.store, plan, emptyState())
    expect(result.obligations.created).toBe(plan.obligations.toCreate.length)
    expect(result.legal.created).toBe(plan.legal.toCreate.length)
    expect(result.templates.created).toBe(plan.templates.toCreate.length)

    // The state after the first run, as the database would now report it.
    const after: ApplyState = {
      legalIds: new Map(first.legal.map(l => [l.libraryKey, l.id])),
      obligationKeys: new Set(first.obligations.map(o => o.systemKey)),
      templateIds: new Map(first.templates.map(t => [templateStateKey(t.libraryKey, t.instanceKey), t.id])),
    }
    const replan = planApply(s, after, NOW)
    expect(replan.legal.toCreate).toHaveLength(0)
    expect(replan.templates.toCreate).toHaveLength(0)
    expect(replan.obligations.toCreate).toHaveLength(0)

    const second = fakeStore()
    const again = await executeApply(second.store, replan, after)
    expect(second.calls).toEqual([])
    expect(again).toEqual({
      legal: { created: 0, alreadyThere: 0 }, templates: { created: 0, alreadyThere: 0 }, obligations: { created: 0, alreadyThere: 0 },
    })
  })

  it('counts a row a concurrent apply created first as already there, and still links to it', async () => {
    const plan = planApply(caStormwater(), emptyState(), NOW)
    const { store, obligations } = fakeStore({ alreadyThere: true })
    const result = await executeApply(store, plan, emptyState())
    expect(result.legal.created).toBe(0)
    expect(result.legal.alreadyThere).toBe(plan.legal.toCreate.length)
    expect(obligations.some(o => o.legalId !== null)).toBe(true)
  })

  it('stops on a database failure and leaves a partial result that running it again completes', async () => {
    const s = caStormwater()
    const plan = planApply(s, emptyState(), NOW)
    expect(plan.legal.toCreate.length).toBeGreaterThan(1)

    const broken = fakeStore({ failOnLegalCall: 2 })
    await expect(executeApply(broken.store, plan, emptyState())).rejects.toThrow('database unavailable')
    expect(broken.calls).not.toContain('obligation')

    // Re-plan from what actually got written, then finish.
    const partial: ApplyState = {
      legalIds: new Map(broken.legal.map(l => [l.libraryKey, l.id])),
      obligationKeys: new Set(),
      templateIds: new Map(broken.templates.map(t => [templateStateKey(t.libraryKey, t.instanceKey), t.id])),
    }
    const replan = planApply(s, partial, NOW)
    expect(replan.templates.toCreate).toHaveLength(0)
    expect(replan.legal.toCreate).toHaveLength(plan.legal.toCreate.length - broken.legal.length)
    const finish = fakeStore()
    const result = await executeApply(finish.store, replan, partial)
    expect(result.obligations.created).toBe(plan.obligations.toCreate.length)
  })
})

describe('library version helpers', () => {
  it('names every pack that contributed', () => {
    expect(libraryVersionLabel(libraryForState('TX').library)).toMatch(/^federal@.+,TX@.+$/)
    expect(libraryVersionLabel(libraryForState(null).library)).toMatch(/^federal@[^,]+$/)
  })

  it('reports no verification date while any pack has never been verified', () => {
    // Every pack is a draft awaiting CSP review.
    expect(oldestVerification(libraryForState('CA').library)).toBeNull()
  })
})
