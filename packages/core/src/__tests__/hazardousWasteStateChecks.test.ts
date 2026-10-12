import { describe, it, expect } from 'vitest'
import {
  ALL_HAZARDOUS_WASTE_CHECKS,
  HAZARDOUS_WASTE_AREA_TYPES,
  HAZARDOUS_WASTE_FIELD_CHECKS,
  createEmptyHazardousWasteFieldDraft,
  findingsFromDraft,
  getChecksForArea,
  summarizeHazardousWasteDraft,
} from '../hazardousWaste'
import { HAZARDOUS_WASTE_STATE_CHECKS } from '../hazardousWasteStateChecks'

const ids = (checks: ReadonlyArray<{ id: string }>) => checks.map(c => c.id)

describe('getChecksForArea without a state', () => {
  it('returns exactly the federal baseline, for every kind of area, so nothing already on file changes', () => {
    for (const areaType of HAZARDOUS_WASTE_AREA_TYPES) {
      const federal = HAZARDOUS_WASTE_FIELD_CHECKS.filter(c => c.areaTypes.includes(areaType))
      expect(getChecksForArea(areaType), areaType).toEqual(federal)
      expect(getChecksForArea(areaType, null), areaType).toEqual(federal)
      expect(getChecksForArea(areaType, undefined), areaType).toEqual(federal)
    }
  })

  it('treats a state with no additions as federal only', () => {
    for (const state of ['OR', 'NY', 'ZZ', '', 'not a state']) {
      expect(ids(getChecksForArea('central_accumulation', state)), state).toEqual(ids(getChecksForArea('central_accumulation')))
    }
  })
})

describe('getChecksForArea with a state', () => {
  it('puts the state\'s checks after the federal ones, which keep their order', () => {
    const federal = ids(getChecksForArea('central_accumulation'))
    const california = ids(getChecksForArea('central_accumulation', 'CA'))
    expect(california.slice(0, federal.length)).toEqual(federal)
    expect(california.slice(federal.length)).toEqual(['ca-label-contents', 'ca-ehw-identified'])
  })

  it('accepts the state however the site wrote it', () => {
    const expected = ids(getChecksForArea('central_accumulation', 'CA'))
    for (const written of ['CA', 'ca', ' CA ', 'California', 'california']) {
      expect(ids(getChecksForArea('central_accumulation', written)), written).toEqual(expected)
    }
  })

  it('adds a state check only to the kinds of area it names', () => {
    expect(ids(getChecksForArea('universal_waste', 'CA'))).toContain('ca-uw-category')
    expect(ids(getChecksForArea('central_accumulation', 'CA'))).not.toContain('ca-uw-category')
    expect(ids(getChecksForArea('used_oil', 'CA'))).toContain('ca-used-oil-hauler')
    expect(ids(getChecksForArea('satellite_accumulation', 'TX'))).toEqual(expect.arrayContaining(['tx-class-known']))
    expect(ids(getChecksForArea('satellite_accumulation', 'TX'))).not.toContain('tx-class1-apart')
    expect(ids(getChecksForArea('central_accumulation', 'TX'))).toContain('tx-class1-apart')
  })

  it('does not leak one state\'s checks into another\'s', () => {
    expect(ids(getChecksForArea('central_accumulation', 'TX')).some(id => id.startsWith('ca-'))).toBe(false)
    expect(ids(getChecksForArea('central_accumulation', 'CA')).some(id => id.startsWith('tx-'))).toBe(false)
  })
})

describe('the state check catalog', () => {
  const stateChecks = Object.values(HAZARDOUS_WASTE_STATE_CHECKS).flat()

  it('never reuses a federal check id, so an inspection on file keeps its meaning', () => {
    const federal = new Set(ids(HAZARDOUS_WASTE_FIELD_CHECKS))
    expect(stateChecks.filter(c => federal.has(c.id)).map(c => c.id)).toEqual([])
    expect(new Set(ids(ALL_HAZARDOUS_WASTE_CHECKS)).size).toBe(ALL_HAZARDOUS_WASTE_CHECKS.length)
  })

  it('prefixes each id with its state, so the state is evident in stored findings', () => {
    for (const [state, checks] of Object.entries(HAZARDOUS_WASTE_STATE_CHECKS)) {
      for (const check of checks) expect(check.id.startsWith(`${state.toLowerCase()}-`), check.id).toBe(true)
    }
  })

  it('is a draft: every state check names its rule and says what to confirm', () => {
    for (const check of stateChecks) {
      expect(check.citation?.trim(), check.id).toBeTruthy()
      expect((check.verify ?? '').trim().length, check.id).toBeGreaterThan(10)
    }
  })

  it('only names real kinds of area', () => {
    for (const check of stateChecks) {
      expect(check.areaTypes.length, check.id).toBeGreaterThan(0)
      for (const areaType of check.areaTypes) expect(HAZARDOUS_WASTE_AREA_TYPES as readonly string[], check.id).toContain(areaType)
    }
  })

  it('leaves the federal checks without a citation: they predate the draft marking', () => {
    expect(HAZARDOUS_WASTE_FIELD_CHECKS.some(c => c.citation || c.verify)).toBe(false)
  })

  it('exposes every check, federal and state, for validating an id that arrives from a client', () => {
    expect(ids(ALL_HAZARDOUS_WASTE_CHECKS)).toEqual(expect.arrayContaining(['closed-container', 'ca-label-contents', 'tx-class-known']))
  })
})

describe('a draft and its findings with a state', () => {
  const draft = createEmptyHazardousWasteFieldDraft('central_accumulation')

  it('a draft is not ready for review until the state\'s checks are answered too', () => {
    const federalIds = ids(getChecksForArea('central_accumulation'))
    expect(summarizeHazardousWasteDraft({ ...draft, checkedIds: federalIds }).readyForReview).toBe(true)
    const inCalifornia = summarizeHazardousWasteDraft({ ...draft, checkedIds: federalIds }, 'CA')
    expect(inCalifornia.readyForReview).toBe(false)
    expect(inCalifornia.total).toBe(federalIds.length + 2)

    const all = ids(getChecksForArea('central_accumulation', 'CA'))
    expect(summarizeHazardousWasteDraft({ ...draft, checkedIds: all }, 'CA').readyForReview).toBe(true)
  })

  it('a flagged state check counts as a critical failure when the check is critical', () => {
    const summary = summarizeHazardousWasteDraft({ ...draft, checkedIds: [], flaggedIds: ['ca-label-contents'] }, 'CA')
    expect(summary.flaggedCritical).toBe(1)
  })

  it('records every state check in the findings, unanswered ones as skipped', () => {
    const findings = findingsFromDraft({ ...draft, checkedIds: ['closed-container'], flaggedIds: ['ca-ehw-identified'] }, 'CA')
    const byId = Object.fromEntries(findings.map(f => [f.check_id, f]))
    expect(byId['closed-container']!.status).toBe('pass')
    expect(byId['ca-ehw-identified']).toMatchObject({ status: 'fail', flagged_critical: true })
    expect(byId['ca-label-contents']!.status).toBe('na')
    expect(findings).toHaveLength(getChecksForArea('central_accumulation', 'CA').length)
  })

  it('without a state, findings are exactly the federal rows', () => {
    expect(ids(findingsFromDraft(draft).map(f => ({ id: f.check_id })))).toEqual(ids(getChecksForArea('central_accumulation')))
  })
})
