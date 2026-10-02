import { NextResponse } from 'next/server'
import {
  RESOLUTION_GAP_MESSAGES,
  changeCloseGaps,
  impactResolutionGaps,
  type ChangeKind,
  type ImpactTargetType,
  type TransferStep,
} from '@soteria/core/managementOfChange'
import { validateRetirementReason } from '@soteria/core/managementSystem'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  EMS_DISCIPLINES,
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  gateFailure,
  invalidInput,
  invalidJson,
  notFound,
  optionalText,
  readJsonObject,
  text,
  type RouteContext,
} from '@/lib/environmental/registerApi'
import { EVIDENCE_PUBLIC_COLUMNS } from '@/lib/environmental/evidence'
import {
  CHANGE_COLUMNS,
  CHANGE_EDITABLE,
  IMPACT_COLUMNS,
  changeInputFrom,
  loadImpactTargets,
  targetOf,
} from '@/lib/environmental/changes'

// GET   /api/environmental/changes/[id]   One change with its impacts: what each points at, its
//                                         evidence, and what still blocks resolving it (the same
//                                         rules the database enforces, so the page can say why).
// PATCH /api/environmental/changes/[id]   Admins only, while the change is open. Either
//         { title?, description?, effective_on? }   correct what it says, or
//         { status: 'closed' }                       close it: every impact must be resolved, or
//         { status: 'cancelled', cancelled_reason }  cancel it, keeping its impacts as history.
//   A change's kind, site, process area and new legal entity are fixed once it opens: its impacts
//   were worked out from them.

interface ChangeRow {
  id: string; discipline: string; kind: ChangeKind; title: string; description: string
  process_area: string | null; new_legal_entity: string | null; effective_on: string | null; status: string
}
interface ImpactRow {
  id: string; change_id: string; target_type: ImpactTargetType; target_id: string
  step: TransferStep | null; step_order: number; action_required: string
  resolved_at: string | null; resolved_by: string | null; resolution_note: string | null
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const db = gate.authedClient
  const [change, impactResult] = await Promise.all([
    db.from('ms_changes').select(CHANGE_COLUMNS).eq('id', id).eq('tenant_id', gate.tenantId)
      .in('discipline', EMS_DISCIPLINES).maybeSingle(),
    db.from('ms_change_impacts').select(IMPACT_COLUMNS).eq('change_id', id).eq('tenant_id', gate.tenantId)
      .order('created_at').order('step_order').order('id').limit(5000),
  ])
  const failed = change.error ?? impactResult.error
  if (failed) return sanitizeError(failed, 'environmental/changes/[id]/GET')
  if (!change.data) return notFound()
  const row = change.data as unknown as ChangeRow
  const impacts = (impactResult.data ?? []) as unknown as ImpactRow[]

  const impactIds = impacts.map(impact => impact.id)
  const [{ targets, error: targetError }, evidence, scope, policy] = await Promise.all([
    loadImpactTargets(db, gate.tenantId, impacts),
    impactIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db.from('ms_evidence').select(EVIDENCE_PUBLIC_COLUMNS).eq('tenant_id', gate.tenantId)
          .eq('subject_type', 'ms_change_impact').in('subject_id', impactIds).order('uploaded_at', { ascending: false }),
    db.from('ms_scope_statements').select('legal_entity, effective_from').eq('tenant_id', gate.tenantId)
      .eq('discipline', row.discipline).order('version', { ascending: false }).limit(1).maybeSingle(),
    db.from('ms_policies').select('signed_at').eq('tenant_id', gate.tenantId)
      .eq('discipline', row.discipline).order('version', { ascending: false }).limit(1).maybeSingle(),
  ])
  const readFailed = targetError ?? evidence.error ?? scope.error ?? policy.error
  if (readFailed) return sanitizeError(readFailed, 'environmental/changes/[id]/GET targets')

  const evidenceRows = (evidence.data ?? []) as unknown as { subject_id: string; superseded_by: string | null }[]
  const scopeInForce = scope.data
    ? { legalEntity: (scope.data as { legal_entity: string }).legal_entity, effectiveFrom: (scope.data as { effective_from: string }).effective_from }
    : null
  const policySignedAt = (policy.data as { signed_at: string } | null)?.signed_at ?? null

