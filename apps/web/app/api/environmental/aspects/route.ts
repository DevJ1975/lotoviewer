import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  MAX_LIST_OFFSET,
  gateFailure,
  invalidInput,
  invalidJson,
  readJsonObject,
  todayUtc,
} from '@/lib/environmental/registerApi'
import { aspectInputFrom } from '@/lib/environmental/aspects'

// GET  /api/environmental/aspects   The aspects register (clause 6.1.2), with each
//                                   aspect's current scores, 200 at a time.
//   ?status=active (default) | obsolete | all
//   ?process_area=<exact>   ?significant=true|false   ?review_due=overdue   ?offset=<n>
// POST /api/environmental/aspects   Record an aspect at the active facility. Admins only.
//                                   Scores are added separately, one condition at a time.

const PAGE_SIZE = 200
const STATUSES = ['active', 'obsolete', 'all'] as const

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const params = new URL(req.url).searchParams
  const status = params.get('status') ?? 'active'
  if (!(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'status must be active, obsolete, or all' }, { status: 400 })
  }
  const significant = params.get('significant')
  if (significant !== null && significant !== 'true' && significant !== 'false') {
    return NextResponse.json({ error: 'significant must be true or false' }, { status: 400 })
  }
  const reviewDue = params.get('review_due')
  if (reviewDue !== null && reviewDue !== 'overdue') {
    return NextResponse.json({ error: 'review_due must be overdue' }, { status: 400 })
  }
  const offset = Number(params.get('offset') ?? '0')
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_LIST_OFFSET) {
    return NextResponse.json({ error: `offset must be a whole number from 0 to ${MAX_LIST_OFFSET}` }, { status: 400 })
  }

  let query = gate.authedClient
    .from('environmental_aspect_register')
    .select('*')
    .eq('tenant_id', gate.tenantId)
  if (status === 'active')   query = query.is('obsolete_at', null)
  if (status === 'obsolete') query = query.not('obsolete_at', 'is', null)
  const processArea = params.get('process_area')
  if (processArea)           query = query.eq('process_area', processArea)
  if (significant !== null)  query = query.eq('significant', significant === 'true')
  if (reviewDue)             query = query.lt('next_review_due', todayUtc())

  const { data, error } = await query
    .order('process_area')
    .order('activity')
    .order('id')
    .range(offset, offset + PAGE_SIZE - 1)
  if (error) return sanitizeError(error, 'environmental/aspects/GET')
  const aspects = data ?? []
  return NextResponse.json({ aspects, nextOffset: aspects.length === PAGE_SIZE ? offset + PAGE_SIZE : null })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)
  if (!gate.facilityId) {
    return NextResponse.json({ error: 'Select a facility: an aspect belongs to a site.' }, { status: 400 })
  }

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const parsed = aspectInputFrom(body)
  if (!parsed.ok) return invalidInput(parsed.errors)
  const aspect = parsed.input

  const { data, error } = await gate.authedClient
    .from('environmental_aspects')
    .insert({
      tenant_id:        gate.tenantId,
      facility_id:      gate.facilityId,
      activity:         aspect.activity,
      aspect:           aspect.aspect,
      impact:           aspect.impact,
      process_area:     aspect.processArea,
      life_cycle_stage: aspect.lifeCycleStage,
      flow:             aspect.flow,
      control_level:    aspect.controlLevel,
      status:           aspect.status,
      controls:         aspect.controls,
      notes:            aspect.notes,
      source_reference: aspect.sourceReference,
      created_by:       gate.userId,
      updated_by:       gate.userId,
    })
    .select('*')
    .single()
  if (error) return sanitizeError(error, 'environmental/aspects/POST')
  return NextResponse.json({ aspect: data }, { status: 201 })
}
