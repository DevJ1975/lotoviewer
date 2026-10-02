import { describe, it, expect } from 'vitest'
import {
  CHANGE_KINDS,
  RESOLUTION_GAP_MESSAGES,
  TRANSFER_STEPS,
  changeCloseGaps,
  changeImpacts,
  impactResolutionGaps,
  ownershipChangeChecklist,
  validateChangeInput,
  type ChangeForFanOut,
  type ChangeInput,
  type FanOutContext,
  type ResolutionContext,
} from '../managementOfChange'
import { NotImplementedError } from '../ohsPlaceholder'

const SITE_A = 'facility-a'
const SITE_B = 'facility-b'
const NEW_ENTITY = 'Northfield Forge & Finish Holdings LLC'

const context: FanOutContext = {
  permits: [
    { id: 'p-air',   title: 'Paint booth permit by rule', agency: 'State air agency', facilityId: SITE_A, retiredAt: null },
    { id: 'p-water', title: 'Wastewater discharge',       agency: 'City of Northfield', facilityId: SITE_A, retiredAt: null },
    { id: 'p-old',   title: 'Retired registration',       agency: 'State agency',       facilityId: SITE_A, retiredAt: '2025-01-01T00:00:00Z' },
    { id: 'p-b',     title: 'Second plant stormwater',    agency: 'State water agency', facilityId: SITE_B, retiredAt: null },
  ],
  scope:  { id: 'scope-3' },
  policy: { id: 'policy-2' },
  aspects: [
    { id: 'a-1', aspect: 'VOC emissions',      processArea: 'Paint Line', facilityId: SITE_A, obsoleteAt: null },
    { id: 'a-2', aspect: 'Overspray waste',    processArea: ' paint line ', facilityId: SITE_A, obsoleteAt: null },
    { id: 'a-3', aspect: 'Retired booth',      processArea: 'Paint Line', facilityId: SITE_A, obsoleteAt: '2025-01-01T00:00:00Z' },
    { id: 'a-4', aspect: 'Quench oil',         processArea: 'Forge',      facilityId: SITE_A, obsoleteAt: null },
    { id: 'a-5', aspect: 'Other plant paint',  processArea: 'Paint Line', facilityId: SITE_B, obsoleteAt: null },
  ],
  obligations: [
    { id: 'o-air',   title: 'Coating records',      category: 'air',        status: 'open',      facilityId: SITE_A },
    { id: 'o-waste', title: 'Generator status',     category: ' Waste ',    status: 'open',      facilityId: null },
    { id: 'o-done',  title: 'One-off air notice',   category: 'air',        status: 'completed', facilityId: SITE_A },
    { id: 'o-water', title: 'Quarterly visual',     category: 'stormwater', status: 'open',      facilityId: SITE_A },
    { id: 'o-b',     title: 'Other plant air',      category: 'air',        status: 'open',      facilityId: SITE_B },
  ],
}

const change = (overrides: Partial<ChangeForFanOut> = {}): ChangeForFanOut => ({
  discipline: 'ems', kind: 'other', facilityId: SITE_A, processArea: null, newLegalEntity: null, ...overrides,
})

const targets = (impacts: ReturnType<typeof changeImpacts>) => impacts.map(i => `${i.targetType}:${i.targetId}${i.step ? `:${i.step}` : ''}`)

describe('ownershipChangeChecklist', () => {
  it('gives each permit three steps in order, naming the new entity where it matters', () => {
    const checklist = ownershipChangeChecklist([{ id: 'p1', title: 'Air permit', agency: 'State air agency' }], NEW_ENTITY)
    expect(checklist.map(item => [item.step, item.stepOrder])).toEqual([
      ['notify_agency', 1], ['submit_transfer', 2], ['confirm_holder', 3],
    ])
    expect(checklist.every(item => item.targetType === 'permit' && item.targetId === 'p1')).toBe(true)
    expect(checklist[2].actionRequired).toContain(NEW_ENTITY)
  })

  it('keeps permit order, then step order, and is empty with no permits', () => {
    const permits = [
      { id: 'p1', title: 'A', agency: 'X' }, { id: 'p2', title: 'B', agency: 'Y' }, { id: 'p3', title: 'C', agency: 'Z' },
    ]
    const checklist = ownershipChangeChecklist(permits, NEW_ENTITY)
    expect(checklist).toHaveLength(9)
    expect(checklist.map(item => item.targetId)).toEqual(['p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p3', 'p3', 'p3'])
    expect(ownershipChangeChecklist([], NEW_ENTITY)).toEqual([])
  })

  it('uses exactly the three transfer steps', () => {
    expect(TRANSFER_STEPS).toEqual(['notify_agency', 'submit_transfer', 'confirm_holder'])
  })
})

