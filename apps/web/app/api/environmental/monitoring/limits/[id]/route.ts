import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { parseLimitRow, toLimitRow, validateMonitoringLimit } from '@soteria/core/environmental/monitoring'
import { badId, invalid, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { databaseFailure } from '@/lib/environmental/monitoringHttp'
import { offSiteMonitoringReferences } from '@/lib/environmental/monitoringReferences'

// Edit or remove one limit (tenant admins). A limit belongs to one site for life, so
// facility_id in the body is ignored on edit, and where a limit came from (the library or a
// person) is not something an edit can change.

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const { facility_id: _ignored, ...changes } = (typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body)
    ? parsed.body : {}) as Record<string, unknown>

  try {
    const { data: existing, error: readError } = await g.authedClient.from('monitoring_limits')
      .select('*').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'PATCH /api/environmental/monitoring/limits/[id]')
    if (!existing) return notFound()

    const result = validateMonitoringLimit(changes, { current: parseLimitRow(existing) })
    if (!result.ok) return invalid(result.errors)

    const offSite = await offSiteMonitoringReferences(g.authedClient, g.tenantId, result.limit)
    if (offSite.length > 0) return invalid(offSite)

    const { data, error } = await g.authedClient.from('monitoring_limits')
      .update(toLimitRow(result.limit))
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').single()
    if (error) return databaseFailure(error, 'PATCH /api/environmental/monitoring/limits/[id]')

    return Response.json({ limit: data })
  } catch (e) {
    return databaseFailure(e, 'PATCH /api/environmental/monitoring/limits/[id]')
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  try {
    const { data: existing, error: readError } = await g.authedClient.from('monitoring_limits')
      .select('id').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'DELETE /api/environmental/monitoring/limits/[id]')
    if (!existing) return notFound()

    const { error } = await g.authedClient.from('monitoring_limits').delete().eq('tenant_id', g.tenantId).eq('id', id)
    if (error) return databaseFailure(error, 'DELETE /api/environmental/monitoring/limits/[id]')

    return Response.json({ ok: true })
  } catch (e) {
    return databaseFailure(e, 'DELETE /api/environmental/monitoring/limits/[id]')
  }
}
