import { describe, it, expect } from 'vitest'
import { resolveLibrary, PackError } from '../../environmental/resolve'
import type {
  ChecklistItemDef, ChecklistTemplateDef, JurisdictionPack, ObligationDef, PackMeta,
} from '../../environmental/content'

const meta = (jurisdiction: 'federal' | 'CA' | 'TX'): PackMeta => ({
  jurisdiction, version: '0.1.0', draftedOn: '2026-10-07', lastVerified: null, status: 'draft', reviewer: null,
})

const item = (id: string, over: Partial<ChecklistItemDef> = {}): ChecklistItemDef => ({
  id, section: 'S', prompt: `Prompt ${id}`, itemType: 'pass_fail_na', weight: 1, required: true,
  failCreatesAction: false, critical: false, citations: [{ ref: 'REF' }], ...over,
})

const template = (id: string, items: ChecklistItemDef[], over: Partial<ChecklistTemplateDef> = {}): ChecklistTemplateDef => ({
  id, program: 'stormwater', name: `Template ${id}`, description: 'd', subjectType: 'facility',
  cadence: 'quarterly', items, citations: [{ ref: 'REF' }], ...over,
})

const obligation = (id: string, over: Partial<ObligationDef> = {}): ObligationDef => ({
  id, program: 'stormwater', title: `Obligation ${id}`, description: 'd', cadence: 'annual',
  anchor: { kind: 'annual', month: 1, day: 30 }, leadDays: 30, citations: [{ ref: 'REF' }], ...over,
})

const federal = (): JurisdictionPack => ({
  meta: meta('federal'),
  checklists: { add: [template('sw-inspect', [item('a'), item('b')]), template('sw-visual', [item('c')])] },
  obligations: { add: [obligation('annual-report'), obligation('swppp-review')] },
})

const resolve = (chain: Array<'federal' | 'CA' | 'TX'>, packs: Partial<Record<'federal' | 'CA' | 'TX', JurisdictionPack>>) =>
  resolveLibrary(chain, packs)

describe('resolveLibrary — layering', () => {
  it('a federal-only chain returns the federal pack, every item sourced to federal', () => {
    const lib = resolve(['federal'], { federal: federal() })
    expect(lib.checklists.map(t => t.id)).toEqual(['sw-inspect', 'sw-visual'])
    expect(lib.checklists.every(t => t.source === 'federal' && t.items.every(i => i.source === 'federal'))).toBe(true)
    expect(lib.obligations.map(o => o.id)).toEqual(['annual-report', 'swppp-review'])
    expect(lib.chain).toEqual(['federal'])
    expect(lib.packs.map(p => p.jurisdiction)).toEqual(['federal'])
  })

  it('a state adds its own items after the federal ones', () => {
    const ca: JurisdictionPack = { meta: meta('CA'), obligations: { add: [obligation('ca-report', { anchor: { kind: 'annual', month: 7, day: 15 } })] } }
    const lib = resolve(['federal', 'CA'], { federal: federal(), CA: ca })
    expect(lib.obligations.map(o => o.id)).toEqual(['annual-report', 'swppp-review', 'ca-report'])
    expect(lib.obligations.map(o => o.source)).toEqual(['federal', 'federal', 'CA'])
  })

  it('removing a federal item and adding the state\'s own leaves only the state\'s', () => {
    const ca: JurisdictionPack = {
      meta: meta('CA'),
      obligations: {
        remove: [{ id: 'annual-report', reason: 'California reports through SMARTS, not the EPA MSGP' }],
        add: [obligation('ca-report', { anchor: { kind: 'annual', month: 7, day: 15 } })],
      },
    }
    const lib = resolve(['federal', 'CA'], { federal: federal(), CA: ca })
    expect(lib.obligations.map(o => o.id)).toEqual(['swppp-review', 'ca-report'])
  })

  it('replace keeps the id, takes the new content and records what it overrode', () => {
    const tx: JurisdictionPack = { meta: meta('TX'), obligations: { replace: [obligation('annual-report', { title: 'Texas version' })] } }
    const lib = resolve(['federal', 'TX'], { federal: federal(), TX: tx })
    const replaced = lib.obligations.find(o => o.id === 'annual-report')!
    expect(replaced).toMatchObject({ title: 'Texas version', source: 'TX', overrides: 'federal' })
    expect(lib.obligations.map(o => o.id)).toEqual(['annual-report', 'swppp-review'])
  })

  it('patch changes only the fields named and keeps the rest', () => {
    const tx: JurisdictionPack = { meta: meta('TX'), obligations: { patch: [{ id: 'annual-report', fields: { leadDays: 60 } }] } }
    const o = resolve(['federal', 'TX'], { federal: federal(), TX: tx }).obligations.find(x => x.id === 'annual-report')!
    expect(o).toMatchObject({ leadDays: 60, title: 'Obligation annual-report', source: 'TX', overrides: 'federal' })
  })

  it('runs remove, replace, patch, add in that order within a pack', () => {
    const ca: JurisdictionPack = {
      meta: meta('CA'),
      obligations: {
        add: [obligation('annual-report', { title: 're-added' })],        // legal only because remove ran first
        remove: [{ id: 'annual-report', reason: 'swap' }],
        patch: [{ id: 'swppp-review', fields: { title: 'patched' } }],
        replace: [obligation('swppp-review', { title: 'replaced' })],     // replace runs before patch
      },
    }
    const lib = resolve(['federal', 'CA'], { federal: federal(), CA: ca })
    expect(lib.obligations.find(o => o.id === 'swppp-review')!.title).toBe('patched')
    expect(lib.obligations.find(o => o.id === 'annual-report')!.title).toBe('re-added')
  })

  it('layers a third jurisdiction on the second, provenance following the last writer', () => {
    const ca: JurisdictionPack = { meta: meta('CA'), obligations: { patch: [{ id: 'annual-report', fields: { leadDays: 45 } }] } }
    const tx: JurisdictionPack = { meta: meta('TX'), obligations: { patch: [{ id: 'annual-report', fields: { leadDays: 90 } }] } }
    const o = resolve(['federal', 'CA', 'TX'], { federal: federal(), CA: ca, TX: tx }).obligations.find(x => x.id === 'annual-report')!
    expect(o).toMatchObject({ leadDays: 90, source: 'TX', overrides: 'CA' })
  })

  it('does not mutate the packs it was given, so resolving twice agrees', () => {
    const packs = { federal: federal(), CA: { meta: meta('CA'), obligations: { patch: [{ id: 'annual-report', fields: { leadDays: 5 } }] } } as JurisdictionPack }
    const before = JSON.stringify(packs)
    const first = resolve(['federal', 'CA'], packs)
    const second = resolve(['federal', 'CA'], packs)
    expect(JSON.stringify(packs)).toBe(before)
    expect(second).toEqual(first)
  })
})

