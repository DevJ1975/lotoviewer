import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { OperatorToolDef, StageResult } from '../types'
import type { CarveOutApplier } from '../carveOutAppliers'

// capa_high_severity_close — verify-effective + close a HIGH-severity CAPA.
//
// A self-contained regulated carve-out: the `incidents` sub-agent STAGES a
// proposal to verify-close a completed corrective/preventive action whose parent
// incident landed in the serious-severity tier; a tenant admin (or higher) then
// approves with one tap and becomes the verifier of record.
//
// This mirrors the verify/close half of the PATCH route
// (app/api/incidents/[id]/actions/[actionId]/route.ts): a 'complete' action moves
// to 'verified', and reopening clears the verification stamps while keeping the
// evidence. We re-implement only what staging/applying needs and reuse the route's
// exact ISO 45001 §10.2 separation-of-duty rule.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// "High severity" = the serious-outcome tier of the incidents.severity_actual
// enum (migration 059: none/first_aid/medical/lost_time/fatality/catastrophic).
// We draw the line at lost_time and above: a recordable lost-time injury or worse
// is the threshold that makes closing a CAPA a regulated, admin-gated decision.
// first_aid/medical/none are routine and close through the ordinary route.
const HIGH_SEVERITY = new Set(['lost_time', 'fatality', 'catastrophic'])

function stageFail(error: string): StageResult {
  return { ok: false, error }
}

/** Trim a free-text field for inclusion in the one-line approval summary. */
function clip(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function requireActionId(payload: Record<string, unknown>): string {
  const id = typeof payload.action_id === 'string' ? payload.action_id : ''
  if (!UUID_RE.test(id)) throw new Error('payload is missing a valid action_id.')
  return id
}

// close_high_severity_capa → capa_high_severity_close (ISO 45001 §10.2).
export const closeHighSeverityCapa: OperatorToolDef = {
  agent: 'incidents',
  minRole: 'member',
  scope: { kind: 'regulated', action: 'capa_high_severity_close' },
  definition: {
    name: 'close_high_severity_capa',
    description:
      'Verify-effective and close a HIGH-severity corrective/preventive action (CAPA). This is a regulated ' +
      'closure: you do NOT apply it — it is staged for a qualified human (a tenant admin or owner) to approve ' +
      'with one tap, who becomes the verifier of record. The action must be in the "complete" state and its ' +
      'parent incident must be high-severity (lost_time, fatality, or catastrophic). Provide the action id.',
    input_schema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'The incident corrective/preventive action id (uuid) to verify-close.' },
      },
      required: ['action_id'],
    },
  },
  async stage(input, ctx) {
    const action_id = typeof (input as { action_id?: unknown })?.action_id === 'string'
      ? (input as { action_id: string }).action_id.trim()
      : ''
    if (!UUID_RE.test(action_id)) return stageFail('action_id is required and must be a valid action id.')

    // Join to the parent incident so one tenant-scoped read gives us both the
    // closure state and the severity gate. PostgREST embeds the parent under the
    // FK relationship name (incident_id → incidents).
    const { data: action, error } = await supabaseAdmin()
      .from('incident_actions')
      .select('id, description, status, incidents:incident_id ( report_number, severity_actual )')
      .eq('id', action_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (error) return stageFail(error.message)
    if (!action) return stageFail('No corrective/preventive action with that id exists in this tenant.')
    if (action.status !== 'complete')
      return stageFail(`This action is '${action.status}'; only a completed action can be verified and closed.`)

    // A to-one parent embed is a single object at runtime; supabase-js types it
    // as an array, so assert through unknown.
    const incident = (action.incidents ?? null) as unknown as { report_number: string | null; severity_actual: string } | null
    if (!incident) return stageFail('The parent incident could not be loaded for this action.')
    if (!HIGH_SEVERITY.has(incident.severity_actual))
      return stageFail(`The parent incident is '${incident.severity_actual}' severity, not high-severity; close it through the ordinary CAPA flow.`)

    const label = clip(action.description, 120) || action_id
    const summary = `Verify & close high-severity CAPA ${label} (incident ${incident.report_number ?? '—'})`
    return { ok: true, payload: { action_id }, summary }
  },
}

export const capaHighSeverityCloseApplier: CarveOutApplier = {
  async apply(ctx, payload, approverUserId) {
    const id = requireActionId(payload)
    const admin = supabaseAdmin()

    const { data: action, error } = await admin
      .from('incident_actions')
      .select('id, description, status, completed_by, owner_user_id, verified_at, verified_by')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!action) throw new Error('Corrective/preventive action not found in this tenant.')
    if (action.status !== 'complete')
      throw new Error(`This action is '${action.status}'; only a completed action can be verified and closed.`)

    // Separation of duty (ISO 45001 §10.2): the verifier must differ from the
    // person who completed the action. We key off the recorded completer
    // (completed_by); for legacy rows that predate migration 198 we fall back to
    // the owner — the exact rule the PATCH route applies.
    const completer = (action.completed_by ?? action.owner_user_id) as string | null
    if (completer && completer === approverUserId)
      throw new Error('Separation of duty: the verifier must differ from the person who completed the action.')

    // Snapshot the exact prior state a rollback restores: a 'complete' action
    // with no verification stamps.
    const prevState = { status: 'complete', verified_at: null, verified_by: null }

    // Guarded update: the WHERE re-asserts status='complete' + tenant so a
    // concurrent verify/reopen can't be clobbered. Empty result = a lost race.
    const { data: updated, error: upErr } = await admin
      .from('incident_actions')
      .update({ status: 'verified', verified_at: new Date().toISOString(), verified_by: approverUserId })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'complete')
      .select('id, description')
    if (upErr) throw new Error(upErr.message)
    if (!updated || updated.length === 0)
      throw new Error('The action changed before it could be verified-closed (it was verified or reopened). Re-check and re-stage.')

    const label = clip(updated[0].description, 120) || id
    return {
      summary: `Verified and closed high-severity CAPA ${label}.`,
      prevState,
    }
  },

  async rollback(ctx, payload) {
    const id = requireActionId(payload)
    const admin = supabaseAdmin()

    // Reopen to 'complete': clear the verification stamps but keep
    // verification_evidence, matching the route's reopen behaviour. Guard on
    // currently-verified + tenant so we never double-undo or touch another row.
    const { data: updated, error } = await admin
      .from('incident_actions')
      .update({ status: 'complete', verified_at: null, verified_by: null })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'verified')
      .select('id, description')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0)
      throw new Error('The action is no longer in a verified state; nothing to roll back.')

    const label = clip(updated[0].description, 120) || id
    return { summary: `Reopened CAPA ${label} to 'complete' — the verification was undone.` }
  },
}
