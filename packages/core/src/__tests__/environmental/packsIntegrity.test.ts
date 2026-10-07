import { describe, it, expect } from 'vitest'
import { PACKS, libraryForState } from '../../environmental/packs'
import { isScorableType } from '../../inspectionScoring'
import { SUPPORTED_STATES } from '../../environmental/jurisdiction'
import type { Citation, ResolvedLibrary } from '../../environmental/content'
import { ENV_PROGRAMS } from '../../environmental/siteProfile'

// The library is regulatory content authored as data. These checks are the net
// under it: structure that must hold for every jurisdiction, and a pinned count
// of unconfirmed claims, so a reviewer sees any new uncertainty in the diff.

const STATES: Array<string | null> = [null, 'OR', ...SUPPORTED_STATES]
const libs: Array<[string, ResolvedLibrary]> = STATES.map(s => [String(s), libraryForState(s).library])

const isRealDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

const allCitations = (lib: ResolvedLibrary): Citation[] => [
  ...lib.checklists.flatMap(t => [...t.citations, ...t.items.flatMap(i => i.citations)]),
  ...lib.obligations.flatMap(o => o.citations),
  ...lib.guides.flatMap(g => g.sections.flatMap(s => s.citations ?? [])),
]

describe('pack metadata', () => {
  it('every pack is registered under its own jurisdiction', () => {
    for (const [code, pack] of Object.entries(PACKS)) expect(pack.meta.jurisdiction).toBe(code)
  })

  it('has a pack for federal and for every supported state, and no extras', () => {
    expect(Object.keys(PACKS).sort()).toEqual(['federal', ...SUPPORTED_STATES].sort())
  })

  it('dates are real, and a draft is not dated in the future', () => {
    for (const pack of Object.values(PACKS)) {
      expect(isRealDate(pack.meta.draftedOn), pack.meta.jurisdiction).toBe(true)
      expect(new Date(`${pack.meta.draftedOn}T00:00:00Z`).getTime()).toBeLessThanOrEqual(Date.now())
      if (pack.meta.lastVerified !== null) expect(isRealDate(pack.meta.lastVerified)).toBe(true)
    }
  })

  it('a pack can only claim CSP approval with a named reviewer and a verification date', () => {
    for (const pack of Object.values(PACKS)) {
      const { meta } = pack
      if (meta.status === 'csp_approved') {
        expect(meta.reviewer, meta.jurisdiction).not.toBeNull()
        expect(meta.lastVerified, meta.jurisdiction).not.toBeNull()
        expect(isRealDate(meta.reviewer!.signedOffAt)).toBe(true)
      } else {
        expect(meta.reviewer, `${meta.jurisdiction} is a draft and must not name a reviewer`).toBeNull()
      }
    }
  })

  it('every pack is still a draft: nothing has been signed off yet', () => {
    // When a CSP signs a pack off, update this deliberately, in the same change.
    expect(Object.values(PACKS).map(p => p.meta.status)).toEqual(['draft', 'draft', 'draft'])
  })
})