describe('changeImpacts', () => {
  it('turns an ownership change into transfer checklists for the site\'s active permits, plus the scope and policy', () => {
    const impacts = changeImpacts(change({ kind: 'ownership_name', newLegalEntity: NEW_ENTITY }), context)
    expect(targets(impacts)).toEqual([
      'permit:p-air:notify_agency', 'permit:p-air:submit_transfer', 'permit:p-air:confirm_holder',
      'permit:p-water:notify_agency', 'permit:p-water:submit_transfer', 'permit:p-water:confirm_holder',
      'scope:scope-3', 'policy:policy-2',
    ])
  })

  it('covers every site when the ownership change covers the whole organization', () => {
    const impacts = changeImpacts(change({ kind: 'ownership_name', facilityId: null, newLegalEntity: NEW_ENTITY }), context)
    expect(new Set(impacts.filter(i => i.targetType === 'permit').map(i => i.targetId))).toEqual(new Set(['p-air', 'p-water', 'p-b']))
  })

  it('leaves out the scope and policy when none is recorded', () => {
    const impacts = changeImpacts(change({ kind: 'ownership_name', newLegalEntity: NEW_ENTITY }),
      { ...context, scope: null, policy: null })
    expect(impacts.every(i => i.targetType === 'permit')).toBe(true)
  })

  it.each(['equipment', 'process'] as const)('sends a %s change to the active aspects in its process area, ignoring case and spaces', kind => {
    expect(targets(changeImpacts(change({ kind, processArea: 'paint line' }), context))).toEqual(['aspect:a-1', 'aspect:a-2'])
  })

  it('sends a chemical change to its area\'s aspects and the open air and waste obligations at the site', () => {
    expect(targets(changeImpacts(change({ kind: 'chemical', processArea: 'Paint Line' }), context)))
      .toEqual(['aspect:a-1', 'aspect:a-2', 'obligation:o-air', 'obligation:o-waste'])
  })

  it('touches only obligations for a chemical change with no process area', () => {
    expect(targets(changeImpacts(change({ kind: 'chemical' }), context))).toEqual(['obligation:o-air', 'obligation:o-waste'])
  })

  it.each(['personnel', 'other'] as const)('creates nothing automatically for a %s change', kind => {
    expect(changeImpacts(change({ kind }), context)).toEqual([])
  })

  it('throws NotImplementedError for an OH&S change, as the ISO 45001 seam requires', () => {
    expect(() => changeImpacts(change({ discipline: 'ohs', kind: 'equipment', processArea: 'Forge' }), context))
      .toThrow(NotImplementedError)
  })

  it('fans out an integrated change environmentally until OH&S hazards exist', () => {
    expect(targets(changeImpacts(change({ discipline: 'integrated', kind: 'process', processArea: 'Forge' }), context)))
      .toEqual(['aspect:a-4'])
  })

  it('handles every change kind', () => {
    for (const kind of CHANGE_KINDS) {
      expect(() => changeImpacts(change({ kind, processArea: 'Forge', newLegalEntity: NEW_ENTITY }), context)).not.toThrow()
    }
  })
})

describe('changeCloseGaps', () => {
  it('is empty when every impact is resolved, including when there are none', () => {
    expect(changeCloseGaps([])).toEqual([])
    expect(changeCloseGaps([{ resolvedAt: '2026-10-01T00:00:00Z' }])).toEqual([])
  })

  it('counts what is still open', () => {
    expect(changeCloseGaps([{ resolvedAt: null }])).toEqual(['1 impact is not resolved yet.'])
    expect(changeCloseGaps([{ resolvedAt: null }, { resolvedAt: null }, { resolvedAt: '2026-10-01T00:00:00Z' }]))
      .toEqual(['2 impacts are not resolved yet.'])
  })
})

