import { describe, it, expect } from 'vitest'
import { applies } from '@soteria/core/environmental/applicability'
import { buildTemplateRows, missingRequiredItems } from '@soteria/core/environmental/checklists'
import { permitHealth } from '@soteria/core/environmental/permits'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { EMPTY_SITE_PROFILE, validateSiteProfile, type SiteProfile } from '@soteria/core/environmental/siteProfile'
import { evaluateNumeric } from '@soteria/core/inspectionScoring'
import type { ApplyResult } from '@/lib/environmental/applyLibrary'
import type { RunItem } from '@/lib/environmental/checklistRuns'
import {
  DEMO_SITES, demoAnswers, demoPlaceholderPath, describeSummary, seedEnvironmentalDemo,
  type DemoEvaluation, type DemoPermit, type DemoRun, type DemoSite, type DemoStore,
} from '@/lib/environmental/demoSeed'

const NOW = new Date('2026-10-07T12:00:00Z')
const TENANT = '11111111-1111-1111-1111-111111111111'
const ymd = (d: Date) => d.toISOString().slice(0, 10)

const profileOf = (site: DemoSite): SiteProfile => ({ ...EMPTY_SITE_PROFILE, ...site.profile })
const contextOf = (site: DemoSite) => ({ profile: profileOf(site), generatorCategory: site.generatorCategory })

// The demo script names library entries by key. When a pack changes, a key can disappear or stop
// applying; these tests fail then, instead of the seed quietly seeding less.
describe('the demo story matches the library it is seeded from', () => {
  for (const site of DEMO_SITES) {
    describe(site.name, () => {
      const { library } = libraryForState(site.state)
      const context = contextOf(site)

      it('has a valid site profile', () => {
        expect(validateSiteProfile(site.profile, EMPTY_SITE_PROFILE).ok).toBe(true)
      })

      it('evaluates only requirements the site actually gets', () => {
        for (const e of site.evaluations) {
          const entry = library.legal.find(l => l.id === e.libraryKey)
          expect(entry, `${e.libraryKey} is not in the ${site.state} library`).toBeDefined()
          expect(applies(entry!.appliesWhen, context), `${e.libraryKey} does not apply to ${site.name}`).toBe(true)
        }
      })

      it('moves only deadlines the site actually gets', () => {
        for (const d of site.deadlines) {
          const entry = library.obligations.find(o => o.id === d.libraryKey)
          expect(entry, `${d.libraryKey} is not in the ${site.state} library`).toBeDefined()
          expect(applies(entry!.appliesWhen, context), `${d.libraryKey} does not apply to ${site.name}`).toBe(true)
        }
      })

      it('runs only checklists the site gets, against things it has', () => {
        for (const run of site.runs) {
          const template = library.checklists.find(t => t.id === run.libraryKey)
          expect(template, `${run.libraryKey} is not in the ${site.state} library`).toBeDefined()
          expect(applies(template!.appliesWhen, context)).toBe(true)
          if (template!.subjectType === 'outfall') {
            expect(site.outfalls.some(o => o.code === run.outfallCode), `${run.libraryKey} needs an outfall at ${site.name}`).toBe(true)
          }
          if (run.deadlineKey) {
            const deadline = library.obligations.find(o => o.id === run.deadlineKey)
            expect(deadline?.checklistTemplateId, `${run.deadlineKey} should be satisfied by ${run.libraryKey}`).toBe(run.libraryKey)
          }
        }
      })

      it('links outfalls only to permits and outfalls it has', () => {
        for (const o of site.outfalls) {
          if (o.permitKey) expect(site.permits.some(p => p.key === o.permitKey)).toBe(true)
          if (o.sameAs) expect(site.outfalls.some(x => x.code === o.sameAs)).toBe(true)
        }
      })
    })
  }
})

