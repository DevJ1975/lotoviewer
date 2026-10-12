import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { UUID_PATTERN } from '@soteria/core/environmental/validation'
import { defaultLimitsFor } from '@soteria/core/environmental/monitoringDefaults'
import { facilityRequired, invalid, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { adoptDefaultLimits } from '@/lib/environmental/monitoringAdopt'
import { databaseFailure } from '@/lib/environmental/monitoringHttp'
import { offSiteMonitoringReferences } from '@/lib/environmental/monitoringReferences'
import { loadSiteContext } from '@/lib/environmental/siteContext'

// Adopt draft default limits for the active site (tenant admins). Adopting is explicit: the
// body names the rows chosen, and only rows the site's own profile offers can be named, so a
// request cannot label a number of its own as coming from the library. Rows land as library
// limits and keep their verify note. Adopting what is already there changes nothing.

export const runtime = 'nodejs'

const MAX_KEYS = 50

export async function POST(req: Request) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}) as Record<string, unknown>

  const errors: string[] = []
  const keys = Array.isArray(body.keys) && body.keys.length > 0 && body.keys.length <= MAX_KEYS && body.keys.every(k => typeof k === 'string' && k.length <= 80)
    ? [...new Set(body.keys as string[])]
    : (errors.push(`keys must list between 1 and ${MAX_KEYS} default limits to adopt.`), [])
  const outfallId = body.outfall_id === undefined || body.outfall_id === null || body.outfall_id === '' ? null : body.outfall_id
  if (outfallId !== null && !(typeof outfallId === 'string' && UUID_PATTERN.test(outfallId))) errors.push('outfall_id must be an id.')
  const facilityId = body.facility_id === undefined ? g.facilityId : body.facility_id
  if (facilityId === null) return facilityRequired()
  if (typeof facilityId !== 'string' || !UUID_RE.test(facilityId)) errors.push('facility_id must be an id.')
  if (errors.length > 0) return invalid(errors)

  const site = facilityId as string
  const outfall = outfallId === null ? null : (outfallId as string).toLowerCase()

  try {
    const context = await loadSiteContext(g.authedClient, site)
    if (!context) return notFound()

    const offered = defaultLimitsFor(context.jurisdiction.chain, context.profile)
    const chosen = offered.filter(limit => keys.includes(limit.libraryKey))
    const unknown = keys.filter(key => !offered.some(limit => limit.libraryKey === key))
    if (unknown.length > 0) return invalid([`Not a default available for this site: ${unknown.join(', ')}.`])

    const offSite = await offSiteMonitoringReferences(g.authedClient, g.tenantId, { facilityId: site, outfallId: outfall })
    if (offSite.length > 0) return invalid(offSite)

    const result = await adoptDefaultLimits(g.authedClient, { tenantId: g.tenantId, facilityId: site, outfallId: outfall, userId: g.userId }, chosen)
    return Response.json({ created: result.created.length, already_there: result.alreadyThere, limits: result.created })
  } catch (e) {
    return databaseFailure(e, 'POST /api/environmental/monitoring/limits/adopt-defaults')
  }
}
