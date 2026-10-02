// Management of change (MOC): a change to the site, its chemicals, its
// processes or its owner, and the records it touches. Opening a change works
// out its impacts once (the plan's mocFanOut); each impact is a to-do that
// someone resolves, and the change closes when every one is resolved.
//
// Shared management-system core (ISO 14001 8.1 and 6.1.4 now; ISO 45001
// 8.1.3 later). The database enforces the same resolution rules in
// migration 305; impactResolutionGaps() lets a screen explain a refusal
// before the round trip.

import type { FieldError } from './hazardousWaste'
import { DISCIPLINES, isCalendarDate, sameLegalEntity, type Discipline } from './managementSystem'
import { NotImplementedError } from './ohsPlaceholder'

export const CHANGE_KINDS = ['equipment', 'chemical', 'process', 'ownership_name', 'personnel', 'other'] as const
export type ChangeKind = typeof CHANGE_KINDS[number]

export const CHANGE_KIND_LABELS: Readonly<Record<ChangeKind, string>> = {
  equipment:      'New or changed equipment',
  chemical:       'New or changed chemical',
  process:        'Process change',
  ownership_name: 'Change of owner or legal name',
  personnel:      'Personnel change',
  other:          'Other change',
}

/** Kinds that happen somewhere on site, so they name the process area they touch. */
const SITE_KINDS: readonly ChangeKind[] = ['equipment', 'process']

/**
 * What an impact can point at. `asset`, `hazard` and `control` are seams for
 * Phase 4 and ISO 45001: nothing creates them yet.
 */
export const IMPACT_TARGET_TYPES = [
  'permit', 'scope', 'policy', 'aspect', 'obligation', 'objective', 'asset', 'hazard', 'control',
] as const
export type ImpactTargetType = typeof IMPACT_TARGET_TYPES[number]

/** The three steps of moving one permit to a new holder. */
export const TRANSFER_STEPS = ['notify_agency', 'submit_transfer', 'confirm_holder'] as const
export type TransferStep = typeof TRANSFER_STEPS[number]

export const TRANSFER_STEP_LABELS: Readonly<Record<TransferStep, string>> = {
  notify_agency:   'Notify the agency',
  submit_transfer: 'Submit the transfer or update',
  confirm_holder:  'Confirm the holder of record is updated',
}

/** An impact row before it is stored. */
export interface ImpactDraft {
  targetType:     ImpactTargetType
  targetId:       string
  /** Set only for a permit's transfer steps. */
  step:           TransferStep | null
  /** Order within the target: 1 to 3 for transfer steps, 0 otherwise. */
  stepOrder:      number
  actionRequired: string
}

// ── Fan-out ──────────────────────────────────────────────────────────────

export interface FanOutPermit {
  id:         string
  title:      string
  agency:     string
  facilityId: string
  retiredAt:  string | null
}

export interface FanOutAspect {
  id:          string
  aspect:      string
  processArea: string | null
  facilityId:  string | null
  obsoleteAt:  string | null
}

export interface FanOutObligation {
  id:         string
  title:      string
  category:   string | null
  /** 'open', 'completed' or 'dismissed'. */
  status:     string
  facilityId: string | null
}

/** The records a change could touch, read when it opens. */
export interface FanOutContext {
  permits:     readonly FanOutPermit[]
  /** The scope in force, or null when none is recorded. */
  scope:       { id: string } | null
  /** The policy in force, or null when none is recorded. */
  policy:      { id: string } | null
  aspects:     readonly FanOutAspect[]
  obligations: readonly FanOutObligation[]
}

export interface ChangeForFanOut {
  discipline:     Discipline
  kind:           ChangeKind
  /** The site the change happens at; null when it covers the whole organization. */
  facilityId:     string | null
  processArea:    string | null
  newLegalEntity: string | null
}

/** Obligation categories a chemical change can affect: what the site emits, and what it throws away. */
const CHEMICAL_OBLIGATION_CATEGORIES = ['air', 'waste'] as const

/**
 * One three-step transfer checklist per permit, in the order given, steps in
 * order. The holder-of-record step names the new legal entity, because it
 * cannot be resolved until the permit shows it.
 */
