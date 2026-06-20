import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { CarveOutAction } from '@soteria/core/operatorActions'

// The apply / rollback executors for regulated carve-outs.
//
// The engine (./actionQueue) calls these ONLY after a qualified human has
// approved a staged action and its authorizing role has been re-proved. Each
// applier owns the real domain mutation and its exact inverse: `apply` returns
// the prior state a `rollback` restores, so the queue can reverse a reversible
// action without re-deriving anything.
//
// Slice 5 wires exactly one carve-out end-to-end — permit_hot_work_auth. The
// rest are intentionally absent: their operator tools don't exist yet, so the
// engine refuses to apply an action with no registered applier (a loud, honest
// gap rather than a silent stub).

export interface ApplyContext {
  tenantId: string
  userId: string
}

export interface CarveOutApplier {
  /** Perform the regulated mutation as `approverUserId` (the human of record).
   *  Returns a human summary + the exact prior state a rollback restores. Throws
   *  with an actionable message if the target is no longer in an applicable state. */
  apply(
    ctx: ApplyContext,
    payload: Record<string, unknown>,
    approverUserId: string,
  ): Promise<{ summary: string; prevState: Record<string, unknown> }>
  /** Reverse a previously-applied action using the snapshot `apply` returned. */
  rollback(
    ctx: ApplyContext,
    payload: Record<string, unknown>,
    prevState: Record<string, unknown>,
  ): Promise<{ summary: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requirePermitId(payload: Record<string, unknown>): string {
  const id = typeof payload.permit_id === 'string' ? payload.permit_id : ''
  if (!UUID_RE.test(id)) throw new Error('payload is missing a valid permit_id.')
  return id
}

// permit_hot_work_auth — OSHA 1910.252 / NFPA 51B. "Authorize" a hot-work permit
// by signing it: the approver becomes the Permit Authorizing Individual (PAI) of
// record and pai_signature_at is stamped. We snapshot the prior pai_id so a
// rollback restores the exact prior (unsigned) state.
//
// Side-effect note: signing fires the migration 020 `hot_work.signed` webhook
// (fire-and-forget). A rollback un-signs the permit but does NOT retract an
// already-dispatched webhook — there is no retraction channel. That is
// acceptable: consumers treat the signal as advisory, and the permit's own
// state, read back live, is the source of truth.
const hotWorkAuth: CarveOutApplier = {
  async apply(ctx, payload, approverUserId) {
    const id = requirePermitId(payload)
    const admin = supabaseAdmin()

    const { data: permit, error } = await admin
      .from('loto_hot_work_permits')
      .select('id, serial, pai_id, pai_signature_at, canceled_at')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!permit) throw new Error('Hot-work permit not found in this tenant.')
    if (permit.canceled_at) throw new Error(`Hot-work permit ${permit.serial} is canceled and cannot be authorized.`)
    if (permit.pai_signature_at) throw new Error(`Hot-work permit ${permit.serial} is already authorized.`)

    const prevState = { pai_id: permit.pai_id as string }

    // Conditional update: the WHERE re-asserts the unsigned + uncanceled guard so
    // a concurrent signature or cancel can't be clobbered. Empty result = a lost
    // race; the permit's live state wins and we surface a re-stage instruction.
    const { data: updated, error: upErr } = await admin
      .from('loto_hot_work_permits')
      .update({ pai_id: approverUserId, pai_signature_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .is('pai_signature_at', null)
      .is('canceled_at', null)
      .select('id, serial')
    if (upErr) throw new Error(upErr.message)
    if (!updated || updated.length === 0) {
      throw new Error('Hot-work permit changed before it could be authorized (it was signed or canceled). Re-check and re-stage.')
    }

    return {
      summary: `Authorized hot-work permit ${permit.serial} — signed as the Permit Authorizing Individual.`,
      prevState,
    }
  },

  async rollback(ctx, payload, prevState) {
    const id = requirePermitId(payload)
    const priorPaiId = typeof prevState.pai_id === 'string' ? prevState.pai_id : null
    if (!priorPaiId) throw new Error('Cannot roll back: the prior authorizing individual was not recorded.')
    const admin = supabaseAdmin()

    // Restore the exact prior state: unsigned, original PAI. Guard on currently
    // signed + not canceled so we never resurrect a canceled permit or double-undo.
    const { data: updated, error } = await admin
      .from('loto_hot_work_permits')
      .update({ pai_id: priorPaiId, pai_signature_at: null })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .not('pai_signature_at', 'is', null)
      .is('canceled_at', null)
      .select('id, serial')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0) {
      throw new Error('Hot-work permit is no longer in an authorized, active state; nothing to roll back.')
    }
    return { summary: `Rolled back the authorization on hot-work permit ${updated[0].serial} — it is unsigned again.` }
  },
}

// permit_confined_space_auth — OSHA 1910.146. "Authorize" a permit-required
// confined-space entry by signing it as entry supervisor: the approver becomes
// the entry supervisor of record and entry_supervisor_signature_at is stamped.
// Snapshot the prior entry_supervisor_id so a rollback restores the exact prior
// (unsigned) state. Structurally identical to hot-work — the regulated shape
// (one signature gate + a canceled flag) is shared across permit-to-work types.
//
// Auto-cancel note: migration 053 can cancel a permit when an atmospheric test
// fails its thresholds. apply AND rollback both guard on `canceled_at IS NULL`,
// so we never authorize — or un-authorize — a canceled permit. A failed-reading
// cancellation always wins, which is the correct life-safety posture.
const confinedSpaceAuth: CarveOutApplier = {
  async apply(ctx, payload, approverUserId) {
    const id = requirePermitId(payload)
    const admin = supabaseAdmin()

    const { data: permit, error } = await admin
      .from('loto_confined_space_permits')
      .select('id, serial, entry_supervisor_id, entry_supervisor_signature_at, canceled_at')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!permit) throw new Error('Confined-space permit not found in this tenant.')
    if (permit.canceled_at) throw new Error(`Confined-space permit ${permit.serial} is canceled and cannot be authorized.`)
    if (permit.entry_supervisor_signature_at) throw new Error(`Confined-space permit ${permit.serial} is already authorized.`)

    const prevState = { entry_supervisor_id: permit.entry_supervisor_id as string }

    const { data: updated, error: upErr } = await admin
      .from('loto_confined_space_permits')
      .update({ entry_supervisor_id: approverUserId, entry_supervisor_signature_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .is('entry_supervisor_signature_at', null)
      .is('canceled_at', null)
      .select('id, serial')
    if (upErr) throw new Error(upErr.message)
    if (!updated || updated.length === 0) {
      throw new Error('Confined-space permit changed before it could be authorized (it was signed or canceled). Re-check and re-stage.')
    }

    return {
      summary: `Authorized confined-space entry permit ${permit.serial} — signed as entry supervisor.`,
      prevState,
    }
  },

  async rollback(ctx, payload, prevState) {
    const id = requirePermitId(payload)
    const priorSupervisorId = typeof prevState.entry_supervisor_id === 'string' ? prevState.entry_supervisor_id : null
    if (!priorSupervisorId) throw new Error('Cannot roll back: the prior entry supervisor was not recorded.')
    const admin = supabaseAdmin()

    const { data: updated, error } = await admin
      .from('loto_confined_space_permits')
      .update({ entry_supervisor_id: priorSupervisorId, entry_supervisor_signature_at: null })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .not('entry_supervisor_signature_at', 'is', null)
      .is('canceled_at', null)
      .select('id, serial')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0) {
      throw new Error('Confined-space permit is no longer in an authorized, active state; nothing to roll back.')
    }
    return { summary: `Rolled back the authorization on confined-space permit ${updated[0].serial} — it is unsigned again.` }
  },
}

export const CARVE_OUT_APPLIERS: Partial<Record<CarveOutAction, CarveOutApplier>> = {
  permit_hot_work_auth: hotWorkAuth,
  permit_confined_space_auth: confinedSpaceAuth,
}