describe('what the demo shows', () => {
  const ca = DEMO_SITES.find(s => s.state === 'CA')!
  it('has a permit inside its renewal window, one in good standing, and one that never expires', () => {
    const healthOf = (p: DemoPermit, now = NOW) => permitHealth({
      status: 'active', renewalLeadDays: p.renewalLeadDays,
      expirationDate: p.expiresInDays === null ? null : ymd(new Date(now.getTime() + p.expiresInDays * 86_400_000)),
    }, now)
    const all = DEMO_SITES.flatMap(s => s.permits).map(p => healthOf(p))
    expect(all).toContain('expiring')
    expect(all).toContain('active')
    expect(DEMO_SITES.flatMap(s => s.permits).some(p => p.expiresInDays === null)).toBe(true)
  })

  it('has a requirement in every standing, including an overdue review', () => {
    const statuses = new Set(ca.evaluations.map(e => e.status))
    for (const s of ['compliant', 'attention', 'non_compliant'] as const) expect(statuses).toContain(s)
    expect(ca.evaluations.some(e => e.applicability === 'not_applicable')).toBe(true)
    expect(ca.evaluations.some(e => (e.reviewedDaysAgo ?? 0) > 365)).toBe(true)
    // A flagged requirement always says what is wrong.
    for (const e of DEMO_SITES.flatMap(s => s.evaluations)) {
      if (e.status === 'attention' || e.status === 'non_compliant') expect(e.note.length).toBeGreaterThan(20)
      if (e.applicability === 'not_applicable') expect(e.status).toBe('not_evaluated')
    }
  })

  it('has an overdue deadline, one due soon, a passed run, a failed one with a finding, and one in progress', () => {
    const tweaks = DEMO_SITES.flatMap(s => s.deadlines)
    expect(tweaks.some(t => t.dueInDays < 0)).toBe(true)
    expect(tweaks.some(t => t.dueInDays > 0 && t.dueInDays <= 30)).toBe(true)
    const outcomes = new Set(DEMO_SITES.flatMap(s => s.runs).map(r => r.outcome))
    expect(outcomes).toEqual(new Set(['pass', 'fail', 'in_progress']))
  })

  it('includes a state the library does not cover, to show the federal fallback', () => {
    const unsupported = DEMO_SITES.find(s => libraryForState(s.state).jurisdiction.status === 'unsupported')
    expect(unsupported?.state).toBe('OR')
  })

  it('never looks like a real permit', () => {
    for (const p of DEMO_SITES.flatMap(s => s.permits)) expect(p.permitNumber).toMatch(/DEMO/)
    for (const s of DEMO_SITES) expect(s.name).toMatch(/DEMO/)
  })
})

