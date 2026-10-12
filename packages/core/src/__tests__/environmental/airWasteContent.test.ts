import { describe, it, expect } from 'vitest'
import { libraryForState } from '../../environmental/packs'
import { SUPPORTED_STATES } from '../../environmental/jurisdiction'
import { applicableFor, applies } from '../../environmental/applicability'
import { firstDueDate, planLibraryObligations } from '../../environmental/calendarPlan'
import { buildTemplateRows } from '../../environmental/checklists'
import { EMPTY_SITE_PROFILE, type SiteProfile } from '../../environmental/siteProfile'
import type { RcraGeneratorCategory } from '../../hazardousWaste'

// What the air, wastewater, hazardous waste program and manifest content does for a
// site, as opposed to whether it is well formed (packsIntegrity covers that).

const profile = (over: Partial<SiteProfile> = {}): SiteProfile => ({ ...EMPTY_SITE_PROFILE, ...over })
const context = (over: Partial<SiteProfile> = {}, generatorCategory: RcraGeneratorCategory | null = null) =>
  ({ profile: profile(over), generatorCategory })

const idsFor = (state: string | null, ctx: ReturnType<typeof context>) => {
  const { library } = libraryForState(state)
  return {
    checklists:  applicableFor(library.checklists, ctx).map(t => t.id),
    obligations: applicableFor(library.obligations, ctx).map(o => o.id),
    legal:       applicableFor(library.legal, ctx).map(l => l.id),
  }
}

describe('who gets the air content', () => {
  it('a site with an air permit gets the walkthrough and the engine log, and a site without one gets neither', () => {
    const permitted = idsFor(null, context({ airPermitType: 'minor_permit' }))
    expect(permitted.checklists).toEqual(expect.arrayContaining(['air-permit-walkthrough', 'air-engine-log']))
    expect(permitted.obligations).toEqual(expect.arrayContaining(['air-fed-walkthrough', 'air-fed-engine-log']))

    for (const airPermitType of ['not_evaluated', 'not_required', 'exempt'] as const) {
      const none = idsFor(null, context({ airPermitType }))
      expect(none.checklists, airPermitType).not.toContain('air-permit-walkthrough')
      expect(none.obligations, airPermitType).not.toContain('air-fed-walkthrough')
    }
  })

  it('Title V sources see the Title V entry, minor sources do not', () => {
    expect(idsFor(null, context({ airPermitType: 'title_v' })).legal).toContain('lr-fed-title-v')
    expect(idsFor(null, context({ airPermitType: 'minor_permit' })).legal).not.toContain('lr-fed-title-v')
  })
})

describe('who gets the wastewater content', () => {
  it('sewer and direct dischargers get the treatment rounds; zero-discharge and unset sites do not', () => {
    for (const wastewaterDischarge of ['potw_indirect', 'npdes_direct'] as const) {
      expect(idsFor(null, context({ wastewaterDischarge })).checklists, wastewaterDischarge).toContain('ww-treatment-rounds')
    }
    for (const wastewaterDischarge of ['not_evaluated', 'none', 'zero_discharge', 'septic'] as const) {
      expect(idsFor(null, context({ wastewaterDischarge })).checklists, wastewaterDischarge).not.toContain('ww-treatment-rounds')
    }
  })

  it('only direct dischargers see the NPDES conditions entry', () => {
    expect(idsFor(null, context({ wastewaterDischarge: 'npdes_direct' })).legal).toContain('lr-fed-npdes-individual')
    expect(idsFor(null, context({ wastewaterDischarge: 'potw_indirect' })).legal).not.toContain('lr-fed-npdes-individual')
  })
})

