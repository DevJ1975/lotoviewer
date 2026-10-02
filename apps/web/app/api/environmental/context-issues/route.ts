import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { EMS_DISCIPLINES, ENVIRONMENTAL_MODULE, gateFailure, invalidInput, invalidJson, readJsonObject } from '@/lib/environmental/registerApi'
import { contextIssueInputFrom } from '@/lib/environmental/contextRegisters'

// GET  /api/environmental/context-issues   The context register (clause 4.1).
//                                          ?status=active (default) | retired | all
// POST /api/environmental/context-issues   Record an issue. Admins only.
//
// Issues are organization-wide in Phase 1, so facility_id stays null.

const STATUSES = ['active', 'retired', 'all'] as const

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const status = new URL(req.url).searchParams.get('status') ?? 'active'
  if (!(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'status must be active, retired, or all' }, { status: 400 })
  }

  let query = gate.authedClient
    .from('ms_context_issues')
    .select('*')
    .eq('tenant_id', gate.tenantId)
    .in('discipline', EMS_DISCIPLINES)
  if (status === 'active')  query = query.is('retired_at', null)
  if (status === 'retired') query = query.not('retired_at', 'is', null)

  const { data, error } = await query.order('kind').order('created_at')
  if (error) return sanitizeError(error, 'environmental/context-issues/GET')
  return NextResponse.json({ issues: data ?? [] })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const parsed = contextIssueInputFrom({ ...body, discipline: body.discipline ?? 'ems' })
  if (!parsed.ok) return invalidInput(parsed.errors)
  const { discipline, kind, description, relevance, effect } = parsed.input

  const { data, error } = await gate.authedClient
    .from('ms_context_issues')
    .insert({
      tenant_id:  gate.tenantId,
      discipline, kind, description, relevance, effect,
      created_by: gate.userId,
      updated_by: gate.userId,
    })
    .select('*')
    .single()
  if (error) return sanitizeError(error, 'environmental/context-issues/POST')
  return NextResponse.json({ issue: data }, { status: 201 })
}
