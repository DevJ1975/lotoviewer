import { requireTenantMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

// GET /api/environmental/health — is the Environmental (ISO 14001) module
// switched on for the caller's active tenant? Any member may ask. The answer
// is a 200 either way, unlike module-gated routes, which return 403 when the
// module is off. Read through the gate's RLS-scoped client: a member can
// only ever read their own tenant row.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return Response.json({ error: gate.message }, { status: gate.status })

  const { data: tenant, error } = await gate.authedClient
    .from('tenants').select('modules').eq('id', gate.tenantId).maybeSingle()
  if (error) return sanitizeError(error, 'GET /api/environmental/health')

  const modules = (tenant?.modules ?? null) as Record<string, boolean> | null
  return Response.json({ enabled: isModuleVisible('environmental', modules) })
}
