import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateCreateInput as validateNearMissCreate,
  NEAR_MISS_HAZARD_CATEGORIES,
  NEAR_MISS_SEVERITY_BANDS,
  type NearMissHazardCategory,
  type NearMissSeverity,
} from '@soteria/core/nearMiss'
import {
  validateBBSCreateInput,
  BBS_KINDS,
  BBS_SEVERITY,
  BBS_LIKELIHOOD,
  type BBSKind,
  type BBSSeverity,
  type BBSLikelihood,
} from '@soteria/core/bbs'
import type { OperatorToolDef } from './types'

// Operator Console WRITE tools (Slice 3).
//
// Ordinary, reversible mutations a sub-agent performs hands-free — there is NO
// human-approval gate (that is reserved for the `regulated` carve-outs, which
// runOperatorTool refuses inline). The discipline that makes a hands-free write
// safe: each handler reuses the SAME `@soteria/core` validator the REST route
// uses, then inserts via supabaseAdmin scoped to `ctx.tenantId` with the actor
// derived from `ctx.userId`. So an agent write can never diverge from app
// invariants, accept an out-of-enum value, or leak across tenants.
//
// Return shape matches the read tools: { ok:true, data } | { ok:false, error }.

function ok<T>(data: T): string { return JSON.stringify({ ok: true, data }) }
function fail(message: string): string { return JSON.stringify({ ok: false, error: message }) }

/** Trimmed non-empty string, else null — the shape nullable text columns want. */
function nullableText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// ── file_near_miss (incidents agent) ───────────────────────────────────────
export const fileNearMiss: OperatorToolDef = {
  agent: 'incidents',
  minRole: 'member',
  scope: { kind: 'write' },
  definition: {
    name: 'file_near_miss',
    description:
      'File a near-miss report — an unplanned event that could have caused harm but did not. ' +
      'Takes effect immediately and enters triage at status "new". Use the reporter\'s own words for the description.',
    input_schema: {
      type: 'object',
      properties: {
        occurred_at:            { type: 'string', description: 'When it happened, ISO 8601 (e.g. 2026-06-17T14:30:00Z). Cannot be in the future.' },
        description:            { type: 'string', description: 'What happened and what could have gone wrong.' },
        hazard_category:        { type: 'string', enum: [...NEAR_MISS_HAZARD_CATEGORIES], description: 'Primary hazard category.' },
        severity_potential:     { type: 'string', enum: [...NEAR_MISS_SEVERITY_BANDS], description: 'How bad it could realistically have been.' },
        location:               { type: 'string', description: 'Optional area/location where it occurred.' },
        immediate_action_taken: { type: 'string', description: 'Optional action already taken at the scene.' },
      },
      required: ['occurred_at', 'description', 'hazard_category', 'severity_potential'],
    },
  },
  async handler(input, ctx) {
    const i = (input ?? {}) as Record<string, unknown>
    const occurred_at        = typeof i.occurred_at === 'string' ? i.occurred_at : undefined
    const description        = typeof i.description === 'string' ? i.description.trim() : undefined
    const hazard_category    = typeof i.hazard_category === 'string' ? (i.hazard_category as NearMissHazardCategory) : undefined
    const severity_potential = typeof i.severity_potential === 'string' ? (i.severity_potential as NearMissSeverity) : undefined

    const validationError = validateNearMissCreate({ occurred_at, description, hazard_category, severity_potential })
    if (validationError) return fail(validationError)
    // validateNearMissCreate guarantees the four required fields are present and
    // in-enum; this re-assertion narrows their types for the insert below.
    if (!occurred_at || !description || !hazard_category || !severity_potential) {
      return fail('occurred_at, description, hazard_category and severity_potential are required.')
    }

    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('near_misses')
      .insert({
        tenant_id:              ctx.tenantId,
        reported_by:            ctx.userId,
        occurred_at,
        description,
        hazard_category,
        severity_potential,
        location:               nullableText(i.location),
        immediate_action_taken: nullableText(i.immediate_action_taken),
      })
      .select('id, report_number, status')
      .single()
    if (error || !data) return fail(error?.message ?? 'near-miss insert failed')
    return ok({ id: data.id, report_number: data.report_number, status: data.status, note: 'Near-miss filed; it has entered triage.' })
  },
}

// ── submit_bbs_observation (bbs agent) ──────────────────────────────────────
export const submitBbsObservation: OperatorToolDef = {
  agent: 'bbs',
  minRole: 'member',
  scope: { kind: 'write' },
  definition: {
    name: 'submit_bbs_observation',
    description:
      'Submit a Behavior-Based Safety observation. Takes effect immediately at status "open". ' +
      'For unsafe observations (unsafe_act / unsafe_condition), severity and likelihood are required; ' +
      'for safe_behavior they are omitted.',
    input_schema: {
      type: 'object',
      properties: {
        kind:                   { type: 'string', enum: [...BBS_KINDS], description: 'The observation kind.' },
        description:            { type: 'string', description: 'What was observed (at least 5 characters).' },
        severity:               { type: 'string', enum: [...BBS_SEVERITY], description: 'Required for unsafe observations.' },
        likelihood:             { type: 'string', enum: [...BBS_LIKELIHOOD], description: 'Required for unsafe observations.' },
        category:               { type: 'string', description: 'Optional behavior/condition category.' },
        location_text:          { type: 'string', description: 'Optional location/area.' },
        department:             { type: 'string', description: 'Optional department.' },
        immediate_action_taken: { type: 'string', description: 'Optional immediate action taken.' },
      },
      required: ['kind', 'description'],
    },
  },
  async handler(input, ctx) {
    const i = (input ?? {}) as Record<string, unknown>
    const kind = typeof i.kind === 'string' && (BBS_KINDS as readonly string[]).includes(i.kind)
      ? (i.kind as BBSKind) : null
    const severity = typeof i.severity === 'string' && (BBS_SEVERITY as readonly string[]).includes(i.severity)
      ? (i.severity as BBSSeverity) : null
    const likelihood = typeof i.likelihood === 'string' && (BBS_LIKELIHOOD as readonly string[]).includes(i.likelihood)
      ? (i.likelihood as BBSLikelihood) : null
    if (!kind) return fail(`kind is required and must be one of: ${BBS_KINDS.join(', ')}`)

    const description = typeof i.description === 'string' ? i.description.trim() : ''
    const errors = validateBBSCreateInput({ kind, description, severity, likelihood })
    if (errors.length > 0) return fail(errors.map(e => `${e.field}: ${e.message}`).join('; '))

    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('bbs_observations')
      .insert({
        tenant_id:              ctx.tenantId,
        submitted_by:           ctx.userId,
        submitted_name:         null,
        observed_at:            typeof i.observed_at === 'string' ? i.observed_at : new Date().toISOString(),
        kind,
        description,
        severity,
        likelihood,
        category:               nullableText(i.category),
        location_text:          nullableText(i.location_text),
        department:             nullableText(i.department),
        immediate_action_taken: nullableText(i.immediate_action_taken),
        status:                 'open' as const,
      })
      .select('id, report_number, status')
      .single()
    if (error || !data) return fail(error?.message ?? 'bbs observation insert failed')
    return ok({ id: data.id, report_number: data.report_number, status: data.status, note: 'Observation submitted.' })
  },
}
