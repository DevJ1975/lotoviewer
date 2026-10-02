import { NextResponse } from 'next/server'
import { EVALUATION_RESULTS } from '@soteria/core/complianceEvaluation'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  EMS_DISCIPLINES,
  ENVIRONMENTAL_MODULE,
  gateFailure,
  invalidInput,
  invalidJson,
  optionalText,
  readJsonObject,
  todayUtc,
} from '@/lib/environmental/registerApi'
import { obligationDeadlineFrom, obligationRegisterInputFrom } from '@/lib/environmental/obligations'

// GET  /api/environmental/obligations   The compliance obligations register (clause 6.1.3):
//                                       environmental and integrated calendar rows, each with
//                                       its latest evaluation result and any open evaluation.
//   ?status=active (default: not dismissed) | dismissed | all
//   ?last_result=compliant|noncompliant|not_applicable|undetermined|none   ?review_due=overdue
//   ?offset=<n>   200 at a time
// POST /api/environmental/obligations   Add an obligation to the register (and so to the
//                                       calendar). Admins only.

const PAGE_SIZE = 200
const STATUSES = ['active', 'dismissed', 'all'] as const
const DESCRIPTION_MAX = 4000

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const params = new URL(req.url).searchParams
  const status = params.get('status') ?? 'active'
  if (!(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'status must be active, dismissed, or all' }, { status: 400 })
  }
  const lastResult = params.get('last_result')
  if (lastResult !== null && lastResult !== 'none' && !(EVALUATION_RESULTS as readonly string[]).includes(lastResult)) {
    return NextResponse.json({ error: `last_result must be none or one of ${EVALUATION_RESULTS.join(', ')}` }, { status: 400 })
  }
  const reviewDue = params.get('review_due')
  if (reviewDue !== null && reviewDue !== 'overdue') {
    return NextResponse.json({ error: 'review_due must be overdue' }, { status: 400 })
  }
  const offset = Number(params.get('offset') ?? '0')
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: 'offset must be a whole number of at least 0' }, { status: 400 })
  }

  let query = gate.authedClient
    .from('ms_obligation_register')
    .select('*')
    .eq('tenant_id', gate.tenantId)
    .in('discipline', EMS_DISCIPLINES)
  if (status === 'active')    query = query.neq('status', 'dismissed')
  if (status === 'dismissed') query = query.eq('status', 'dismissed')
  if (lastResult === 'none')  query = query.is('last_result', null)
  else if (lastResult)        query = query.eq('last_result', lastResult)
  if (reviewDue)              query = query.lt('next_review_due', todayUtc())

  const { data, error } = await query
    .order('title')
    .order('id')
    .range(offset, offset + PAGE_SIZE - 1)
  if (error) return sanitizeError(error, 'environmental/obligations/GET')
  const obligations = data ?? []
  return NextResponse.json({ obligations, nextOffset: obligations.length === PAGE_SIZE ? offset + PAGE_SIZE : null })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const register = obligationRegisterInputFrom({ ...body, discipline: body.discipline ?? 'ems' })
  const deadline = obligationDeadlineFrom(body)
  const description = optionalText(body.description)
  const errors = [
    ...(register.ok ? [] : register.errors),
    ...(deadline.ok ? [] : deadline.errors),
    ...(description !== null && description.length > DESCRIPTION_MAX
      ? [{ field: 'description', message: `must be at most ${DESCRIPTION_MAX} characters` }]
      : []),
  ]
  if (!register.ok || !deadline.ok || errors.length > 0) return invalidInput(errors)
  const fields = register.input
  const due = deadline.input

  const { data, error } = await gate.authedClient
    .from('compliance_calendar_obligations')
    .insert({
      tenant_id:               gate.tenantId,
      facility_id:             gate.facilityId,
      discipline:              fields.discipline,
      title:                   fields.title,
      description,
      regulatory_ref:          fields.citation,
      source_kind:             fields.sourceKind,
      jurisdiction:            fields.jurisdiction,
      applicability_rationale: fields.applicabilityRationale,
      evaluation_cadence_days: fields.evaluationCadenceDays,
      next_due_at:             due.nextDueAt,
      cadence:                 due.cadence,
      cadence_days:            due.cadenceDays,
      source:                  'tenant',
      created_by:              gate.userId,
    })
    .select('*')
    .single()
  if (error) return sanitizeError(error, 'environmental/obligations/POST')
  return NextResponse.json({ obligation: data }, { status: 201 })
}
