import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  emsDisciplineParam,
  gateFailure,
  invalidInput,
  invalidJson,
  nextVersion,
  readJsonObject,
  versionConflict,
} from '@/lib/environmental/registerApi'
import { scopeStatementInputFrom } from '@/lib/environmental/contextRegisters'

// GET  /api/environmental/scope?discipline=ems   The scope in force and every earlier version (clause 4.3).
// POST /api/environmental/scope                  Save a new version; versions are never edited. Admins only.

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const discipline = emsDisciplineParam(new URL(req.url).searchParams.get('discipline'))
  if (!discipline) return NextResponse.json({ error: 'discipline must be ems or integrated' }, { status: 400 })

  const { data, error } = await gate.authedClient
    .from('ms_scope_statements')
    .select('*')
    .eq('tenant_id', gate.tenantId)
    .eq('discipline', discipline)
    .order('version', { ascending: false })
  if (error) return sanitizeError(error, 'environmental/scope/GET')
  const versions = data ?? []
  return NextResponse.json({ current: versions[0] ?? null, versions })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const parsed = scopeStatementInputFrom({ ...body, discipline: body.discipline ?? 'ems' })
  if (!parsed.ok) return invalidInput(parsed.errors)
  const scope = parsed.input

  const next = await nextVersion(gate.authedClient, 'ms_scope_statements', gate.tenantId, scope.discipline)
  if (next.error) return sanitizeError(next.error, 'environmental/scope/POST version')

  const { data, error } = await gate.authedClient
    .from('ms_scope_statements')
    .insert({
      tenant_id:         gate.tenantId,
      discipline:        scope.discipline,
      version:           next.version,
      legal_entity:      scope.legalEntity,
      physical_boundary: scope.physicalBoundary,
      activities:        scope.activities,
      products_services: scope.productsServices,
      control_and_influence: scope.controlAndInfluence,
      exclusions:        scope.exclusions,
      effective_from:    scope.effectiveFrom,
      approved_by:       gate.userId,
    })
    .select('*')
    .single()
  if (error?.code === '23505') return versionConflict()
  if (error) return sanitizeError(error, 'environmental/scope/POST')
  return NextResponse.json({ scope: data }, { status: 201 })
}
