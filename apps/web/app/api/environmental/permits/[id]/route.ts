import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { parsePermitRow, toPermitRow, validatePermit } from '@soteria/core/environmental/permits'
import { badId, invalid, notFound, PG_UNIQUE_VIOLATION, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { dismissPermitRenewal, syncPermitRenewal, type SyncablePermit } from '@/lib/environmental/permitSync'

// Edit or remove one permit (tenant admins). A permit belongs to one site for
// life, so facility_id in the body is ignored on edit; its renewal deadline on
// the calendar follows the edit.

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
    const { data: existing, error: readError } = await g.authedClient.from('environmental_permits')
      .select('*').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'PATCH /api/environmental/permits/[id]')
    if (!existing) return notFound()

    const result = validatePermit(changes, { documentPathPrefix: `${g.tenantId}/`, current: parsePermitRow(existing) })
    if (!result.ok) return invalid(result.errors)

    const { data, error } = await g.authedClient.from('environmental_permits')
      .update({ ...toPermitRow(result.permit), updated_by: g.userId, updated_at: new Date().toISOString() })
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').single()
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return Response.json({ error: 'duplicate_permit_number', details: ['This site already has a permit with that number for this program.'] }, { status: 409 })
    }
    if (error) return sanitizeError(error, 'PATCH /api/environmental/permits/[id]')

    await syncPermitRenewal(g.authedClient, { tenantId: g.tenantId, userId: g.userId }, data as SyncablePermit)
    return Response.json({ permit: data })
  } catch (e) {
    return sanitizeError(e, 'PATCH /api/environmental/permits/[id]')
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  try {
    const { data: existing, error: readError } = await g.authedClient.from('environmental_permits')
      .select('id, facility_id').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'DELETE /api/environmental/permits/[id]')
    if (!existing) return notFound()

    const { error } = await g.authedClient.from('environmental_permits').delete().eq('tenant_id', g.tenantId).eq('id', id)
    if (error) return sanitizeError(error, 'DELETE /api/environmental/permits/[id]')

    await dismissPermitRenewal(g.authedClient, { tenantId: g.tenantId }, { id, facility_id: existing.facility_id as string })
    return Response.json({ ok: true })
  } catch (e) {
    return sanitizeError(e, 'DELETE /api/environmental/permits/[id]')
  }
}