describe('demoAnswers', () => {
  const templates = ['CA', 'TX', null].flatMap(state => {
    const { library, jurisdiction } = libraryForState(state)
    const profile: SiteProfile = { ...EMPTY_SITE_PROFILE, stormwaterCoverage: 'general_permit', airPermitType: 'minor_permit', wastewaterDischarge: 'potw_indirect', pretreatmentStatus: 'siu' }
    return library.checklists.map(t => ({ state, template: t, rows: buildTemplateRows(t, { profile, generatorCategory: 'sqg' }, jurisdiction.chain, { libraryVersion: 'v', lastVerified: null }) }))
  })
  const asRunItems = (rows: ReturnType<typeof buildTemplateRows>): RunItem[] =>
    rows.items.map((item, i) => ({ id: `item-${i}`, section: item.section, sort_order: item.sort_order, item_type: item.item_type, prompt: item.prompt, required: item.required, weight: item.weight, fail_creates_action: item.fail_creates_action, config: item.config }))

  it('satisfies the required-question rule for every checklist the library has, passing or failing', () => {
    expect(templates.length).toBeGreaterThan(5)
    for (const { state, template, rows } of templates) {
      const items = asRunItems(rows)
      for (const outcome of ['pass', 'fail'] as const) {
        const answers = demoAnswers(items, outcome, TENANT)
        const missing = missingRequiredItems(items.map(i => ({ id: i.id, itemType: i.item_type, required: i.required })), answers)
        expect(missing, `${state ?? 'federal'} ${template.id} (${outcome})`).toEqual([])
      }
    }
  })

  it('keeps every numeric reading inside its limits', () => {
    for (const { rows } of templates) {
      const items = asRunItems(rows)
      for (const a of demoAnswers(items, 'pass', TENANT)) {
        const item = items.find(i => i.id === a.itemId)!
        if (item.item_type !== 'numeric') continue
        const { min, max } = item.config as { min?: number; max?: number }
        expect(evaluateNumeric(a.value as number, min ?? null, max ?? null)).toBe('pass')
      }
    }
  })

  it('fails exactly one question on a failing run, with a note and a photo, and none on a passing one', () => {
    const { rows } = templates.find(t => t.template.id === 'of-inspection')!
    const items = asRunItems(rows)
    const failing = demoAnswers(items, 'fail', TENANT).filter(a => a.result === 'fail')
    expect(failing).toHaveLength(1)
    expect(failing[0]!.note).toMatch(/oil sheen/i)
    expect(failing[0]!.evidenceId).toBe(demoPlaceholderPath(TENANT))
    expect(demoAnswers(items, 'pass', TENANT).filter(a => a.result === 'fail')).toEqual([])
  })

  it('points placeholder photos into the tenant\'s own folder, which is where the API requires evidence to be', () => {
    expect(demoPlaceholderPath(TENANT).startsWith(`${TENANT}/`)).toBe(true)
  })
})

// ── orchestration, against an in-memory store ───────────────────────────────

function memoryStore(members: string[] = ['u1', 'u2', 'u3']) {
  const calls: string[] = []
  const sites = new Map<string, string>()
  const permits = new Map<string, string>()
  const outfalls = new Map<string, { id: string; permitId: string | null; sameAsId: string | null }>()
  const evaluations = new Map<string, DemoEvaluation>()
  const deadlines = new Map<string, { dueOn: string; ownerUserId: string | null }>()
  const runs = new Set<string>()
  let nextId = 1
  const idFor = (map: Map<string, string>, key: string) => { if (!map.has(key)) map.set(key, `id-${nextId++}`); return map.get(key)! }

  const store: DemoStore = {
    async memberIds() { return members },
    async ensureSite(site) { calls.push(`site:${site.code}`); return idFor(sites, site.code) },
    async saveProfile(facilityId) { calls.push(`profile:${facilityId}`) },
    async applyLibrary(facilityId) { calls.push(`apply:${facilityId}`); return { legal: { created: 0, alreadyThere: 0 }, templates: { created: 0, alreadyThere: 0 }, obligations: { created: 0, alreadyThere: 0 } } satisfies ApplyResult },
    async ensurePermit(facilityId, permit) { calls.push(`permit:${permit.key}`); return idFor(permits, `${facilityId}:${permit.permitNumber}`) },
    async ensureOutfall(facilityId, outfall, links) {
      calls.push(`outfall:${outfall.code}`)
      const key = `${facilityId}:${outfall.code}`
      if (!outfalls.has(key)) outfalls.set(key, { id: `id-${nextId++}`, ...links })
      return outfalls.get(key)!.id
    },
    async evaluateLegal(facilityId, evaluation) { calls.push(`evaluate:${evaluation.libraryKey}`); evaluations.set(`${facilityId}:${evaluation.libraryKey}`, evaluation); return true },
    async setDeadline(facilityId, libraryKey, change) { calls.push(`deadline:${libraryKey}`); deadlines.set(`${facilityId}:${libraryKey}`, change); return true },
    async ensureRun(facilityId, run: DemoRun) {
      calls.push(`run:${run.libraryKey}`)
      const key = `${facilityId}:${run.libraryKey}:${run.outfallCode ?? ''}:${run.outcome}`
      if (runs.has(key)) return 'exists'
      runs.add(key)
      return 'created'
    },
  }
  return { store, calls, sites, permits, outfalls, evaluations, deadlines, runs }
}

