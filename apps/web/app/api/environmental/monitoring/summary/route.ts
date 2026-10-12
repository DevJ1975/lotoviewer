import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { badId, facilityRequired, notFound, refused, UUID_RE } from '@/lib/environmental/http'
import { fetchMonitoringSummary } from '@/lib/environmental/monitoringFetch'

// Where each limit of the active site stands in the current reporting year, and how many
// times each class of limit was exceeded. Permit-limit and benchmark exceedances come back in
// separate fields and are never added together. It needs one site: the reporting year and
// the limits that apply are the site's.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const requested = new URL(req.url).searchParams.get('facility_id')
  if (requested && !UUID_RE.test(requested)) return badId()
  const facilityId = requested || g.facilityId
  if (!facilityId) return facilityRequired()

  try {
    const view = await fetchMonitoringSummary(g.authedClient, { tenantId: g.tenantId, facilityId }, Date.now())
    if (!view) return notFound()
    return Response.json({
      summary:              view.summary,
      reporting_year_basis: { start_month: view.reportingYearBasis.startMonth, verify: view.reportingYearBasis.verify },
      truncated:            view.truncated,
    })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/monitoring/summary')
  }
}