describe('who gets the hazardous waste program content', () => {
  it('large and small generators get the program review and the manifest pre-shipment check; very small and unset do not', () => {
    for (const category of ['lqg', 'sqg'] as const) {
      const ids = idsFor(null, context({}, category))
      expect(ids.checklists, category).toEqual(expect.arrayContaining(['hw-program-review', 'manifest-pre-shipment']))
      expect(ids.obligations, category).toContain('hw-fed-program-review')
    }
    for (const category of ['vsqg', null] as const) {
      const ids = idsFor(null, context({}, category))
      expect(ids.checklists, String(category)).not.toContain('hw-program-review')
      expect(ids.checklists, String(category)).not.toContain('manifest-pre-shipment')
    }
  })

  it('the training and contingency questions follow the generator category, so each site is asked only its own', () => {
    const { library } = libraryForState(null)
    const review = library.checklists.find(t => t.id === 'hw-program-review')!
    const asked = (category: RcraGeneratorCategory) =>
      review.items.filter(i => applies(i.appliesWhen, context({}, category))).map(i => i.id)

    expect(asked('lqg')).toEqual(expect.arrayContaining(['hw-pr.training-lqg', 'hw-pr.contingency-lqg']))
    expect(asked('lqg')).not.toContain('hw-pr.training-sqg')
    expect(asked('sqg')).toEqual(expect.arrayContaining(['hw-pr.training-sqg', 'hw-pr.emergency-sqg']))
    expect(asked('sqg')).not.toContain('hw-pr.contingency-lqg')
  })

  it('the instances for the two categories are stored apart, because their item sets differ', () => {
    const { library, jurisdiction } = libraryForState(null)
    const review = library.checklists.find(t => t.id === 'hw-program-review')!
    const version = { libraryVersion: 'v', lastVerified: null }
    const lqg = buildTemplateRows(review, context({}, 'lqg'), jurisdiction.chain, version).companion.jurisdiction_key
    const sqg = buildTemplateRows(review, context({}, 'sqg'), jurisdiction.chain, version).companion.jurisdiction_key
    expect(lqg).not.toBe(sqg)
  })

  it('the biennial report is for large generators and lands on a March 1 in an even year', () => {
    expect(idsFor(null, context({}, 'sqg')).obligations).not.toContain('hw-fed-biennial-report')
    const { library } = libraryForState(null)
    const plan = planLibraryObligations(library, context({}, 'lqg'), 'facility-1', new Set(), new Date(Date.UTC(2026, 9, 12)))
    const biennial = plan.toCreate.find(o => o.library_key === 'hw-fed-biennial-report')!
    expect(biennial.next_due_at).toBe('2028-03-01')
    expect(biennial.cadence).toBe('biennial')
  })

  it('the Tier II and SPCC deadlines appear only when the site has said they apply', () => {
    expect(idsFor(null, context({ tier2Applicable: true, spccApplicable: true })).obligations)
      .toEqual(expect.arrayContaining(['epcra-fed-tier2', 'spcc-fed-plan-review', 'spcc-fed-annual-briefing']))
    expect(idsFor(null, context({ tier2Applicable: null, spccApplicable: false })).obligations)
      .not.toEqual(expect.arrayContaining(['epcra-fed-tier2']))
    expect(idsFor(null, context({ spccApplicable: false })).obligations).not.toContain('spcc-fed-plan-review')
  })
})

describe('no weekly accumulation-area checklist is duplicated here', () => {
  it('the library has no satellite or central accumulation checklist: the hazardous waste module owns those walks', () => {
    for (const state of [null, ...SUPPORTED_STATES]) {
      const subjectTypes = libraryForState(state).library.checklists.map(t => t.subjectType)
      expect(subjectTypes, String(state)).not.toContain('hw_area')
    }
  })
})

