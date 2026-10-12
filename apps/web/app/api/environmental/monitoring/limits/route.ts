import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { toLimitRow, validateMonitoringLimit } from '@soteria/core/environmental/monitoring'
import { badId, invalid, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { MAX_LIMITS } from '@/lib/environmental/monitoringFetch'
import { databaseFailure } from '@/lib/environmental/monitoringHttp'
import { offSiteMonitoringReferences } from '@/lib/environmental/monitoringReferences'

// Discharge limits: list (members) and create (tenant admins).
// The active site scopes the list; with no active site it is the roll-up.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const params = new URL(req.url).searchParams
  const requestedSite = params.get('facility_id')
  const outfallId = params.get('outfall_id')
  if ((requestedSite && !UUID_RE.test(requestedSite)) || (outfallId && !UUID_RE.test(outfallId))) return badId()
  const facilityId = requestedSite || g.facilityId

  try {
    let query = g.authedClient.from('monitoring_limits').select('*').eq('tenant_id', g.tenantId)
    if (facilityId) query = query.eq('facility_id', facilityId)
    if (outfallId) query = query.eq('outfall_id', outfallId)
    const { data, error } = await query
      .order('parameter', { ascending: true }).order('limit_kind', { ascending: true }).order('id', { ascending: true })
      .limit(MAX_LIMITS)
    if (error) return sanitizeError(error, 'GET /api/environmental/monitoring/limits')
    return Response.json({ limits: data ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/monitoring/limits')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const raw = typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}

  // The active site is the default, so a form on a site page need not repeat it.
  const result = validateMonitoringLimit({ facility_id: g.facilityId, ...raw })
  if (!result.ok) return invalid(result.errors)

  try {
    const offSite = await offSiteMonitoringReferences(g.authedClient, g.tenantId, result.limit)
    if (offSite.length > 0) return invalid(offSite)

    const { data, error } = await g.authedClient.from('monitoring_limits')
      .insert({ tenant_id: g.tenantId, created_by: g.userId, ...toLimitRow(result.limit) })
      .select('*').single()
    if (error) return databaseFailure(error, 'POST /api/environmental/monitoring/limits')

    return Response.json({ limit: data }, { status: 201 })
  } catch (e) {
    return databaseFailure(e, 'POST /api/environmental/monitoring/limits')
  }
}