describe.each(libs)('library for %s', (_state, lib) => {
  it('every id is unique within its kind', () => {
    for (const ids of [
      lib.checklists.map(t => t.id), lib.obligations.map(o => o.id), lib.legal.map(l => l.id), lib.guides.map(g => g.id),
    ]) expect(new Set(ids).size).toBe(ids.length)
    for (const t of lib.checklists) expect(new Set(t.items.map(i => i.id)).size, t.id).toBe(t.items.length)
  })

  it('every template, item and obligation has at least one citation', () => {
    for (const t of lib.checklists) {
      expect(t.citations.length, `template ${t.id}`).toBeGreaterThan(0)
      for (const i of t.items) expect(i.citations.length, `item ${i.id}`).toBeGreaterThan(0)
    }
    for (const o of lib.obligations) expect(o.citations.length, `obligation ${o.id}`).toBeGreaterThan(0)
    for (const l of lib.legal) {
      expect(l.citation.trim(), `legal ${l.id}`).not.toBe('')
      expect(l.authority.trim(), `legal ${l.id}`).not.toBe('')
    }
  })

  it('every citation names a source and every verify note says what to check', () => {
    for (const c of allCitations(lib)) {
      expect(c.ref.trim()).not.toBe('')
      if (c.verify !== undefined) expect(c.verify.trim().length, c.ref).toBeGreaterThan(10)
    }
  })

  it('every obligation points at a checklist and a legal entry that exist in the same library', () => {
    const templates = new Set(lib.checklists.map(t => t.id))
    const legal = new Set(lib.legal.map(l => l.id))
    for (const o of lib.obligations) {
      if (o.checklistTemplateId) expect(templates.has(o.checklistTemplateId), `${o.id} -> ${o.checklistTemplateId}`).toBe(true)
      if (o.legalId) expect(legal.has(o.legalId), `${o.id} -> ${o.legalId}`).toBe(true)
    }
  })

  it('programs are ones the suite knows', () => {
    for (const p of [...lib.checklists.map(t => t.program), ...lib.obligations.map(o => o.program), ...lib.legal.map(l => l.program)]) {
      expect((ENV_PROGRAMS as readonly string[]).includes(p), p).toBe(true)
    }
  })

  it('due-date anchors match their cadence, so completing one lands on the next period end', () => {
    const periodCadence = { month: 'monthly', quarter: 'quarterly', half: 'semiannual', year: 'annual' } as const
    for (const o of lib.obligations) {
      if (o.anchor.kind === 'period_end') expect(o.cadence, o.id).toBe(periodCadence[o.anchor.period])
      if (o.anchor.kind === 'annual') {
        expect(['annual', 'biennial', 'triennial', 'quinquennial'], o.id).toContain(o.cadence)
        expect(o.anchor.month).toBeGreaterThanOrEqual(1); expect(o.anchor.month).toBeLessThanOrEqual(12)
        const daysIn = new Date(Date.UTC(2027, o.anchor.month, 0)).getUTCDate()
        expect(o.anchor.day, `${o.id} day`).toBeGreaterThanOrEqual(1); expect(o.anchor.day, `${o.id} day`).toBeLessThanOrEqual(daysIn)
      }
      expect(o.leadDays).toBeGreaterThanOrEqual(0); expect(o.leadDays).toBeLessThanOrEqual(365)
    }
  })

  it('every checklist ends with a required signature, because it is a compliance record', () => {
    for (const t of lib.checklists) {
      const signatures = t.items.filter(i => i.itemType === 'signature')
      expect(signatures.length, t.id).toBeGreaterThan(0)
      expect(signatures.every(s => s.required), t.id).toBe(true)
    }
  })

  it('a failure only creates an action on an item that can fail, and a critical item always does', () => {
    for (const t of lib.checklists) {
      for (const i of t.items) {
        if (i.failCreatesAction) expect(isScorableType(i.itemType), `${t.id}.${i.id}`).toBe(true)
        if (i.critical) expect(i.failCreatesAction, `${t.id}.${i.id} is critical but creates no action`).toBe(true)
        expect(i.weight).toBeGreaterThan(0)
      }
    }
  })

  it('has at least one how-to guide for each screen that shows one', () => {
    for (const key of ['home', 'checklists', 'checklist-run', 'outfalls', 'legal', 'calendar', 'permits']) {
      expect(lib.guides.some(g => g.pageKeys.includes(key)), key).toBe(true)
    }
    for (const g of lib.guides) {
      expect(g.quickSteps.length, g.id).toBeGreaterThan(0)
      expect(g.sections.length, g.id).toBeGreaterThan(0)
    }
  })
})

describe('a federal citation never appears under a state\'s heading', () => {
  const refs = (lib: ResolvedLibrary) =>
    [...lib.checklists.flatMap(t => [...t.citations, ...t.items.flatMap(i => i.citations)]), ...lib.obligations.flatMap(o => o.citations)].map(c => c.ref)

  it('California stormwater content cites the Industrial General Permit, not the EPA MSGP', () => {
    const ca = libraryForState('CA').library
    const stormwater = ca.checklists.filter(t => t.program === 'stormwater' || t.program === 'outfall')
    const stormRefs = [...stormwater.flatMap(t => [...t.citations, ...t.items.flatMap(i => i.citations)]),
      ...ca.obligations.filter(o => o.program === 'stormwater').flatMap(o => o.citations)].map(c => c.ref)
    expect(stormRefs.length).toBeGreaterThan(0)
    expect(stormRefs.filter(r => /MSGP|NeT\b/.test(r))).toEqual([])
    expect(stormRefs.some(r => r.includes('Order 2014-0057-DWQ'))).toBe(true)
  })

  it('Texas stormwater content cites TXR050000, not the EPA MSGP', () => {
    const tx = libraryForState('TX').library
    const stormRefs = [...tx.checklists.filter(t => t.program === 'stormwater' || t.program === 'outfall').flatMap(t => [...t.citations, ...t.items.flatMap(i => i.citations)]),
      ...tx.obligations.filter(o => o.program === 'stormwater').flatMap(o => o.citations)].map(c => c.ref)
    expect(stormRefs.filter(r => /EPA 2021 MSGP|NeT\b/.test(r))).toEqual([])
    expect(stormRefs.some(r => r.includes('TXR050000'))).toBe(true)
  })

  it('the federal library still cites the EPA MSGP, which is where it belongs', () => {
    expect(refs(libraryForState(null).library).some(r => r.includes('EPA 2021 MSGP'))).toBe(true)
  })
})