describe('California', () => {
  const ca = libraryForState('CA').library

  it('asks about a lower engine testing-hours limit than the federal 100, and cites the state rule for it', () => {
    const fed = libraryForState(null).library.checklists.find(t => t.id === 'air-engine-log')!.items.find(i => i.id === 'air-eng.testing-hours')!
    const state = ca.checklists.find(t => t.id === 'air-engine-log')!.items.find(i => i.id === 'air-eng.testing-hours')!
    expect(fed.numeric).toEqual({ max: 100, unit: 'hours' })
    expect(state.numeric!.max).toBeLessThan(fed.numeric!.max!)
    expect(state.citations.map(c => c.ref).join(' ')).toMatch(/17 CCR/)
    expect(state.critical).toBe(true)
    expect(state.failCreatesAction).toBe(true)
  })

  it('cites the district permit for the air walkthrough instead of leaving only the federal Title V rule', () => {
    const refs = ca.checklists.find(t => t.id === 'air-permit-walkthrough')!.citations.map(c => c.ref).join(' | ')
    expect(refs).toMatch(/air district/i)
    expect(refs).toMatch(/42300/)
  })

  it('adds the DTSC copy step to the pre-shipment check, inside the paperwork section and before the signature', () => {
    const items = ca.checklists.find(t => t.id === 'manifest-pre-shipment')!.items
    const at = items.findIndex(i => i.id === 'mf-ps.ca-dtsc')
    expect(at).toBeGreaterThan(-1)
    expect(items[at - 1]!.id).toBe('mf-ps.signed')
    expect(items[at]!.section).toBe(items[at - 1]!.section)
    expect(items.at(-1)!.itemType).toBe('signature')
  })

  it('adds the state manifest, fee, universal waste, Unified Program and engine entries', () => {
    const legal = idsFor('CA', context({ airPermitType: 'minor_permit', wastewaterDischarge: 'zero_discharge' }, 'sqg')).legal
    expect(legal).toEqual(expect.arrayContaining([
      'lr-ca-hw-manifest', 'lr-ca-hw-fees', 'lr-ca-universal-waste', 'lr-ca-cupa', 'lr-ca-engine-atcm', 'lr-ca-wdr',
    ]))
  })

  it('shows the engine rule only to sites with an air permit', () => {
    expect(idsFor('CA', context({ airPermitType: 'not_required' })).legal).not.toContain('lr-ca-engine-atcm')
  })
})

describe('Texas', () => {
  const tx = libraryForState('TX').library

  it('adds the Texas waste code and registration questions to the pre-shipment check, each in its section', () => {
    const items = tx.checklists.find(t => t.id === 'manifest-pre-shipment')!.items
    const ids = items.map(i => i.id)
    expect(ids.indexOf('mf-ps.tx-waste-code')).toBe(ids.indexOf('mf-ps.description') + 1)
    expect(ids.indexOf('mf-ps.tx-registration')).toBe(ids.indexOf('mf-ps.ids') + 1)
    expect(items.at(-1)!.itemType).toBe('signature')
  })

  it('does not change the federal engine-hours limit, which Texas follows', () => {
    const item = tx.checklists.find(t => t.id === 'air-engine-log')!.items.find(i => i.id === 'air-eng.testing-hours')!
    expect(item.numeric).toEqual({ max: 100, unit: 'hours' })
  })

  it('keeps the biennial report but tells the reader about the Annual Waste Summary', () => {
    const biennial = tx.obligations.find(o => o.id === 'hw-fed-biennial-report')!
    expect(biennial.description).toMatch(/Annual Waste Summary/)
    expect(biennial.citations.some(c => c.verify)).toBe(true)
    expect(biennial.anchor).toEqual({ kind: 'annual', month: 3, day: 1, yearParity: 'even' })
  })

  it('adds Texas air, manifest, classification, registration and wastewater entries', () => {
    const legal = idsFor('TX', context({ airPermitType: 'title_v', wastewaterDischarge: 'npdes_direct' }, 'lqg')).legal
    expect(legal).toEqual(expect.arrayContaining([
      'lr-tx-air-permits', 'lr-tx-title-v', 'lr-tx-manifest', 'lr-tx-waste-classification', 'lr-tx-registration', 'lr-tx-tpdes-individual',
    ]))
    expect(idsFor('TX', context({ wastewaterDischarge: 'potw_indirect' })).legal).toContain('lr-tx-pretreatment')
  })
})

describe('every checklist in every library still ends with its signature', () => {
  it('an overlay-added question never lands after the signature', () => {
    for (const state of [null, ...SUPPORTED_STATES]) {
      for (const template of libraryForState(state).library.checklists) {
        expect(template.items.at(-1)!.itemType, `${state}/${template.id}`).toBe('signature')
      }
    }
  })
})

describe('a pre-shipment run is not scheduled', () => {
  it('has no deadline of its own: shipments are tracked by their return-copy clock, not by the calendar', () => {
    const { library } = libraryForState(null)
    expect(library.obligations.filter(o => o.checklistTemplateId === 'manifest-pre-shipment')).toEqual([])
    expect(library.checklists.find(t => t.id === 'manifest-pre-shipment')!.cadence).toBe('once')
  })

  it('first-due arithmetic for a rolling annual deadline is one year on', () => {
    expect(firstDueDate({ kind: 'rolling' }, 'annual', undefined, new Date(Date.UTC(2026, 9, 12)))).toBe('2027-10-12')
  })
})
