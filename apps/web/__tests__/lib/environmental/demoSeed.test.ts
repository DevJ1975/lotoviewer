import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applies } from '@soteria/core/environmental/applicability'
import { buildTemplateRows, missingRequiredItems } from '@soteria/core/environmental/checklists'
import { permitStanding, renewalDeadlineMissed, renewalDueSoon, validatePermitInput } from '@soteria/core/environmentalPermit'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { EMPTY_SITE_PROFILE, validateSiteProfile, type SiteProfile } from '@soteria/core/environmental/siteProfile'
import { evaluateNumeric } from '@soteria/core/inspectionScoring'
import { ADMIN_A, FACILITY_A, TENANT_A, TENANT_B, emsClient, resetStore, rowsIn, seed, writes } from '../../api/environmental/_emsHarness'
import type { ApplyResult } from '@/lib/environmental/applyLibrary'
import type { RunItem } from '@/lib/environmental/checklistRuns'
import {
  DEMO_SITES, demoAnswers, demoPlaceholderPath, describeSummary, seedEnvironmentalDemo,
  type DemoEvaluation, type DemoRun, type DemoSite, type DemoStore,
} from '@/lib/environmental/demoSeed'
import { supabaseDemoStore } from '@/lib/environmental/demoStore'

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
  it('has a permit whose renewal is due soon, others in good standing, and one that never expires, none already missed', async () => {
    const world = memoryStore()
    await seedEnvironmentalDemo(world.store, NOW)
    const today = ymd(NOW)
    const permits = [...world.permitDates].map(([key, dates]) => ({ key, term: { retiredAt: null, renewalSubmittedOn: null, ...dates } }))
    expect(Object.fromEntries(permits.map(p => [p.key, permitStanding(p.term, today)]))).toEqual({
      igp: 'current', pto: 'renewal_due', iwdp: 'current', msgp: 'current', pbr: 'no_expiry',
    })
    expect(permits.filter(p => renewalDueSoon(p.term, today)).map(p => p.key)).toEqual(['pto'])
    expect(permits.filter(p => renewalDeadlineMissed(p.term, today))).toEqual([])
  })

  it('has permits the vault would accept, held by the account', async () => {
    const world = memoryStore()
    await seedEnvironmentalDemo(world.store, NOW)
    for (const permit of DEMO_SITES.flatMap(s => s.permits)) {
      const errors = validatePermitInput({
        program: permit.program, instrument: 'permit', title: permit.title, agency: permit.agency, permitNumber: permit.permitNumber,
        jurisdiction: permit.jurisdiction, holderOfRecord: 'Demo Account', businessCritical: false, notes: null, ...world.permitDates.get(permit.key)!,
      })
      expect(errors, permit.key).toEqual([])
    }
  })

  it('never repeats an agency and permit number, which the vault keeps unique within an account', () => {
    const identities = DEMO_SITES.flatMap(s => s.permits).map(p => `${p.agency.trim().toLowerCase()}|${p.permitNumber.trim()}`)
    expect(new Set(identities).size).toBe(identities.length)
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
  const permitDates = new Map<string, { issuedOn: string; expiresOn: string | null; renewalApplicationDueOn: string | null }>()
  const outfalls = new Map<string, { id: string; permitId: string | null; sameAsId: string | null }>()
  const evaluations = new Map<string, DemoEvaluation>()
  const deadlines = new Map<string, { dueOn: string; ownerUserId: string | null }>()
  const runs = new Set<string>()
  let nextId = 1
  const idFor = (map: Map<string, string>, key: string) => { if (!map.has(key)) map.set(key, `id-${nextId++}`); return map.get(key)! }

  const store: DemoStore = {
    async ensureModuleEnabled() { calls.push('module') },
    async memberIds() { return members },
    async ensureSite(site) { calls.push(`site:${site.code}`); return idFor(sites, site.code) },
    async saveProfile(facilityId) { calls.push(`profile:${facilityId}`) },
    async applyLibrary(facilityId) { calls.push(`apply:${facilityId}`); return { legal: { created: 0, alreadyThere: 0 }, templates: { created: 0, alreadyThere: 0 }, obligations: { created: 0, alreadyThere: 0 } } satisfies ApplyResult },
    async ensurePermit(facilityId, permit, dates) {
      calls.push(`permit:${permit.key}`)
      permitDates.set(permit.key, dates)
      return idFor(permits, `${facilityId}:${permit.permitNumber}`)
    },
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
  return { store, calls, sites, permits, permitDates, outfalls, evaluations, deadlines, runs }
}

describe('seedEnvironmentalDemo', () => {
  it('refuses to run in an account with nobody to own the records, saying why', async () => {
    await expect(seedEnvironmentalDemo(memoryStore([]).store, NOW)).rejects.toThrow(/no members/)
  })

  it('switches the Environmental module on first, once, however many sites follow', async () => {
    const world = memoryStore()
    await seedEnvironmentalDemo(world.store, NOW)
    expect(world.calls[0]).toBe('module')
    expect(world.calls.filter(c => c === 'module')).toHaveLength(1)
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

  it('dates each permit from today, with a renewal application date only where its terms give one', async () => {
    const world = memoryStore()
    const permit = { program: 'air', title: 'Demo permit', agency: 'Demo agency', jurisdiction: 'federal' } as const
    const site: DemoSite = {
      ...DEMO_SITES.find(s => s.state === 'OR')!,
      permits: [
        { ...permit, key: 'with-terms', permitNumber: 'DEMO-1', issuedInDays: -10, expiresInDays: 20, renewalApplicationDueInDays: 5 },
        { ...permit, key: 'no-term', permitNumber: 'DEMO-2', issuedInDays: -3, expiresInDays: null },
      ],
    }
    await seedEnvironmentalDemo(world.store, NOW, [site])
    expect(world.permitDates.get('with-terms')).toEqual({ issuedOn: '2026-09-27', expiresOn: '2026-10-27', renewalApplicationDueOn: '2026-10-12' })
    expect(world.permitDates.get('no-term')).toEqual({ issuedOn: '2026-10-04', expiresOn: null, renewalApplicationDueOn: null })
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

  it('reports what it did in a line a person can read, without claiming anything about ISO clauses', async () => {
    const summary = await seedEnvironmentalDemo(memoryStore().store, NOW)
    const count = (pick: (s: DemoSite) => unknown[]) => DEMO_SITES.flatMap(pick).length
    const line = describeSummary(summary)
    expect(line).toBe(
      `environmental demo: ${DEMO_SITES.length} sites, ${count(s => s.permits)} permits, ${count(s => s.outfalls)} outfalls, ${count(s => s.evaluations)} requirements evaluated, ${count(s => s.deadlines)} deadlines set, ${count(s => s.runs)} checklist runs`,
    )
    expect(line).not.toMatch(/\bISO\b|\bclause/i)
  })
})

// ── the Supabase adapter, against the EMS test store ────────────────────────
// The store enforces the permit vault's unique number (migration 304), so a seed that
// tried to add a permit twice fails here as it would in the database.

describe('supabaseDemoStore', () => {
  const adapter = () => supabaseDemoStore(emsClient as unknown as SupabaseClient, TENANT_A)
  const modulesOf = (tenantId: string) => rowsIn('tenants').find(t => t.id === tenantId)!.modules
  const tenantWrites = () => writes.filter(w => w.table === 'tenants')

  beforeEach(() => resetStore())

  describe('ensureModuleEnabled', () => {
    it('switches the Environmental module on', async () => {
      seed('tenants', [{ id: TENANT_A, name: 'Demo Account', modules: {} }])
      await adapter().ensureModuleEnabled()
      expect(modulesOf(TENANT_A)).toEqual({ environmental: true })
    })

    it('switches it on when it was explicitly off', async () => {
      seed('tenants', [{ id: TENANT_A, name: 'Demo Account', modules: { environmental: false } }])
      await adapter().ensureModuleEnabled()
      expect(modulesOf(TENANT_A)).toEqual({ environmental: true })
    })

    it('keeps every other module setting the account has', async () => {
      seed('tenants', [{ id: TENANT_A, name: 'Demo Account', modules: { loto: true, 'hot-work': false, 'confined-spaces': true } }])
      await adapter().ensureModuleEnabled()
      expect(modulesOf(TENANT_A)).toEqual({ loto: true, 'hot-work': false, 'confined-spaces': true, environmental: true })
    })

    it('leaves other accounts alone', async () => {
      seed('tenants', [{ id: TENANT_A, name: 'Demo Account', modules: {} }, { id: TENANT_B, name: 'Customer', modules: { loto: true } }])
      await adapter().ensureModuleEnabled()
      expect(modulesOf(TENANT_B)).toEqual({ loto: true })
    })

    it('is idempotent: a second run changes nothing and writes nothing', async () => {
      seed('tenants', [{ id: TENANT_A, name: 'Demo Account', modules: { loto: true } }])
      await adapter().ensureModuleEnabled()
      expect(tenantWrites()).toHaveLength(1)
      await adapter().ensureModuleEnabled()
      expect(modulesOf(TENANT_A)).toEqual({ loto: true, environmental: true })
      expect(tenantWrites()).toHaveLength(1)
    })

    it('says so when the account cannot be read, and writes nothing', async () => {
      await expect(adapter().ensureModuleEnabled()).rejects.toThrow(/could not be read back/)
      expect(tenantWrites()).toEqual([])
    })
  })

  describe('ensurePermit', () => {
    const anaheim = DEMO_SITES.find(s => s.state === 'CA')!
    const iwdp = anaheim.permits.find(p => p.key === 'iwdp')!
    const dates = { issuedOn: '2026-03-21', expiresOn: '2027-11-11', renewalApplicationDueOn: '2027-07-14' }
    const permitRows = () => rowsIn('environmental_permits')

    beforeEach(() => seed('tenants', [{ id: TENANT_A, name: 'Demo Account', modules: {} }]))

    it('adds the permit to the vault, held by the account, with the dates it was given', async () => {
      const id = await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(permitRows()).toEqual([expect.objectContaining({
        id, tenant_id: TENANT_A, facility_id: FACILITY_A, program: 'wastewater', instrument: 'permit',
        title: iwdp.title, agency: iwdp.agency, permit_number: iwdp.permitNumber, jurisdiction: 'state:CA',
        holder_of_record: 'Demo Account', issued_on: '2026-03-21', expires_on: '2027-11-11', renewal_application_due_on: '2027-07-14',
        created_by: ADMIN_A, updated_by: ADMIN_A, retired_at: null,
      })])
    })

    it('leaves the renewal application date and the expiry empty for a permit with neither', async () => {
      const pbr = DEMO_SITES.find(s => s.state === 'TX')!.permits.find(p => p.key === 'pbr')!
      await adapter().ensurePermit(FACILITY_A, pbr, { issuedOn: '2025-09-02', expiresOn: null, renewalApplicationDueOn: null }, ADMIN_A)
      expect(permitRows()).toEqual([expect.objectContaining({ expires_on: null, renewal_application_due_on: null })])
    })

    it('writes only the permit: renewal countdowns come from the vault, not from the seed', async () => {
      await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(writes.map(w => w.table)).toEqual(['environmental_permits'])
    })

    it('is idempotent: a second seed finds the active permit, adds no second one and does not trip the unique number', async () => {
      const first = await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      const second = await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(second).toBe(first)
      expect(permitRows()).toHaveLength(1)
      expect(writes.filter(w => w.table === 'environmental_permits')).toHaveLength(1)
    })

    it('sets the story\'s dates again on a later seed, because Reset Demo cannot wipe permits and they would otherwise age into red', async () => {
      const id = await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      const later = { issuedOn: '2026-10-12', expiresOn: '2028-01-01', renewalApplicationDueOn: '2027-09-01' }
      expect(await adapter().ensurePermit(FACILITY_A, iwdp, later, ADMIN_A)).toBe(id)
      expect(permitRows()).toEqual([expect.objectContaining({ id, issued_on: '2026-10-12', expires_on: '2028-01-01', renewal_application_due_on: '2027-09-01' })])
      expect(writes.filter(w => w.table === 'environmental_permits').map(w => w.mode)).toEqual(['insert', 'update'])
    })

    it('holds the permit in the name of the legal entity in the EMS scope, the newest version, so the vault does not report a holder mismatch', async () => {
      seed('ms_scope_statements', [
        { tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: 'Old Name Inc.' },
        { tenant_id: TENANT_A, discipline: 'ems', version: 2, legal_entity: 'Demo Account LLC' },
        { tenant_id: TENANT_B, discipline: 'ems', version: 9, legal_entity: 'Someone Else Ltd' },
      ])
      await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(permitRows()).toEqual([expect.objectContaining({ holder_of_record: 'Demo Account LLC' })])
    })

    it('corrects the holder of a permit seeded before the account had a scope', async () => {
      await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      seed('ms_scope_statements', [{ tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: 'Demo Account LLC' }])
      await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(permitRows()).toEqual([expect.objectContaining({ holder_of_record: 'Demo Account LLC' })])
    })

    it('never touches a retired permit when it sets the dates again', async () => {
      seed('environmental_permits', [{
        id: 'f0000000-0000-4000-8000-00000000000c', tenant_id: TENANT_A, facility_id: FACILITY_A, agency: iwdp.agency,
        permit_number: iwdp.permitNumber, retired_at: '2026-01-01T00:00:00Z', retired_reason: 'Superseded', issued_on: '2020-01-01',
      }])
      await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(permitRows().find(r => r.id === 'f0000000-0000-4000-8000-00000000000c')).toMatchObject({ issued_on: '2020-01-01' })
    })

    it('adds a new permit when the earlier one with that number was retired', async () => {
      seed('environmental_permits', [{
        id: 'f0000000-0000-4000-8000-00000000000a', tenant_id: TENANT_A, facility_id: FACILITY_A, agency: iwdp.agency,
        permit_number: iwdp.permitNumber, retired_at: '2026-01-01T00:00:00Z', retired_reason: 'Superseded',
      }])
      const id = await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(id).not.toBe('f0000000-0000-4000-8000-00000000000a')
      expect(permitRows()).toHaveLength(2)
    })

    it('never reuses another account\'s permit that has the same number', async () => {
      seed('environmental_permits', [{
        id: 'f0000000-0000-4000-8000-00000000000b', tenant_id: TENANT_B, facility_id: FACILITY_A, agency: iwdp.agency,
        permit_number: iwdp.permitNumber, retired_at: null,
      }])
      const id = await adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)
      expect(id).not.toBe('f0000000-0000-4000-8000-00000000000b')
      expect(permitRows().find(r => r.id === id)).toMatchObject({ tenant_id: TENANT_A })
    })

    it('says so when the account cannot be read, and adds nothing', async () => {
      resetStore()
      await expect(adapter().ensurePermit(FACILITY_A, iwdp, dates, ADMIN_A)).rejects.toThrow(/could not be read back/)
      expect(permitRows()).toEqual([])
    })
  })
})
