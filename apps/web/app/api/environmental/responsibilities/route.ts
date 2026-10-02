import { NextResponse } from 'next/server'
import { responsibilitiesHealth, responsibilityCoverage } from '@soteria/core/emsProcesses'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { ENVIRONMENTAL_MODULE, emsDisciplineParam, gateFailure } from '@/lib/environmental/registerApi'

// GET /api/environmental/responsibilities?discipline=ems   Who owns each process on the EMS
//   map (clause 4.4) and each role clause 5.3 assigns, with how much of the map is held.
//   The map itself is static: @soteria/core/emsProcesses.

interface ResponsibilityRow { responsibility_key: string; owner_user_id: string | null }

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const discipline = emsDisciplineParam(new URL(req.url).searchParams.get('discipline'))
  if (!discipline) return NextResponse.json({ error: 'discipline must be ems or integrated' }, { status: 400 })

  const { data, error } = await gate.authedClient
    .from('ms_responsibilities')
    .select('responsibility_key, owner_user_id, assigned_by, updated_at')
    .eq('tenant_id', gate.tenantId)
    .eq('discipline', discipline)
  if (error) return sanitizeError(error, 'environmental/responsibilities/GET')

  const responsibilities = data ?? []
  const held = new Set((responsibilities as ResponsibilityRow[]).filter(r => r.owner_user_id).map(r => r.responsibility_key))
  const coverage = responsibilityCoverage(held)
  return NextResponse.json({ responsibilities, coverage, health: responsibilitiesHealth(coverage) })
}