export function ownershipChangeChecklist(
  permits: readonly Pick<FanOutPermit, 'id' | 'title' | 'agency'>[],
  newLegalEntity: string,
): ImpactDraft[] {
  return permits.flatMap(permit => [
    {
      targetType: 'permit', targetId: permit.id, step: 'notify_agency', stepOrder: 1,
      actionRequired: `Notify ${permit.agency} that the holder of "${permit.title}" is changing to ${newLegalEntity}.`,
    },
    {
      targetType: 'permit', targetId: permit.id, step: 'submit_transfer', stepOrder: 2,
      actionRequired: `Submit the transfer or update of "${permit.title}" to ${permit.agency}.`,
    },
    {
      targetType: 'permit', targetId: permit.id, step: 'confirm_holder', stepOrder: 3,
      actionRequired: `Confirm ${permit.agency} shows ${newLegalEntity} as the holder of "${permit.title}", and record it on the permit.`,
    },
  ] satisfies ImpactDraft[])
}

function sameArea(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The records a change touches, worked out once when it opens (the EMS plan's
 * mocFanOut; Phase 2 plan D13). A record added later is not included: the
 * change is a snapshot of what it affected when it was raised.
 *
 * - Ownership or name: every active permit at the change's site (every site
 *   when the change covers the whole organization), as a transfer checklist;
 *   the scope in force; the policy in force (Lesson L3).
 * - Equipment and process: every active aspect in the named process area.
 * - Chemical: those aspects, and the open air and waste obligations.
 * - Personnel and other: nothing automatic.
 *
 * Phase 3 adds suggested actions and the in-place rescore for aspects.
 * @throws NotImplementedError for discipline `ohs`: hazards arrive in Phase 8.
 */
export function changeImpacts(change: ChangeForFanOut, context: FanOutContext): ImpactDraft[] {
  if (change.discipline === 'ohs') throw new NotImplementedError('MOC fan-out for discipline ohs')

  const atSite = (facilityId: string | null) =>
    change.facilityId === null || facilityId === null || facilityId === change.facilityId

  const aspectImpacts = (): ImpactDraft[] => context.aspects
    .filter(aspect => aspect.obsoleteAt === null && atSite(aspect.facilityId)
      && sameArea(aspect.processArea, change.processArea))
    .map(aspect => ({
      targetType: 'aspect', targetId: aspect.id, step: null, stepOrder: 0,
      actionRequired: `Review "${aspect.aspect}" in ${aspect.processArea}, and rescore it if the change affects it.`,
    }))

  switch (change.kind) {
    case 'ownership_name': {
      const newEntity = change.newLegalEntity ?? ''
      const permits = context.permits.filter(permit => permit.retiredAt === null && atSite(permit.facilityId))
      const impacts = ownershipChangeChecklist(permits, newEntity)
      if (context.scope) {
        impacts.push({
          targetType: 'scope', targetId: context.scope.id, step: null, stepOrder: 0,
          actionRequired: `Issue a new scope version naming ${newEntity} as the legal entity.`,
        })
      }
      if (context.policy) {
        impacts.push({
          targetType: 'policy', targetId: context.policy.id, step: null, stepOrder: 0,
          actionRequired: `Have the environmental policy signed again for ${newEntity}, once the scope names it.`,
        })
      }
      return impacts
    }
    case 'equipment':
    case 'process':
      return aspectImpacts()
    case 'chemical': {
      const obligations: ImpactDraft[] = context.obligations
        .filter(obligation => obligation.status === 'open' && atSite(obligation.facilityId)
          && CHEMICAL_OBLIGATION_CATEGORIES.some(category => category === obligation.category?.trim().toLowerCase()))
        .map(obligation => ({
          targetType: 'obligation', targetId: obligation.id, step: null, stepOrder: 0,
          actionRequired: `Review whether, and how, "${obligation.title}" applies after this change.`,
        }))
      return [...aspectImpacts(), ...obligations]
    }
    case 'personnel':
    case 'other':
      return []
  }
}

// ── Closing ──────────────────────────────────────────────────────────────

/** What still blocks closing a change. Empty means it can close. */
export function changeCloseGaps(impacts: readonly { resolvedAt: string | null }[]): string[] {
  const unresolved = impacts.filter(impact => impact.resolvedAt === null).length
  if (unresolved === 0) return []
  return [`${unresolved} ${unresolved === 1 ? 'impact is' : 'impacts are'} not resolved yet.`]
}

// ── Resolving an impact (D14) ────────────────────────────────────────────

export type ResolutionGap =
  | 'change_not_open'
  | 'already_resolved'
  | 'evidence_required'
  | 'holder_not_updated'
  | 'scope_not_updated'
  | 'policy_not_signed_again'
  | 'note_required'

export const RESOLUTION_GAP_MESSAGES: Readonly<Record<ResolutionGap, string>> = {
  change_not_open:         'This change is closed or cancelled, so its impacts can no longer be resolved.',
  already_resolved:        'This impact is already resolved.',
  evidence_required:       'Attach evidence for this step first.',
  holder_not_updated:      'The permit still names another holder. Update its holder of record to the new legal entity first.',
  scope_not_updated:       'The scope in force does not name the new legal entity yet. Issue a new scope version first.',
  policy_not_signed_again: 'The policy in force was signed before the scope named the new legal entity. Have it signed again first.',
  note_required:           'Say what was done.',
}

