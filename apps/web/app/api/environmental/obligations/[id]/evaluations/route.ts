import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
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
  todayUtc,
  type RouteContext,
} from '@/lib/environmental/registerApi'

// POST /api/environmental/obligations/[id]/evaluations   Open an evaluation of compliance with
//   this obligation now, outside the nightly schedule: { assigned_to? } (defaults to the
//   caller). Admins only. Evidence is then attached to it, and it closes through
//   POST /api/environmental/evaluations/[id]/complete. One evaluation per obligation may be
//   open at a time (uq_ms_compliance_evaluations_open).

interface ObligationRow { id: string; facility_id: string | null; discipline: string; status: string }

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const assignedTo = optionalText(body.assigned_to) ?? gate.userId
  if (!UUID_RE.test(assignedTo)) return invalidInput([{ field: 'assignedTo', message: 'must be a user id' }])

  const { data, error: obligationError } = await gate.authedClient
    .from('compliance_calendar_obligations')
    .select('id, facility_id, discipline, status')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .in('discipline', EMS_DISCIPLINES)
    .maybeSingle()
  if (obligationError) return sanitizeError(obligationError, 'environmental/obligations/[id]/evaluations/POST obligation')
  if (!data) return notFound()
  const obligation = data as ObligationRow
  if (obligation.status === 'dismissed') {
    return NextResponse.json({ error: 'This obligation is dismissed; it is no longer evaluated.' }, { status: 409 })
  }

  if (assignedTo !== gate.userId) {
    const { data: membership, error } = await supabaseAdmin()
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', gate.tenantId)
      .eq('user_id', assignedTo)
      .is('invite_cancelled_at', null)
      .maybeSingle()
    if (error) return sanitizeError(error, 'environmental/obligations/[id]/evaluations/POST assignee')
    if (!membership) return invalidInput([{ field: 'assignedTo', message: 'is not a member of this organization' }])
  }

  const { data: evaluation, error } = await gate.authedClient
    .from('ms_compliance_evaluations')
    .insert({
      tenant_id:     gate.tenantId,
      facility_id:   obligation.facility_id,
      discipline:    obligation.discipline,
      obligation_id: obligation.id,
      scheduled_for: todayUtc(),
      assigned_to:   assignedTo,
      created_by:    gate.userId,
    })
    .select('*')
    .single()
  if ((error as { code?: string } | null)?.code === '23505') {
    return NextResponse.json({ error: 'An evaluation of this obligation is already open.' }, { status: 409 })
  }
  if (error) return sanitizeError(error, 'environmental/obligations/[id]/evaluations/POST')
  return NextResponse.json({ evaluation }, { status: 201 })
}
