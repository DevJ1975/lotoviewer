import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { ToolContext, UserRole } from '@/lib/ai/tools'
import { roleMeets } from './types'
import {
  type AgentActionStatus,
  type AuthorizingRole,
  type CarveOutAction,
  authorizingRoleFor,
  canTransition,
  isReversibleAction,
} from '@soteria/core/operatorActions'
import { CARVE_OUT_APPLIERS } from './carveOutAppliers'

// The approval engine: the lifecycle service over agent_action_queue (migration
// 238). A regulated operator tool STAGES here instead of executing; a qualified
// human then applies it (it takes effect) or rejects it, and a reversible applied
// action can be rolled back.
//
// Every state-changing call re-proves the actor's authorizing role LIVE against
// tenant_memberships — it never trusts a role passed in — before touching the
// target system, and runs the carve-out's applier from the typed dispatcher. All
// writes use the admin client; tenant scoping is explicit on every query.

const TABLE = 'agent_action_queue'

/** The acting human, as resolved by a route's tenant gate. */
export interface Approver {
  tenantId: string
  userId: string
  role: UserRole
}

export type EngineResult =
  | { ok: true; status: AgentActionStatus; summary: string }
  | { ok: false; status: number; error: string }

export interface PendingAction {
  id: string
  action: CarveOutAction
  authorizingRole: AuthorizingRole
  reversible: boolean
  summary: string
  requestedBy: string
  requestedAt: string
}

function engineFail(status: number, error: string): EngineResult {
  return { ok: false, status, error }
}

// ── stage ────────────────────────────────────────────────────────────────────
/** Record a regulated action as pending. Called by runOperatorTool. */
export async function stageRegulatedAction(
  ctx: ToolContext,
  action: CarveOutAction,
  payload: Record<string, unknown>,
  summary: string,
): Promise<{ ok: true; queueId: string; authorizingRole: AuthorizingRole } | { ok: false; error: string }> {
  const authorizingRole = authorizingRoleFor(action)
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .insert({
      tenant_id:        ctx.tenantId,
      conversation_id:  ctx.conversationId,
      action,
      status:           'pending',
      authorizing_role: authorizingRole,
      reversible:       isReversibleAction(action),
      payload,
      summary:          summary.slice(0, 500),
      requested_by:     ctx.userId,
    })
    .select('id')
    .maybeSingle()
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not stage the action for approval.' }
  return { ok: true, queueId: data.id as string, authorizingRole }
}

