import type { SupabaseClient } from '@supabase/supabase-js'
import type { FieldError } from '@soteria/core/hazardousWaste'
import {
  validateChangeInput,
  type ChangeInput,
  type ChangeKind,
  type ImpactDraft,
  type ImpactTargetType,
} from '@soteria/core/managementOfChange'
import type { Discipline } from '@soteria/core/managementSystem'
import type { Parsed } from './contextRegisters'
import { emsDisciplineErrors, optionalText, text, type JsonObject } from './registerApi'

// Management of change (Phase 2 plan D12-D14): request bodies, the columns the
// routes read, and the readable labels for what an impact points at. The rules
// themselves live in packages/core/src/managementOfChange.ts.

/** Every ms_changes column a client reads. */
export const CHANGE_COLUMNS =
  'id, tenant_id, facility_id, discipline, kind, title, description, process_area, new_legal_entity, effective_on, '
  + 'status, requested_by, opened_at, ended_at, ended_by, cancelled_reason, created_at, updated_at'

/** Every ms_change_impacts column a client reads. */
export const IMPACT_COLUMNS =
  'id, change_id, target_type, target_id, step, step_order, action_required, resolved_at, resolved_by, resolution_note, created_at'

/** Body columns an edit of an open change may change: what it says, not what its impacts were worked out from. */
export const CHANGE_EDITABLE = {
  title:       'title',
  description: 'description',
  effective_on: 'effectiveOn',
} as const satisfies Record<string, keyof ChangeInput>

export function changeInputFrom(raw: JsonObject): Parsed<ChangeInput> {
  const input: ChangeInput = {
    discipline:     (optionalText(raw.discipline) ?? 'ems') as Discipline,
    kind:           text(raw.kind) as ChangeKind,
    title:          text(raw.title),
    description:    text(raw.description),
    processArea:    optionalText(raw.process_area),
    newLegalEntity: optionalText(raw.new_legal_entity),
    effectiveOn:    optionalText(raw.effective_on),
  }
  const errors: FieldError[] = [...validateChangeInput(input), ...emsDisciplineErrors(input.discipline)]
  return errors.length === 0 ? { ok: true, input } : { ok: false, errors }
}

/** The impact rows ms_open_change() takes, in the column names it reads. */
export function impactRows(impacts: readonly ImpactDraft[]) {
  return impacts.map(impact => ({
    target_type:     impact.targetType,
    target_id:       impact.targetId,
    step:            impact.step,
    step_order:      impact.stepOrder,
    action_required: impact.actionRequired,
  }))
}

// ── What an impact points at ─────────────────────────────────────────────

export interface ImpactTarget {
  /** A sentence-sized name for the record, for the checklist. */
  label:        string
  /** Where the record is managed; null when no screen shows it. */
  href:         string | null
  /** A permit's holder of record now, for the confirm-holder rule. */
  holder?:      string
  /** True for a permit that has been retired. */
  retired?:     boolean
}

type Targets = Map<string, ImpactTarget>

/** The key an impact's target is stored under in the map loadImpactTargets returns. */
export const targetKey = (type: ImpactTargetType, id: string) => `${type}:${id}`

const SCREENS: Partial<Record<ImpactTargetType, string>> = {
  scope:      '/environmental/context?tab=policy',
  policy:     '/environmental/context?tab=policy',
  aspect:     '/environmental/aspects',
  obligation: '/environmental/obligations',
  objective:  '/environmental/objectives',
}

/**
 * Readable labels for the records a change's impacts point at, read through the
 * caller's client so row-level security decides what they may see. A target
 * that is gone (a retired record someone removed) falls back to its type.
 */
export async function loadImpactTargets(
  client: SupabaseClient,
  tenantId: string,
  impacts: readonly { target_type: ImpactTargetType; target_id: string }[],
): Promise<{ targets: Targets; error: unknown }> {
  const targets: Targets = new Map()
  const idsOf = (type: ImpactTargetType) => [...new Set(impacts.filter(i => i.target_type === type).map(i => i.target_id))]
  const read = (table: string, columns: string, ids: string[]) =>
    ids.length === 0
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : client.from(table).select(columns).eq('tenant_id', tenantId).in('id', ids)

  const [permits, scopes, policies, aspects, obligations] = await Promise.all([
    read('environmental_permits', 'id, title, agency, holder_of_record, retired_at', idsOf('permit')),
    read('ms_scope_statements', 'id, version, legal_entity', idsOf('scope')),
    read('ms_policies', 'id, version, signed_at', idsOf('policy')),
    read('environmental_aspects', 'id, aspect, process_area', idsOf('aspect')),
    read('compliance_calendar_obligations', 'id, title', idsOf('obligation')),
  ])
  const error = permits.error ?? scopes.error ?? policies.error ?? aspects.error ?? obligations.error
  if (error) return { targets, error }

  for (const row of (permits.data ?? []) as unknown as { id: string; title: string; agency: string; holder_of_record: string; retired_at: string | null }[]) {
    targets.set(targetKey('permit', row.id), {
      label: `${row.title} (${row.agency})`, href: `/environmental/permits/${row.id}`, holder: row.holder_of_record,
      retired: row.retired_at !== null,
    })
  }
  for (const row of (scopes.data ?? []) as unknown as { id: string; version: number; legal_entity: string }[]) {
    targets.set(targetKey('scope', row.id), { label: `Scope, version ${row.version} (${row.legal_entity})`, href: SCREENS.scope! })
  }
  for (const row of (policies.data ?? []) as unknown as { id: string; version: number; signed_at: string }[]) {
    targets.set(targetKey('policy', row.id), { label: `Environmental policy, version ${row.version} (signed ${row.signed_at})`, href: SCREENS.policy! })
  }
  for (const row of (aspects.data ?? []) as unknown as { id: string; aspect: string; process_area: string | null }[]) {
    targets.set(targetKey('aspect', row.id), {
      label: row.process_area ? `${row.aspect} (${row.process_area})` : row.aspect, href: SCREENS.aspect!,
    })
  }
  for (const row of (obligations.data ?? []) as unknown as { id: string; title: string }[]) {
    targets.set(targetKey('obligation', row.id), { label: row.title, href: SCREENS.obligation! })
  }
  return { targets, error: null }
}

/** The target for an impact, or a stand-in naming its type when the record can no longer be read. */
export function targetOf(targets: Targets, type: ImpactTargetType, id: string): ImpactTarget {
  return targets.get(targetKey(type, id)) ?? { label: `A ${type} record`, href: SCREENS[type] ?? null }
}
