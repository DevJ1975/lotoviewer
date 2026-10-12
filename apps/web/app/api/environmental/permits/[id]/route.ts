import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  gateFailure,
  invalidInput,
  invalidJson,
  isCurrentMember,
  notAMember,
  notFound,
  readJsonObject,
  todayUtc,
  type RouteContext,
} from '@/lib/environmental/registerApi'
import { EVIDENCE_PUBLIC_COLUMNS } from '@/lib/environmental/evidence'
import {
  PERMIT_COLUMNS,
  PERMIT_EDITABLE,
  conditionCountsByPermit,
  describePermit,
  ownerFrom,
  permitInputFrom,
  type PermitRow,
} from '@/lib/environmental/permits'

// GET   /api/environmental/permits/[id]   One permit as the vault describes it, with its
//                                         conditions (obligations linked to it), its
//                                         documents, and the changes that touched it.
// PATCH /api/environmental/permits/[id]   Correct a permit's fields or owner. Admins only.
//                                         Renewal and retirement have their own routes; a
//                                         retired permit is history and is not edited.

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const [permit, scope, conditions, documents, impacts] = await Promise.all([
    gate.authedClient.from('environmental_permits').select(PERMIT_COLUMNS)
      .eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle(),
    gate.authedClient.from('ms_scope_statements').select('legal_entity')
      .eq('tenant_id', gate.tenantId).eq('discipline', 'ems')
      .order('version', { ascending: false }).limit(1).maybeSingle(),
    gate.authedClient.from('ms_obligation_register').select('*')
      .eq('tenant_id', gate.tenantId).eq('permit_id', id)
      .order('next_due_at').order('id'),
    gate.authedClient.from('ms_evidence').select(EVIDENCE_PUBLIC_COLUMNS)
      .eq('tenant_id', gate.tenantId).eq('subject_type', 'environmental_permit').eq('subject_id', id)
      .order('uploaded_at', { ascending: false }),
    gate.authedClient.from('ms_change_impacts').select('change_id, step, resolved_at')
      .eq('tenant_id', gate.tenantId).eq('target_type', 'permit').eq('target_id', id),
  ])
  const failed = permit.error ?? scope.error ?? conditions.error ?? documents.error ?? impacts.error
  if (failed) return sanitizeError(failed, 'environmental/permits/[id]/GET')
  if (!permit.data) return notFound()

  const changeIds = [...new Set((impacts.data ?? []).map(impact => (impact as { change_id: string }).change_id))]
  let changes: unknown[] = []
  if (changeIds.length > 0) {
    const { data, error } = await gate.authedClient
      .from('ms_changes')
      .select('id, kind, title, status, opened_at, ended_at')
      .eq('tenant_id', gate.tenantId)
      .in('id', changeIds)
      .order('opened_at', { ascending: false })
    if (error) return sanitizeError(error, 'environmental/permits/[id]/GET changes')
    changes = data ?? []
  }

  const today = todayUtc()
  const conditionRows = (conditions.data ?? []) as { permit_id: string | null; status: string; next_due_at: string }[]
  const legalEntityInForce = (scope.data as { legal_entity: string } | null)?.legal_entity ?? null
  return NextResponse.json({
    permit: describePermit(permit.data as unknown as PermitRow, legalEntityInForce, today,
      conditionCountsByPermit(conditionRows, today).get(id)),
    legalEntityInForce,
    conditions: conditionRows,
    documents: documents.data ?? [],
    changes,
  })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const edits = (Object.keys(PERMIT_EDITABLE) as (keyof typeof PERMIT_EDITABLE)[]).filter(column => column in body)
  const owner = ownerFrom(body)
  if (!owner.ok) return invalidInput(owner.errors)
  if (edits.length === 0 && owner.input === undefined) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

  const { data: current, error: readError } = await gate.authedClient
    .from('environmental_permits')
    .select(PERMIT_COLUMNS)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/permits/[id]/PATCH read')
  if (!current) return notFound()
  if ((current as unknown as PermitRow).retired_at) {
    return NextResponse.json({ error: 'This permit is retired; it is kept as history and not edited.' }, { status: 409 })
  }

  const parsed = permitInputFrom({ ...(current as unknown as Record<string, unknown>), ...body })
  if (!parsed.ok) return invalidInput(parsed.errors)

  if (owner.input) {
    const { member, error } = await isCurrentMember(gate.tenantId, owner.input)
    if (error) return sanitizeError(error, 'environmental/permits/[id]/PATCH owner')
    if (!member) return notAMember()
  }

  const patch: Record<string, unknown> = { updated_by: gate.userId }
  for (const column of edits) patch[column] = parsed.input[PERMIT_EDITABLE[column]]
  if (owner.input !== undefined) patch.owner_user_id = owner.input

  const { data, error } = await gate.authedClient
    .from('environmental_permits')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .is('retired_at', null)
    .select(PERMIT_COLUMNS)
    .maybeSingle()
  const code = (error as { code?: string } | null)?.code
  if (code === '23505') {
    return NextResponse.json({ error: 'A permit with this agency and number is already in the vault.' }, { status: 409 })
  }
  if (code === '23503' && owner.input) return notAMember()
  if (error) return sanitizeError(error, 'environmental/permits/[id]/PATCH')
  if (!data) return NextResponse.json({ error: 'This permit was retired while you were editing it.' }, { status: 409 })
  return NextResponse.json({ permit: data })
}
