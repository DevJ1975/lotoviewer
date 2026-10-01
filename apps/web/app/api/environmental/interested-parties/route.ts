import { NextResponse } from 'next/server'
import { registerDisciplines } from '@soteria/core/managementSystem'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { ENVIRONMENTAL_MODULE, gateFailure, invalidInput, invalidJson, readJsonObject } from '@/lib/environmental/registerApi'
import { interestedPartyInputFrom, unknownObligation } from '@/lib/environmental/contextRegisters'

// GET  /api/environmental/interested-parties   Interested parties and their needs (clause 4.2).
//                                              ?status=active (default) | retired | all
// POST /api/environmental/interested-parties   Record a party. Admins only. A need the
//                                              organization adopts may link the obligation it became.
//
// Parties are organization-wide in Phase 1, so facility_id stays null.

const STATUSES = ['active', 'retired', 'all'] as const

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const status = new URL(req.url).searchParams.get('status') ?? 'active'
  if (!(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'status must be active, retired, or all' }, { status: 400 })
  }

  let query = gate.authedClient
    .from('ms_interested_parties')
    .select('*')
    .eq('tenant_id', gate.tenantId)
    .in('discipline', registerDisciplines('ems'))
  if (status === 'active')  query = query.is('retired_at', null)
  if (status === 'retired') query = query.not('retired_at', 'is', null)

  const { data, error } = await query.order('name')
  if (error) return sanitizeError(error, 'environmental/interested-parties/GET')
  return NextResponse.json({ parties: data ?? [] })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const parsed = interestedPartyInputFrom({ ...body, discipline: body.discipline ?? 'ems' })
  if (!parsed.ok) return invalidInput(parsed.errors)
  const { discipline, name, needsExpectations, becomesObligation, obligationId } = parsed.input

  const { data, error } = await gate.authedClient
    .from('ms_interested_parties')
    .insert({
      tenant_id:          gate.tenantId,
      discipline,
      name,
      needs_expectations: needsExpectations,
      becomes_obligation: becomesObligation,
      obligation_id:      obligationId,
      created_by:         gate.userId,
      updated_by:         gate.userId,
    })
    .select('*')
    .single()
  if (error?.code === '23503') return unknownObligation()
  if (error) return sanitizeError(error, 'environmental/interested-parties/POST')
  return NextResponse.json({ party: data }, { status: 201 })
}
