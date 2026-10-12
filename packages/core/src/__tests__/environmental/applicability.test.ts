import { describe, it, expect } from 'vitest'
import { applies, applicableFor, type ApplicabilityContext } from '../../environmental/applicability'
import { EMPTY_SITE_PROFILE, type SiteProfile } from '../../environmental/siteProfile'

const ctx = (profile: Partial<SiteProfile> = {}, generatorCategory: ApplicabilityContext['generatorCategory'] = null): ApplicabilityContext =>
  ({ profile: { ...EMPTY_SITE_PROFILE, ...profile }, generatorCategory })

describe('applies', () => {
  it('no rule applies everywhere, even to a site that has evaluated nothing', () => {
    expect(applies(undefined, ctx())).toBe(true)
  })

  it('an empty rule applies everywhere', () => {
    expect(applies({}, ctx())).toBe(true)
  })

  it('matches stormwater coverage as "any of"', () => {
    const rule = { stormwaterCoverage: ['general_permit', 'individual_permit'] as const }
    expect(applies({ stormwaterCoverage: [...rule.stormwaterCoverage] }, ctx({ stormwaterCoverage: 'general_permit' }))).toBe(true)
    expect(applies({ stormwaterCoverage: [...rule.stormwaterCoverage] }, ctx({ stormwaterCoverage: 'no_exposure' }))).toBe(false)
  })

  it('does not guess that an unevaluated site is subject to a program', () => {
    expect(applies({ stormwaterCoverage: ['general_permit'] }, ctx())).toBe(false)
    expect(applies({ airPermitType: ['title_v'] }, ctx())).toBe(false)
  })

  it('a general-permit rule needs a permit key on the profile', () => {
    expect(applies({ stormwaterPermit: ['ca_igp'] }, ctx({ stormwaterGeneralPermit: 'ca_igp' }))).toBe(true)
    expect(applies({ stormwaterPermit: ['ca_igp'] }, ctx({ stormwaterGeneralPermit: 'tx_txr05' }))).toBe(false)
    expect(applies({ stormwaterPermit: ['ca_igp'] }, ctx({ stormwaterGeneralPermit: null }))).toBe(false)
  })

  it('matches air, wastewater and pretreatment', () => {
    expect(applies({ airPermitType: ['title_v', 'synthetic_minor'] }, ctx({ airPermitType: 'synthetic_minor' }))).toBe(true)
    expect(applies({ wastewaterDischarge: ['potw_indirect'] }, ctx({ wastewaterDischarge: 'npdes_direct' }))).toBe(false)
    expect(applies({ pretreatment: ['ciu', 'siu'] }, ctx({ pretreatmentStatus: 'siu' }))).toBe(true)
  })

  it('generator category must be known and listed', () => {
    expect(applies({ generatorCategory: ['lqg'] }, ctx({}, 'lqg'))).toBe(true)
    expect(applies({ generatorCategory: ['lqg'] }, ctx({}, 'sqg'))).toBe(false)
    expect(applies({ generatorCategory: ['lqg'] }, ctx({}, null))).toBe(false)
  })

  it('SPCC and Tier II match only on a definite answer', () => {
    expect(applies({ spcc: true }, ctx({ spccApplicable: true }))).toBe(true)
    expect(applies({ spcc: true }, ctx({ spccApplicable: null }))).toBe(false)
    expect(applies({ spcc: false }, ctx({ spccApplicable: false }))).toBe(true)
    expect(applies({ tier2: true }, ctx({ tier2Applicable: false }))).toBe(false)
  })

  it('every condition present must match (they are ANDed)', () => {
    const rule = { stormwaterCoverage: ['general_permit' as const], airPermitType: ['title_v' as const] }
    expect(applies(rule, ctx({ stormwaterCoverage: 'general_permit', airPermitType: 'title_v' }))).toBe(true)
    expect(applies(rule, ctx({ stormwaterCoverage: 'general_permit', airPermitType: 'minor_permit' }))).toBe(false)
  })
})

describe('applicableFor', () => {
  it('keeps the items whose rule matches and those with no rule, in order', () => {
    const items = [
      { id: 'always' },
      { id: 'sw', appliesWhen: { stormwaterCoverage: ['general_permit' as const] } },
      { id: 'air', appliesWhen: { airPermitType: ['title_v' as const] } },
    ]
    expect(applicableFor(items, ctx({ stormwaterCoverage: 'general_permit' })).map(i => i.id)).toEqual(['always', 'sw'])
  })
})
