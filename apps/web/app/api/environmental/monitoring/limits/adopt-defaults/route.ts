import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { defaultLimitsFor } from '@soteria/core/environmental/monitoringDefaults'
import { invalid, notFound, readJson, refused } from '@/lib/environmental/http'
import { adoptDefaultLimits, parseAdoptRequest } from '@/lib/environmental/monitoringAdopt'
import { databaseFailure } from '@/lib/environmental/monitoringHttp'
import { offSiteMonitoringReferences } from '@/lib/environmental/monitoringReferences'
import { loadSiteContext } from '@/lib/environmental/siteContext'

// Adopt draft default limits for the active site (tenant admins). Adopting is explicit: the
// body names the rows chosen, and only rows the site's own profile offers can be named, so a
// request cannot label a number of its own as coming from the library. Rows land as library
// limits and keep their verify note. Adopting what is already there changes nothing.

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const request = parseAdoptRequest(parsed.body, g.facilityId)
  if (!request.ok) return invalid(request.errors)

  try {
    const site = await loadSiteContext(g.authedClient, request.facilityId)
    if (!site) return notFound()

    const offered = defaultLimitsFor(site.jurisdiction.chain, site.profile)
    const unavailable = request.keys.filter(key => !offered.some(limit => limit.libraryKey === key))
    if (unavailable.length > 0) return invalid([`Not a default available for this site: ${unavailable.join(', ')}.`])

    const offSite = await offSiteMonitoringReferences(g.authedClient, g.tenantId, { facilityId: request.facilityId, outfallId: request.outfallId })
    if (offSite.length > 0) return invalid(offSite)

    const result = await adoptDefaultLimits(
      g.authedClient,
      { tenantId: g.tenantId, facilityId: request.facilityId, outfallId: request.outfallId, userId: g.userId },
      offered.filter(limit => request.keys.includes(limit.libraryKey)),
    )
    return Response.json({ created: result.created.length, already_there: result.alreadyThere, limits: result.created })
  } catch (e) {
    return databaseFailure(e, 'POST /api/environmental/monitoring/limits/adopt-defaults')
  }
}
