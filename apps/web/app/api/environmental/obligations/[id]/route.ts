import { NextResponse } from 'next/server'
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
  readJsonObject,
  type RouteContext,
} from '@/lib/environmental/registerApi'
import { OBLIGATION_EDITABLE, obligationRegisterInputFrom } from '@/lib/environmental/obligations'

// GET   /api/environmental/obligations/[id]   One obligation: its register row, every
//                                             evaluation of it (newest first), the
//                                             evidence filed against those evaluations,
//                                             and the aspects linked to it.
// PATCH /api/environmental/obligations/[id]   Edit the register fields. Admins only.
//                                             Deadlines stay with /api/compliance/obligations.

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const [obligation, evaluations, links] = await Promise.all([
    gate.authedClient.from('ms_obligation_register').select('*')
      .eq('id', id).eq('tenant_id', gate.tenantId).in('discipline', EMS_DISCIPLINES).maybeSingle(),
    gate.authedClient.from('ms_compliance_evaluations').select('*')
      .eq('obligation_id', id).eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }),
    gate.authedClient.from('environmental_aspect_obligations').select('aspect_id')
      .eq('obligation_id', id).eq('tenant_id', gate.tenantId),
  ])
  const failed = obligation.error ?? evaluations.error ?? links.error
  if (failed) return sanitizeError(failed, 'environmental/obligations/[id]/GET')
  if (!obligation.data) return notFound()

  const aspectIds = (links.data ?? []).map(link => (link as { aspect_id: string }).aspect_id)
  let linkedAspects: unknown[] = []
  if (aspectIds.length > 0) {
    const { data, error } = await gate.authedClient
      .from('environmental_aspects')
      .select('id, activity, aspect, obsolete_at')
      .eq('tenant_id', gate.tenantId)
      .in('id', aspectIds)
      .order('activity')
    if (error) return sanitizeError(error, 'environmental/obligations/[id]/GET aspects')
    linkedAspects = data ?? []
  }

  const evaluationIds = (evaluations.data ?? []).map(e => (e as { id: string }).id)
  let evidence: unknown[] = []
  if (evaluationIds.length > 0) {
    const { data, error } = await gate.authedClient
      .from('ms_evidence')
      .select('id, subject_id, kind, file_name, mime_type, file_size_bytes, sha256, uploaded_by, uploaded_at, superseded_by, superseded_at, superseded_reason')
      .eq('tenant_id', gate.tenantId)
      .eq('subject_type', 'compliance_evaluation')
      .in('subject_id', evaluationIds)
      .order('uploaded_at', { ascending: false })
    if (error) return sanitizeError(error, 'environmental/obligations/[id]/GET evidence')
    evidence = data ?? []
  }

  return NextResponse.json({ obligation: obligation.data, evaluations: evaluations.data ?? [], evidence, linkedAspects })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const edits = (Object.keys(OBLIGATION_EDITABLE) as (keyof typeof OBLIGATION_EDITABLE)[]).filter(column => column in body)
  if (edits.length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

  const { data: current, error: readError } = await gate.authedClient
    .from('compliance_calendar_obligations')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .in('discipline', EMS_DISCIPLINES)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/obligations/[id]/PATCH read')
  if (!current) return notFound()

  const parsed = obligationRegisterInputFrom({ ...current, ...body })
  if (!parsed.ok) return invalidInput(parsed.errors)

  const patch: Record<string, unknown> = {}
  for (const column of edits) patch[column] = parsed.input[OBLIGATION_EDITABLE[column]]

  const { data, error } = await gate.authedClient
    .from('compliance_calendar_obligations')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .maybeSingle()
  if (error) return sanitizeError(error, 'environmental/obligations/[id]/PATCH')
  if (!data) return notFound()
  return NextResponse.json({ obligation: data })
}