// ── read ───────────────────────────────────────────────────────────────────
/** The pending approval inbox for a tenant, newest first. */
export async function listPendingActions(tenantId: string): Promise<PendingAction[]> {
  const { data } = await supabaseAdmin()
    .from(TABLE)
    .select('id, action, authorizing_role, reversible, summary, requested_by, requested_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
  return (data ?? []).map(r => ({
    id:              r.id as string,
    action:          r.action as CarveOutAction,
    authorizingRole: r.authorizing_role as AuthorizingRole,
    reversible:      r.reversible as boolean,
    summary:         r.summary as string,
    requestedBy:     r.requested_by as string,
    requestedAt:     r.requested_at as string,
  }))
}

// ── role re-proof ────────────────────────────────────────────────────────────
// The literal "re-prove the actor holds the authorizing role" step. A superadmin
// (already proved at the platform level by the gate) passes; any other actor's
// role is read LIVE from tenant_memberships, never trusted from the caller.
async function liveTenantRole(approver: Approver): Promise<UserRole> {
  if (approver.role === 'superadmin') return 'superadmin'
  const { data } = await supabaseAdmin()
    .from('tenant_memberships')
    .select('role')
    .eq('tenant_id', approver.tenantId)
    .eq('user_id', approver.userId)
    .maybeSingle()
  return (data?.role as UserRole) ?? 'viewer'
}

async function holdsAuthorizingRole(approver: Approver, action: CarveOutAction): Promise<boolean> {
  return roleMeets(await liveTenantRole(approver), authorizingRoleFor(action))
}

interface QueueRow {
  action: CarveOutAction
  status: AgentActionStatus
  reversible: boolean
  payload: Record<string, unknown>
  apply_result: { prevState?: Record<string, unknown> } | null
}

async function loadRow(tenantId: string, queueId: string): Promise<QueueRow | null> {
  const { data } = await supabaseAdmin()
    .from(TABLE)
    .select('action, status, reversible, payload, apply_result')
    .eq('id', queueId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as QueueRow | null) ?? null
}

async function stampError(tenantId: string, queueId: string, message: string): Promise<void> {
  await supabaseAdmin().from(TABLE).update({ error: message }).eq('id', queueId).eq('tenant_id', tenantId)
}

// ── approve & apply (one tap) ─────────────────────────────────────────────────
export async function approveAndApply(approver: Approver, queueId: string): Promise<EngineResult> {
  const row = await loadRow(approver.tenantId, queueId)
  if (!row) return engineFail(404, 'Approval not found.')
  if (!canTransition(row.status, 'applied')) {
    return engineFail(409, `This action is '${row.status}' and can no longer be applied.`)
  }
  if (!(await holdsAuthorizingRole(approver, row.action))) {
    return engineFail(403, `Approving this requires the '${authorizingRoleFor(row.action)}' role on this tenant.`)
  }
  const applier = CARVE_OUT_APPLIERS[row.action]
  if (!applier) return engineFail(422, `No applier is wired for '${row.action}' yet.`)

  let result: { summary: string; prevState: Record<string, unknown> }
  try {
    result = await applier.apply({ tenantId: approver.tenantId, userId: approver.userId }, row.payload, approver.userId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The action could not be applied.'
    await stampError(approver.tenantId, queueId, message)
    return engineFail(409, message)
  }

  const { error: upErr } = await supabaseAdmin()
    .from(TABLE)
    .update({
      status:       'applied',
      decided_by:   approver.userId,
      decided_at:   new Date().toISOString(),
      apply_result: { summary: result.summary, prevState: result.prevState },
      error:        null,
    })
    .eq('id', queueId)
    .eq('tenant_id', approver.tenantId)
    .eq('status', 'pending')
  if (upErr) return engineFail(500, upErr.message)
  return { ok: true, status: 'applied', summary: result.summary }
}

// ── reject ───────────────────────────────────────────────────────────────────
export async function rejectAction(approver: Approver, queueId: string, reason: string): Promise<EngineResult> {
  const trimmed = reason.trim()
  if (!trimmed) return engineFail(400, 'A reason is required to reject an action.')
  const row = await loadRow(approver.tenantId, queueId)
  if (!row) return engineFail(404, 'Approval not found.')
  if (!canTransition(row.status, 'rejected')) {
    return engineFail(409, `This action is '${row.status}' and can no longer be rejected.`)
  }
  if (!(await holdsAuthorizingRole(approver, row.action))) {
    return engineFail(403, `Rejecting this requires the '${authorizingRoleFor(row.action)}' role on this tenant.`)
  }
  const { error } = await supabaseAdmin()
    .from(TABLE)
    .update({
      status:           'rejected',
      decided_by:       approver.userId,
      decided_at:       new Date().toISOString(),
      rejection_reason: trimmed,
    })
    .eq('id', queueId)
    .eq('tenant_id', approver.tenantId)
    .eq('status', 'pending')
  if (error) return engineFail(500, error.message)
  return { ok: true, status: 'rejected', summary: 'Action rejected.' }
}

// ── rollback ─────────────────────────────────────────────────────────────────
export async function rollbackAction(approver: Approver, queueId: string): Promise<EngineResult> {
  const row = await loadRow(approver.tenantId, queueId)
  if (!row) return engineFail(404, 'Approval not found.')
  if (!canTransition(row.status, 'rolled_back', { reversible: row.reversible })) {
    return engineFail(409, row.status !== 'applied'
      ? `This action is '${row.status}'; only an applied action can be rolled back.`
      : 'This action is not reversible and cannot be rolled back.')
  }
  if (!(await holdsAuthorizingRole(approver, row.action))) {
    return engineFail(403, `Rolling this back requires the '${authorizingRoleFor(row.action)}' role on this tenant.`)
  }
  const applier = CARVE_OUT_APPLIERS[row.action]
  if (!applier) return engineFail(422, `No applier is wired for '${row.action}' yet.`)

  let summary: string
  try {
    const r = await applier.rollback(
      { tenantId: approver.tenantId, userId: approver.userId },
      row.payload,
      row.apply_result?.prevState ?? {},
    )
    summary = r.summary
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The action could not be rolled back.'
    await stampError(approver.tenantId, queueId, message)
    return engineFail(409, message)
  }

  const { error: upErr } = await supabaseAdmin()
    .from(TABLE)
    .update({
      status:         'rolled_back',
      rolled_back_by: approver.userId,
      rolled_back_at: new Date().toISOString(),
      error:          null,
    })
    .eq('id', queueId)
    .eq('tenant_id', approver.tenantId)
    .eq('status', 'applied')
  if (upErr) return engineFail(500, upErr.message)
  return { ok: true, status: 'rolled_back', summary }
}