describe('resolveLibrary — checklist items', () => {
  it('a state can add, patch, replace and remove items of a federal template', () => {
    const ca: JurisdictionPack = {
      meta: meta('CA'),
      checklistItems: {
        'sw-inspect': {
          remove:  [{ id: 'b', reason: 'not applicable in California' }],
          patch:   [{ id: 'a', fields: { critical: true } }],
          add:     [item('ca-only', { prompt: 'California-only question' })],
        },
      },
    }
    const t = resolve(['federal', 'CA'], { federal: federal(), CA: ca }).checklists.find(x => x.id === 'sw-inspect')!
    expect(t.items.map(i => i.id)).toEqual(['a', 'ca-only'])
    expect(t.items.find(i => i.id === 'a')).toMatchObject({ critical: true, source: 'CA', overrides: 'federal' })
    expect(t.items.find(i => i.id === 'ca-only')!.source).toBe('CA')
    expect(t.source).toBe('CA')
    expect(t.overrides).toBe('federal')
  })

  it('a patched template keeps its items unless the patch supplies new ones', () => {
    const tx: JurisdictionPack = { meta: meta('TX'), checklists: { patch: [{ id: 'sw-inspect', fields: { cadence: 'monthly' } }] } }
    const t = resolve(['federal', 'TX'], { federal: federal(), TX: tx }).checklists.find(x => x.id === 'sw-inspect')!
    expect(t.cadence).toBe('monthly')
    expect(t.items.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('item changes can target a checklist the same pack adds', () => {
    const ca: JurisdictionPack = {
      meta: meta('CA'),
      checklists: { add: [template('ca-visual', [item('x')])] },
      checklistItems: { 'ca-visual': { add: [item('y')] } },
    }
    const t = resolve(['federal', 'CA'], { federal: federal(), CA: ca }).checklists.find(x => x.id === 'ca-visual')!
    expect(t.items.map(i => i.id)).toEqual(['x', 'y'])
  })
})

describe('resolveLibrary — a bad pack fails loudly, naming the pack and the id', () => {
  const bad = (pack: Partial<JurisdictionPack>) => () =>
    resolve(['federal', 'CA'], { federal: federal(), CA: { meta: meta('CA'), ...pack } })

  it('refuses to remove, replace or patch something that is not there', () => {
    expect(bad({ obligations: { remove: [{ id: 'nope', reason: 'x' }] } })).toThrow(/pack CA: cannot remove obligation 'nope'/)
    expect(bad({ obligations: { replace: [obligation('nope')] } })).toThrow(/cannot replace obligation 'nope'/)
    expect(bad({ obligations: { patch: [{ id: 'nope', fields: {} }] } })).toThrow(/cannot patch obligation 'nope'/)
  })

  it('refuses an add that would shadow an existing id', () => {
    expect(bad({ obligations: { add: [obligation('annual-report')] } })).toThrow(/cannot add obligation 'annual-report': that id already exists/)
  })

  it('refuses a removal with no reason', () => {
    expect(bad({ obligations: { remove: [{ id: 'annual-report', reason: '  ' }] } })).toThrow(/needs a reason/)
  })

  it('refuses a patch that tries to change the id', () => {
    expect(bad({ obligations: { patch: [{ id: 'annual-report', fields: { id: 'other' } as never }] } })).toThrow(/cannot change the id/)
  })

  it('refuses item changes aimed at a checklist that does not exist', () => {
    expect(bad({ checklistItems: { ghost: { add: [item('z')] } } })).toThrow(/checklist 'ghost', which does not exist/)
  })

  it('refuses item removals aimed at an item that does not exist', () => {
    expect(bad({ checklistItems: { 'sw-inspect': { remove: [{ id: 'zzz', reason: 'x' }] } } })).toThrow(/cannot remove item of 'sw-inspect' 'zzz'/)
  })

  it('refuses a chain whose pack is missing, or registered under the wrong jurisdiction', () => {
    expect(() => resolve(['federal', 'CA'], { federal: federal() })).toThrow(/pack CA: is in the jurisdiction chain but no pack is registered/)
    expect(() => resolve(['federal', 'CA'], { federal: federal(), CA: { meta: meta('TX') } })).toThrow(/registered under 'CA' but declares jurisdiction 'TX'/)
  })

  it('throws a PackError a caller can recognise', () => {
    expect(bad({ obligations: { remove: [{ id: 'nope', reason: 'x' }] } })).toThrow(PackError)
  })
})
