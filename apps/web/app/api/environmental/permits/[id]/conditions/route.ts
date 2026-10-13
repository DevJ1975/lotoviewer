import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PermitProgram } from '@soteria/core/environmentalPermit'
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
  optionalText,
  readJsonObject,
  type RouteContext,
} from '@/lib/environmental/registerApi'
import { obligationDeadlineFrom, obligationRegisterInputFrom } from '@/lib/environmental/obligations'
import { CONDITION_CATEGORY, ownerFrom } from '@/lib/environmental/permits'

// GET  /api/environmental/permits/[id]/conditions   The permit's conditions: obligations
//                                                    linked to it, soonest due first.
// POST /api/environmental/permits/[id]/conditions   Add a condition (plan D3). Admins only.
//   { title, next_due_at, cadence?, cadence_days?, regulatory_ref?, description?,
//     applicability_rationale?, evaluation_cadence_days?, owner_user_id? }
//
// A condition is a compliance obligation: it lands in the legal register (6.1.3), is
// evaluated for compliance (9.1.2) and recurs on the calendar's cadence. It takes the
// permit's jurisdiction and site, and the category its program files under. Every
// condition has a due date (D4): a limit with no deliverable gets a periodic check.

const DESCRIPTION_MAX = 4000

interface PermitForCondition {
  id: string; facility_id: string; program: PermitProgram; jurisdiction: string
  permit_number: string | null; title: string; retired_at: string | null
}

function readPermit(client: SupabaseClient, tenantId: string, id: string) {
  return client
    .from('environmental_permits')
    .select('id, facility_id, program, jurisdiction, permit_number, title, retired_at')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const [permit, conditions] = await Promise.all([
    readPermit(gate.authedClient, gate.tenantId, id),
    gate.authedClient.from('ms_obligation_register').select('*')
      .eq('tenant_id', gate.tenantId).eq('permit_id', id)
      .order('next_due_at').order('id'),
  ])
  const failed = permit.error ?? conditions.error
  if (failed) return sanitizeError(failed, 'environmental/permits/[id]/conditions/GET')
  if (!permit.data) return notFound()
  return NextResponse.json({ conditions: conditions.data ?? [] })
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const { data, error: readError } = await readPermit(gate.authedClient, gate.tenantId, id)
  if (readError) return sanitizeError(readError, 'environmental/permits/[id]/conditions/POST permit')
  if (!data) return notFound()
  const permit = data as PermitForCondition
  if (permit.retired_at) {
    return NextResponse.json({ error: 'This permit is retired, so it takes no new conditions.' }, { status: 409 })
  }

  // The permit decides what kind of obligation this is and where it applies.
  const register = obligationRegisterInputFrom({
    ...body, discipline: 'ems', source_kind: 'permit', jurisdiction: permit.jurisdiction,
  })
  const deadline = obligationDeadlineFrom(body)
  const owner = ownerFrom(body)
  const description = optionalText(body.description)
  const errors = [
    ...(register.ok ? [] : register.errors),
    ...(deadline.ok ? [] : deadline.errors),
    ...(owner.ok ? [] : owner.errors),
    ...(description !== null && description.length > DESCRIPTION_MAX
      ? [{ field: 'description', message: `must be at most ${DESCRIPTION_MAX} characters` }]
      : []),
  ]
  if (!register.ok || !deadline.ok || !owner.ok || errors.length > 0) return invalidInput(errors)
  const ownerUserId = owner.input ?? null

  if (ownerUserId !== null) {
    const { member, error } = await isCurrentMember(gate.tenantId, ownerUserId)
    if (error) return sanitizeError(error, 'environmental/permits/[id]/conditions/POST owner')
    if (!member) return notAMember()
  }

  const fields = register.input
  const { data: condition, error } = await gate.authedClient
    .from('compliance_calendar_obligations')
    .insert({
      tenant_id:               gate.tenantId,
      facility_id:             permit.facility_id,
      permit_id:               permit.id,
      discipline:              'ems',
      title:                   fields.title,
      description,
      regulatory_ref:          fields.citation ?? permit.permit_number ?? permit.title,
      category:                CONDITION_CATEGORY[permit.program],
      source_kind:             'permit',
      jurisdiction:            permit.jurisdiction,
      applicability_rationale: fields.applicabilityRationale,
      evaluation_cadence_days: fields.evaluationCadenceDays,
      next_due_at:             deadline.input.nextDueAt,
      cadence:                 deadline.input.cadence,
      cadence_days:            deadline.input.cadenceDays,
      owner_user_id:           ownerUserId,
      source:                  'tenant',
      created_by:              gate.userId,
    })
    .select('*')
    .single()
  if (error) return sanitizeError(error, 'environmental/permits/[id]/conditions/POST')
  return NextResponse.json({ condition }, { status: 201 })
}