describe('seedEnvironmentalDemo', () => {
  it('refuses to run in an account with nobody to own the records, saying why', async () => {
    await expect(seedEnvironmentalDemo(memoryStore([]).store, NOW)).rejects.toThrow(/no members/)
  })

  it('sets up each site fully, in dependency order: site, profile, library, then permits, outfalls, evaluations, runs, deadlines', async () => {
    const world = memoryStore()
    await seedEnvironmentalDemo(world.store, NOW)
    const ca = world.calls.slice(0, world.calls.findIndex(c => c === 'site:ENV-TX'))
    const first = (prefix: string) => ca.findIndex(c => c.startsWith(prefix))
    const order = ['site:', 'profile:', 'apply:', 'permit:', 'outfall:', 'evaluate:', 'run:', 'deadline:'].map(first)
    expect(order.every(i => i >= 0), 'every step ran').toBe(true)
    expect(order, 'steps run in dependency order').toEqual([...order].sort((x, y) => x - y))
    // Runs finish before deadlines are set, so a completed run cannot undo a deadline the story moved.
    expect(first('deadline:')).toBeGreaterThan(ca.map(c => c.startsWith('run:')).lastIndexOf(true))
  })

  it('creates an outfall after the one it is the same as, and links it', async () => {
    const world = memoryStore()
    await seedEnvironmentalDemo(world.store, NOW)
    const caCalls = world.calls.slice(0, world.calls.findIndex(c => c === 'site:ENV-TX'))
    expect(caCalls.indexOf('outfall:001')).toBeLessThan(caCalls.indexOf('outfall:003'))
    const three = [...world.outfalls.entries()].find(([k]) => k.endsWith(':003'))![1]
    const one = [...world.outfalls.entries()].find(([k]) => k.endsWith(':001'))![1]
    expect(three.sameAsId).toBe(one.id)
    expect(three.permitId).not.toBeNull()
  })

  it('assigns owners from the account\'s members, and tolerates fewer members than the script names', async () => {
    const world = memoryStore(['only-one'])
    await seedEnvironmentalDemo(world.store, NOW)
    expect([...world.deadlines.values()].map(d => d.ownerUserId).every(o => o === 'only-one' || o === null)).toBe(true)
  })

  it('is idempotent: running it again changes nothing and creates no run twice', async () => {
    const world = memoryStore()
    const first = await seedEnvironmentalDemo(world.store, NOW)
    const snapshot = JSON.stringify({ s: [...world.sites], p: [...world.permits], o: [...world.outfalls], e: [...world.evaluations], d: [...world.deadlines], r: [...world.runs] })
    const second = await seedEnvironmentalDemo(world.store, NOW)
    expect(JSON.stringify({ s: [...world.sites], p: [...world.permits], o: [...world.outfalls], e: [...world.evaluations], d: [...world.deadlines], r: [...world.runs] })).toBe(snapshot)
    expect(first.runs).toBe(DEMO_SITES.flatMap(s => s.runs).length)
    expect(second.runs).toBe(0)
  })

  it('reports what it did in a line a person can read', async () => {
    const summary = await seedEnvironmentalDemo(memoryStore().store, NOW)
    const count = (pick: (s: DemoSite) => unknown[]) => DEMO_SITES.flatMap(pick).length
    expect(describeSummary(summary)).toBe(
      `environmental demo: ${DEMO_SITES.length} sites, ${count(s => s.permits)} permits, ${count(s => s.outfalls)} outfalls, ${count(s => s.evaluations)} requirements evaluated, ${count(s => s.deadlines)} deadlines set, ${count(s => s.runs)} checklist runs`,
    )
  })
})
