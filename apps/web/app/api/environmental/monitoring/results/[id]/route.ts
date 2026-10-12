import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { parseResultRow, toResultRow, validateMonitoringResult } from '@soteria/core/environmental/monitoring'
import { badId, invalid, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { databaseFailure } from '@/lib/environmental/monitoringHttp'
import { offSiteMonitoringReferences } from '@/lib/environmental/monitoringReferences'

// Correct or remove one sample result (tenant admins only). A result is a record of what a
// laboratory reported: the person who recorded it cannot change it afterwards, and a change
// by an admin is kept in the audit log. A result belongs to one site for life, so facility_id
// in the body is ignored, and who sampled it is not something an edit can change.

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
    const { data: existing, error: readError } = await g.authedClient.from('monitoring_results')
      .select('*').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'PATCH /api/environmental/monitoring/results/[id]')
    if (!existing) return notFound()

    const result = validateMonitoringResult(changes, {
      nowMs: Date.now(), evidencePathPrefix: `${g.tenantId}/`, current: parseResultRow(existing),
    })
    if (!result.ok) return invalid(result.errors)

    const offSite = await offSiteMonitoringReferences(g.authedClient, g.tenantId, result.result)
    if (offSite.length > 0) return invalid(offSite)

    const { data, error } = await g.authedClient.from('monitoring_results')
      .update(toResultRow(result.result))
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').single()
    if (error) return databaseFailure(error, 'PATCH /api/environmental/monitoring/results/[id]')

    return Response.json({ result: data })
  } catch (e) {
    return databaseFailure(e, 'PATCH /api/environmental/monitoring/results/[id]')
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  try {
    const { data: existing, error: readError } = await g.authedClient.from('monitoring_results')
      .select('id').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'DELETE /api/environmental/monitoring/results/[id]')
    if (!existing) return notFound()

    const { error } = await g.authedClient.from('monitoring_results').delete().eq('tenant_id', g.tenantId).eq('id', id)
    if (error) return databaseFailure(error, 'DELETE /api/environmental/monitoring/results/[id]')

    return Response.json({ ok: true })
  } catch (e) {
    return databaseFailure(e, 'DELETE /api/environmental/monitoring/results/[id]')
  }
}
