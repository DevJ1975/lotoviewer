import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { isHazardHuntFindingStatus, type HazardHuntFindingStatus } from '@soteria/core/hazardHunt'

// GET /api/hazard-hunt/findings?status=open,in_progress&limit=200
// Lists the tenant's Hazard Hunt findings for the dashboard + escalation queue.
// Defaults to the still-actionable statuses (open + in_progress).

export const runtime = 'nodejs'
const DEFAULT_STATUSES: HazardHuntFindingStatus[] = ['open', 'in_progress']

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  const url = new URL(req.url)
  const requested = (url.searchParams.get('status') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const statuses = requested.filter(isHazardHuntFindingStatus)
  const effective = statuses.length > 0 ? statuses : DEFAULT_STATUSES
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '200', 10)))

  try {
    const { data, error } = await g.authedClient
      .from('hazard_hunt_findings')
      .select('id, finding_number, inspection_id, hazard_category, title, description, severity_hint, status, created_at')
      .eq('tenant_id', g.tenantId)
      .in('status', effective)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return sanitizeError(error, 'GET /api/hazard-hunt/findings')
    return Response.json({ findings: data ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/hazard-hunt/findings')
  }
}