describe('what each library contains', () => {
  const ids = (lib: ResolvedLibrary, kind: 'checklists' | 'obligations' | 'legal') => lib[kind].map(x => x.id)

  it('California replaces the quarterly federal stormwater checklists with monthly observations and storm sampling', () => {
    const ca = libraryForState('CA').library
    expect(ids(ca, 'checklists')).toEqual(expect.arrayContaining(['sw-ca-mvo', 'sw-ca-qse-sampling', 'of-inspection']))
    expect(ids(ca, 'checklists')).not.toContain('sw-quarterly-visual')
    expect(ids(ca, 'checklists')).not.toContain('sw-routine-inspection')
    expect(ca.checklists.find(t => t.id === 'of-inspection')).toMatchObject({ cadence: 'monthly', source: 'CA', overrides: 'federal' })
  })

  it('California files its annual report by July 15 through SMARTS, not January 30 through NeT', () => {
    const ca = libraryForState('CA').library
    expect(ids(ca, 'obligations')).not.toContain('sw-fed-annual-report')
    expect(ca.obligations.find(o => o.id === 'sw-ca-annual-report')!.anchor).toEqual({ kind: 'annual', month: 7, day: 15 })
  })

  it('California storm sampling is semiannual on half-year ends', () => {
    const o = libraryForState('CA').library.obligations.find(x => x.id === 'sw-ca-qse')!
    expect(o).toMatchObject({ cadence: 'semiannual', anchor: { kind: 'period_end', period: 'half' } })
  })

  it('Texas keeps the quarterly checklists, re-cited, and adds its own reporting duties', () => {
    const tx = libraryForState('TX').library
    expect(ids(tx, 'checklists')).toEqual(expect.arrayContaining(['sw-routine-inspection', 'sw-quarterly-visual', 'of-inspection']))
    expect(tx.checklists.find(t => t.id === 'sw-quarterly-visual')).toMatchObject({ source: 'TX', overrides: 'federal' })
    expect(ids(tx, 'obligations')).toEqual(expect.arrayContaining(['tx-annual-waste-summary', 'tx-emissions-inventory']))
    expect(ids(tx, 'obligations')).not.toContain('sw-fed-annual-report')
  })

  it('an unsupported state sees exactly the federal library', () => {
    expect(libraryForState('OR').library).toEqual(libraryForState(null).library)
  })

  it('a state\'s items keep the federal wording where it only changed the citations', () => {
    const fed = libraryForState(null).library.checklists.find(t => t.id === 'sw-quarterly-visual')!
    const tx = libraryForState('TX').library.checklists.find(t => t.id === 'sw-quarterly-visual')!
    expect(tx.items.map(i => i.prompt)).toEqual(fed.items.map(i => i.prompt))
    expect(tx.items.map(i => i.id)).toEqual(fed.items.map(i => i.id))
  })
})

describe('unconfirmed claims, counted so any new uncertainty is visible in review', () => {
  const countVerify = (lib: ResolvedLibrary) =>
    allCitations(lib).filter(c => c.verify).length + lib.legal.filter(l => l.verify).length

  it('every library carries verify markers while the packs are drafts (the reviewer\'s worklist)', () => {
    for (const [state, lib] of libs) expect(countVerify(lib), state).toBeGreaterThan(0)
  })

  it('pins the federal and state verify-marker counts', () => {
    const counts = Object.fromEntries(libs.map(([state, lib]) => [state, countVerify(lib)]))
    // When content changes, update these in the same change so the reviewer sees the delta.
    expect(counts).toMatchInlineSnapshot(`
      {
        "CA": 69,
        "OR": 61,
        "TX": 64,
        "null": 61,
      }
    `)
  })
})
