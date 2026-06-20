import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { OperatorToolDef, StageResult } from './types'

// Operator Console REGULATED tools (Slice 5).
//
// A regulated tool never executes inline. Its `stage` validates the input and
// builds the one-line summary for the approval card; runOperatorTool records the
// result in agent_action_queue for a qualified human to apply. The matching
// apply / rollback logic lives in ./carveOutAppliers, keyed by the carve-out
// action — so staging (what the agent proposes) and applying (what the human
// authorizes) stay cleanly separated.
//
// Slice 5 wires one carve-out end-to-end: authorize_hot_work_permit.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function stageFail(error: string): StageResult {
  return { ok: false, error }
}

/** Trim a free-text field for inclusion in the one-line approval summary. */
function clip(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// authorize_hot_work_permit → permit_hot_work_auth (OSHA 1910.252 / NFPA 51B).
export const authorizeHotWorkPermit: OperatorToolDef = {
  agent: 'permits',
  minRole: 'member',
  scope: { kind: 'regulated', action: 'permit_hot_work_auth' },
  definition: {
    name: 'authorize_hot_work_permit',
    description:
      'Authorize (sign off) a hot-work permit so the work may begin. This is a regulated, life-safety action: ' +
      'you do NOT apply it — it is staged for a qualified human (a tenant admin or owner) to approve with one tap, ' +
      'who then becomes the Permit Authorizing Individual of record. Provide the permit id; the permit must be ' +
      'active (not canceled) and not already authorized.',
    input_schema: {
      type: 'object',
      properties: {
        permit_id: { type: 'string', description: 'The hot-work permit id (uuid) to authorize.' },
      },
      required: ['permit_id'],
    },
  },
  async stage(input, ctx) {
    const permit_id = typeof (input as { permit_id?: unknown })?.permit_id === 'string'
      ? (input as { permit_id: string }).permit_id.trim()
      : ''
    if (!UUID_RE.test(permit_id)) return stageFail('permit_id is required and must be a valid permit id.')

    const { data: permit, error } = await supabaseAdmin()
      .from('loto_hot_work_permits')
      .select('serial, work_description, work_location, pai_signature_at, canceled_at')
      .eq('id', permit_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (error) return stageFail(error.message)
    if (!permit) return stageFail('No hot-work permit with that id exists in this tenant.')
    if (permit.canceled_at) return stageFail(`Permit ${permit.serial} is canceled and cannot be authorized.`)
    if (permit.pai_signature_at) return stageFail(`Permit ${permit.serial} is already authorized.`)

    const summary =
      `Authorize hot-work permit ${permit.serial} — ${clip(permit.work_description, 120)} at ${clip(permit.work_location, 80)}`
    return { ok: true, payload: { permit_id }, summary }
  },
}

// authorize_confined_space_entry → permit_confined_space_auth (OSHA 1910.146).
export const authorizeConfinedSpaceEntry: OperatorToolDef = {
  agent: 'permits',
  minRole: 'member',
  scope: { kind: 'regulated', action: 'permit_confined_space_auth' },
  definition: {
    name: 'authorize_confined_space_entry',
    description:
      'Authorize (sign off as entry supervisor) a permit-required confined-space entry so entrants may go in. This ' +
      'is a regulated, life-safety action: you do NOT apply it — it is staged for a qualified human (a tenant admin ' +
      'or owner) to approve with one tap, who then becomes the entry supervisor of record. Provide the permit id; ' +
      'the permit must be active (not canceled) and not already authorized.',
    input_schema: {
      type: 'object',
      properties: {
        permit_id: { type: 'string', description: 'The confined-space permit id (uuid) to authorize.' },
      },
      required: ['permit_id'],
    },
  },
  async stage(input, ctx) {
    const permit_id = typeof (input as { permit_id?: unknown })?.permit_id === 'string'
      ? (input as { permit_id: string }).permit_id.trim()
      : ''
    if (!UUID_RE.test(permit_id)) return stageFail('permit_id is required and must be a valid permit id.')

    const { data: permit, error } = await supabaseAdmin()
      .from('loto_confined_space_permits')
      .select('serial, purpose, space_id, entry_supervisor_signature_at, canceled_at')
      .eq('id', permit_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (error) return stageFail(error.message)
    if (!permit) return stageFail('No confined-space permit with that id exists in this tenant.')
    if (permit.canceled_at) return stageFail(`Permit ${permit.serial} is canceled and cannot be authorized.`)
    if (permit.entry_supervisor_signature_at) return stageFail(`Permit ${permit.serial} is already authorized.`)

    const summary =
      `Authorize confined-space entry permit ${permit.serial} — ${clip(permit.purpose, 120)} (space ${clip(permit.space_id, 40)})`
    return { ok: true, payload: { permit_id }, summary }
  },
}