describe('impactResolutionGaps', () => {
  const ctx = (overrides: Partial<ResolutionContext> = {}): ResolutionContext => ({
    changeOpen: true, newLegalEntity: NEW_ENTITY, evidenceCount: 1, note: null, permitHolder: NEW_ENTITY,
    scopeInForce: { legalEntity: NEW_ENTITY, effectiveFrom: '2026-11-01' }, policySignedAt: '2026-11-01', ...overrides,
  })
  const step = (s: 'notify_agency' | 'submit_transfer' | 'confirm_holder') =>
    ({ targetType: 'permit' as const, step: s, resolvedAt: null })

  it('refuses anything once the change has ended, or the impact is resolved', () => {
    expect(impactResolutionGaps(step('notify_agency'), ctx({ changeOpen: false }))).toEqual(['change_not_open'])
    expect(impactResolutionGaps({ ...step('notify_agency'), resolvedAt: '2026-10-01T00:00:00Z' }, ctx())).toEqual(['already_resolved'])
  })

  it('needs evidence for every transfer step', () => {
    for (const s of ['notify_agency', 'submit_transfer'] as const) {
      expect(impactResolutionGaps(step(s), ctx({ evidenceCount: 0 }))).toEqual(['evidence_required'])
      expect(impactResolutionGaps(step(s), ctx())).toEqual([])
    }
  })

  it('refuses to confirm the holder while the permit names someone else', () => {
    expect(impactResolutionGaps(step('confirm_holder'), ctx({ permitHolder: 'Northfield Metal Products Inc.' })))
      .toEqual(['holder_not_updated'])
    expect(impactResolutionGaps(step('confirm_holder'), ctx({ permitHolder: 'Northfield Forge & Finish Holdings, LLC' })))
      .toEqual([])
    expect(impactResolutionGaps(step('confirm_holder'), ctx({ evidenceCount: 0, permitHolder: null })))
      .toEqual(['evidence_required', 'holder_not_updated'])
  })

  it('closes the scope impact only once the scope in force names the new entity', () => {
    const scope = { targetType: 'scope' as const, step: null, resolvedAt: null }
    expect(impactResolutionGaps(scope, ctx())).toEqual([])
    expect(impactResolutionGaps(scope, ctx({ scopeInForce: { legalEntity: 'Old Owner Inc', effectiveFrom: '2020-01-01' } })))
      .toEqual(['scope_not_updated'])
    expect(impactResolutionGaps(scope, ctx({ scopeInForce: null }))).toEqual(['scope_not_updated'])
  })

  it('closes the policy impact only once it is signed on or after the scope change', () => {
    const policy = { targetType: 'policy' as const, step: null, resolvedAt: null }
    expect(impactResolutionGaps(policy, ctx())).toEqual([])
    expect(impactResolutionGaps(policy, ctx({ policySignedAt: '2026-10-31' }))).toEqual(['policy_not_signed_again'])
    expect(impactResolutionGaps(policy, ctx({ policySignedAt: null }))).toEqual(['policy_not_signed_again'])
    expect(impactResolutionGaps(policy, ctx({ scopeInForce: { legalEntity: 'Old Owner Inc', effectiveFrom: '2020-01-01' } })))
      .toEqual(['scope_not_updated'])
  })

  it('needs a note for any other impact', () => {
    const aspect = { targetType: 'aspect' as const, step: null, resolvedAt: null }
    expect(impactResolutionGaps(aspect, ctx({ note: '   ' }))).toEqual(['note_required'])
    expect(impactResolutionGaps(aspect, ctx({ note: 'Rescored; no change to significance.' }))).toEqual([])
  })

  it('has a plain-words message for every gap', () => {
    for (const message of Object.values(RESOLUTION_GAP_MESSAGES)) expect(message).toMatch(/\.$/)
  })
})

describe('validateChangeInput', () => {
  const valid: ChangeInput = {
    discipline: 'ems', kind: 'ownership_name', title: 'Sale of the plant', description: 'The plant is sold to a new owner.',
    processArea: null, newLegalEntity: NEW_ENTITY, effectiveOn: '2026-12-01',
  }
  const fields = (input: ChangeInput) => validateChangeInput(input).map(error => error.field)

  it('accepts a complete ownership change', () => {
    expect(validateChangeInput(valid)).toEqual([])
  })

  it('requires the new legal entity for an ownership change, and refuses it otherwise', () => {
    expect(fields({ ...valid, newLegalEntity: ' ' })).toEqual(['newLegalEntity'])
    expect(fields({ ...valid, kind: 'other' })).toEqual(['newLegalEntity'])
    expect(validateChangeInput({ ...valid, kind: 'other', newLegalEntity: null })).toEqual([])
  })

  it.each(['equipment', 'process'] as const)('requires a process area for a %s change', kind => {
    expect(fields({ ...valid, kind, newLegalEntity: null })).toEqual(['processArea'])
    expect(validateChangeInput({ ...valid, kind, newLegalEntity: null, processArea: 'Forge' })).toEqual([])
  })

  it('requires a title and a description, and checks the discipline, kind and date', () => {
    expect(fields({ ...valid, title: '', description: ' ' })).toEqual(['title', 'description'])
    expect(fields({ ...valid, discipline: 'quality' as never, kind: 'merger' as never, newLegalEntity: null }))
      .toEqual(['discipline', 'kind'])
    expect(fields({ ...valid, effectiveOn: '2026-13-01' })).toEqual(['effectiveOn'])
  })
})
