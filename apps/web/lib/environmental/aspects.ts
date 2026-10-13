import type { SupabaseClient } from '@supabase/supabase-js'
import {
  validateAspectInput,
  validateAspectScoreInput,
  type AspectFlow,
  type AspectInput,
  type AspectLifeCycleStage,
  type AspectOperatingCondition,
  type AspectScoreInput,
  type AspectStatus,
} from '@soteria/core/environmentalAspect'
import {
  DEFAULT_SCORING_METHOD,
  DEFAULT_SCORING_METHOD_NAME,
  type ScoringMethodDefinition,
} from '@soteria/core/scoringMethod'
import type { Parsed } from './contextRegisters'
import { optionalText, text, type JsonObject } from './registerApi'

// The aspects register (clause 6.1.2): request bodies turned into validated
// core inputs, and the tenant's default scoring method.

/** Body columns an aspect edit may change, and the input field each one feeds. Scores are not among them. */
export const ASPECT_EDITABLE = {
  activity:         'activity',
  aspect:           'aspect',
  impact:           'impact',
  process_area:     'processArea',
  life_cycle_stage: 'lifeCycleStage',
  flow:             'flow',
  status:           'status',
  controls:         'controls',
  notes:            'notes',
  source_reference: 'sourceReference',
} as const satisfies Record<string, keyof AspectInput>

export function aspectInputFrom(raw: JsonObject): Parsed<AspectInput> {
  const input: AspectInput = {
    activity:        text(raw.activity),
    aspect:          text(raw.aspect),
    impact:          text(raw.impact),
    processArea:     text(raw.process_area),
    lifeCycleStage:  (optionalText(raw.life_cycle_stage) ?? 'operation') as AspectLifeCycleStage,
    flow:            optionalText(raw.flow) as AspectFlow | null,
    status:          (optionalText(raw.status) ?? 'identified') as AspectStatus,
    controls:        optionalText(raw.controls),
    notes:           optionalText(raw.notes),
    sourceReference: optionalText(raw.source_reference),
  }
  const errors = validateAspectInput(input)
  return errors.length === 0 ? { ok: true, input } : { ok: false, errors }
}

/** Numbers must arrive as JSON numbers; anything else fails the validator's whole-number check. */
function wholeNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN
}

export function aspectScoreInputFrom(raw: JsonObject, method: ScoringMethodDefinition): Parsed<AspectScoreInput> {
  const input: AspectScoreInput = {
    operatingCondition: text(raw.operating_condition) as AspectOperatingCondition,
    severity:           wholeNumber(raw.severity),
    likelihood:         wholeNumber(raw.likelihood),
    rationale:          text(raw.rationale),
  }
  const errors = validateAspectScoreInput(input, method)
  return errors.length === 0 ? { ok: true, input } : { ok: false, errors }
}

export interface StoredScoringMethod {
  id:         string
  definition: ScoringMethodDefinition
}

interface ScoringMethodRow {
  id:                     string
  severity_levels:        number
  likelihood_levels:      number
  matrix:                 number[][] | null
  significance_threshold: number
}

const METHOD_COLUMNS = 'id, severity_levels, likelihood_levels, matrix, significance_threshold'

function toStoredMethod(row: ScoringMethodRow): StoredScoringMethod {
  return {
    id: row.id,
    definition: {
      severityLevels:        row.severity_levels,
      likelihoodLevels:      row.likelihood_levels,
      matrix:                row.matrix,
      significanceThreshold: row.significance_threshold,
    },
  }
}

async function readDefaultMethod(client: SupabaseClient, tenantId: string) {
  return client
    .from('ms_scoring_methods')
    .select(METHOD_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('discipline', 'ems')
    .eq('is_default', true)
    .is('retired_at', null)
    .maybeSingle()
}

/**
 * The tenant's default environmental scoring method. Migration 296 created
 * one for every tenant that already had aspects; a tenant that switches the
 * module on later gets migration 204's rule on its first score. Two first
 * scores at once both try to create it; uq_ms_scoring_methods_default lets
 * one win and the other reads the winner.
 */
export async function defaultScoringMethod(
  client: SupabaseClient,
  tenantId: string,
): Promise<{ method: StoredScoringMethod; error: null } | { method: null; error: unknown }> {
  const existing = await readDefaultMethod(client, tenantId)
  if (existing.error) return { method: null, error: existing.error }
  if (existing.data) return { method: toStoredMethod(existing.data as ScoringMethodRow), error: null }

  const created = await client
    .from('ms_scoring_methods')
    .insert({
      tenant_id:              tenantId,
      discipline:             'ems',
      name:                   DEFAULT_SCORING_METHOD_NAME,
      severity_levels:        DEFAULT_SCORING_METHOD.severityLevels,
      likelihood_levels:      DEFAULT_SCORING_METHOD.likelihoodLevels,
      matrix:                 DEFAULT_SCORING_METHOD.matrix,
      significance_threshold: DEFAULT_SCORING_METHOD.significanceThreshold,
      is_default:             true,
    })
    .select(METHOD_COLUMNS)
    .single()
  if (!created.error) return { method: toStoredMethod(created.data as ScoringMethodRow), error: null }
  if ((created.error as { code?: string }).code !== '23505') return { method: null, error: created.error }

  const winner = await readDefaultMethod(client, tenantId)
  if (winner.error || !winner.data) return { method: null, error: winner.error ?? created.error }
  return { method: toStoredMethod(winner.data as ScoringMethodRow), error: null }
}