  const described = impacts.map(impact => {
    const target = targetOf(targets, impact.target_type, impact.target_id)
    const gaps = impact.resolved_at !== null ? [] : impactResolutionGaps(
      { targetType: impact.target_type, step: impact.step, resolvedAt: impact.resolved_at },
      {
        changeOpen:     row.status === 'open',
        newLegalEntity: row.new_legal_entity,
        evidenceCount:  evidenceRows.filter(e => e.subject_id === impact.id && e.superseded_by === null).length,
        note:           null,
        permitHolder:   impact.target_type === 'permit' ? target.holder ?? null : null,
        scopeInForce,
        policySignedAt,
      })
    return {
      ...impact,
      target_label: target.label,
      target_href:  target.href,
      // The note is typed at the moment of resolving, so it is a prompt, not a blocker.
      needs_note:   gaps.includes('note_required'),
      blockers:     gaps.filter(gap => gap !== 'note_required').map(gap => RESOLUTION_GAP_MESSAGES[gap]),
    }
  })

  return NextResponse.json({
    change: row,
    impacts: described,
    evidence: evidence.data ?? [],
    closeBlockers: changeCloseGaps(impacts.map(impact => ({ resolvedAt: impact.resolved_at }))),
  })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const status = optionalText(body.status)
  const edits = (Object.keys(CHANGE_EDITABLE) as (keyof typeof CHANGE_EDITABLE)[]).filter(column => column in body)
  if (status !== null && edits.length > 0) {
    return NextResponse.json({ error: 'Change what the change says, or close or cancel it, in separate requests.' }, { status: 400 })
  }
  if (status === null && edits.length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  if (status !== null && status !== 'closed' && status !== 'cancelled') {
    return invalidInput([{ field: 'status', message: "must be 'closed' or 'cancelled'" }])
  }

  const { data: current, error: readError } = await gate.authedClient
    .from('ms_changes')
    .select(CHANGE_COLUMNS)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .in('discipline', EMS_DISCIPLINES)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/changes/[id]/PATCH read')
  if (!current) return notFound()
  const change = current as unknown as ChangeRow
  if (change.status !== 'open') {
    return NextResponse.json({ error: `This change is ${change.status}, so it can no longer be edited.` }, { status: 409 })
  }

  const patch: Record<string, unknown> = {}
  if (status === 'closed') {
    const { data: impacts, error } = await gate.authedClient
      .from('ms_change_impacts').select('resolved_at').eq('change_id', id).eq('tenant_id', gate.tenantId).limit(50_000)
    if (error) return sanitizeError(error, 'environmental/changes/[id]/PATCH impacts')
    const gaps = changeCloseGaps(((impacts ?? []) as { resolved_at: string | null }[])
      .map(impact => ({ resolvedAt: impact.resolved_at })))
    if (gaps.length > 0) return NextResponse.json({ error: gaps.join(' ') }, { status: 409 })
    patch.status = 'closed'
  } else if (status === 'cancelled') {
    const reason = text(body.cancelled_reason)
    const errors = validateRetirementReason(reason, 'cancelledReason')
    if (errors.length > 0) return invalidInput(errors)
    patch.status = 'cancelled'
    patch.cancelled_reason = reason
  } else {
    // The stored change, with only the editable fields laid over it, must still be a valid
    // change: a field the request sent but may not change is ignored, not validated.
    const overlay = Object.fromEntries(edits.map(column => [column, body[column]]))
    const parsed = changeInputFrom({ ...change, ...overlay })
    if (!parsed.ok) return invalidInput(parsed.errors)
    for (const column of edits) patch[column] = parsed.input[CHANGE_EDITABLE[column]]
  }

  // Matched on status, so a change ended meanwhile is not edited. The database's own
  // guard refuses a close with an unresolved impact and seals what has ended.
  const { data, error } = await gate.authedClient
    .from('ms_changes')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .eq('status', 'open')
    .select(CHANGE_COLUMNS)
    .maybeSingle()
  const code = (error as { code?: string } | null)?.code
  if (code === '23514') return NextResponse.json({ error: (error as { message: string }).message }, { status: 409 })
  if (error) return sanitizeError(error, 'environmental/changes/[id]/PATCH')
  if (!data) return NextResponse.json({ error: 'This change ended while you were editing it. Reload and try again.' }, { status: 409 })
  return NextResponse.json({ change: data })
}
