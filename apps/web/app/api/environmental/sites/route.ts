import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { refused } from '@/lib/environmental/http'
import { siteSummary } from '@/lib/environmental/siteView'

// The tenant's sites as the environmental module sees them: where each is, which
// library applies to it, and which programs are in scope. This is the roll-up
// table, so it lists every site regardless of the active-site selection.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  try {
    const [facilities, profiles] = await Promise.all([
      g.authedClient.from('facilities').select('id, name, state, is_primary, settings').eq('tenant_id', g.tenantId).order('name', { ascending: true }),
      g.authedClient.from('environmental_site_profiles').select('*').eq('tenant_id', g.tenantId),
    ])
    if (facilities.error) return sanitizeError(facilities.error, 'GET /api/environmental/sites')
    if (profiles.error) return sanitizeError(profiles.error, 'GET /api/environmental/sites')

    const profileByFacility = new Map((profiles.data ?? []).map(p => [p.facility_id as string, p as Record<string, unknown>]))
    return Response.json({
      sites: (facilities.data ?? []).map(f => siteSummary(f as Record<string, unknown>, profileByFacility.get(f.id as string) ?? null)),
    })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/sites')
  }
}