export interface ImpactForResolution {
  targetType: ImpactTargetType
  step:       TransferStep | null
  resolvedAt: string | null
}

export interface ResolutionContext {
  changeOpen:     boolean
  newLegalEntity: string | null
  /** Current (not superseded) evidence filed against the impact. */
  evidenceCount:  number
  note:           string | null
  /** The permit's holder of record now; needed for the confirm-holder step. */
  permitHolder:   string | null
  /** The scope in force; needed for scope and policy impacts. */
  scopeInForce:   { legalEntity: string; effectiveFrom: string } | null
  /** When the policy in force was signed; needed for the policy impact. */
  policySignedAt: string | null
}

/** What blocks resolving an impact, in the order a person would fix it. Empty means it can be resolved. */
export function impactResolutionGaps(impact: ImpactForResolution, context: ResolutionContext): ResolutionGap[] {
  if (!context.changeOpen) return ['change_not_open']
  if (impact.resolvedAt !== null) return ['already_resolved']

  const scopeNamesNewEntity = context.scopeInForce !== null && context.newLegalEntity !== null
    && sameLegalEntity(context.scopeInForce.legalEntity, context.newLegalEntity)

  if (impact.step !== null) {
    const gaps: ResolutionGap[] = []
    if (context.evidenceCount === 0) gaps.push('evidence_required')
    if (impact.step === 'confirm_holder') {
      const updated = context.permitHolder !== null && context.newLegalEntity !== null
        && sameLegalEntity(context.permitHolder, context.newLegalEntity)
      if (!updated) gaps.push('holder_not_updated')
    }
    return gaps
  }

  switch (impact.targetType) {
    case 'scope':
      return scopeNamesNewEntity ? [] : ['scope_not_updated']
    case 'policy':
      if (!scopeNamesNewEntity) return ['scope_not_updated']
      return context.policySignedAt !== null && context.policySignedAt >= context.scopeInForce!.effectiveFrom
        ? []
        : ['policy_not_signed_again']
    default:
      return (context.note ?? '').trim().length > 0 ? [] : ['note_required']
  }
}

// ── Input ────────────────────────────────────────────────────────────────

export interface ChangeInput {
  discipline:     Discipline
  kind:           ChangeKind
  title:          string
  description:    string
  processArea:    string | null
  newLegalEntity: string | null
  effectiveOn:    string | null
}

/** Validate a change before it opens. Empty means acceptable. Mirrors migration 305's checks. */
export function validateChangeInput(input: ChangeInput): FieldError[] {
  const errors: FieldError[] = []
  if (!DISCIPLINES.includes(input.discipline)) {
    errors.push({ field: 'discipline', message: 'must be ems, ohs, or integrated' })
  }
  if (!CHANGE_KINDS.includes(input.kind)) {
    errors.push({ field: 'kind', message: `must be one of ${CHANGE_KINDS.join(', ')}` })
  }
  if (input.title.trim().length === 0) errors.push({ field: 'title', message: 'is required' })
  else if (input.title.length > 200) errors.push({ field: 'title', message: 'must be at most 200 characters' })
  if (input.description.trim().length === 0) errors.push({ field: 'description', message: 'is required' })
  else if (input.description.length > 4000) errors.push({ field: 'description', message: 'must be at most 4000 characters' })

  const area = input.processArea?.trim() ?? ''
  if (SITE_KINDS.includes(input.kind) && area.length === 0) {
    errors.push({ field: 'processArea', message: 'is required for an equipment or process change' })
  } else if (input.processArea !== null && input.processArea.length > 100) {
    errors.push({ field: 'processArea', message: 'must be at most 100 characters' })
  }

  const entity = input.newLegalEntity?.trim() ?? ''
  if (input.kind === 'ownership_name') {
    if (entity.length === 0) errors.push({ field: 'newLegalEntity', message: 'is required for a change of owner or legal name' })
    else if (input.newLegalEntity!.length > 300) errors.push({ field: 'newLegalEntity', message: 'must be at most 300 characters' })
  } else if (input.newLegalEntity !== null) {
    errors.push({ field: 'newLegalEntity', message: 'applies only to a change of owner or legal name' })
  }

  if (input.effectiveOn !== null && !isCalendarDate(input.effectiveOn)) {
    errors.push({ field: 'effectiveOn', message: 'must be a date (YYYY-MM-DD)' })
  }
  return errors
}
