import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { parseOutfallRow, toOutfallRow, validateOutfall } from '@soteria/core/environmental/outfalls'
import { badId, invalid, notFound, PG_UNIQUE_VIOLATION, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { offSiteReferenceErrors } from '@/lib/environmental/outfallReferences'

// Edit or remove one outfall (tenant admins). An outfall belongs to one site for
// life, so facility_id in the body is ignored on edit.

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
    const { data: existing, error: readError } = await g.authedClient.from('stormwater_outfalls')
      .select('*').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'PATCH /api/environmental/outfalls/[id]')
    if (!existing) return notFound()

    const result = validateOutfall(changes, { photoPathPrefix: `${g.tenantId}/`, current: parseOutfallRow(existing) })
    if (!result.ok) return invalid(result.errors)

    // The table forbids it with a bare check violation; say what is wrong instead.
    if (result.outfall.substantiallyIdenticalTo === id) return invalid(['substantially_identical_to cannot be the outfall itself.'])
    const offSite = await offSiteReferenceErrors(g.authedClient, g.tenantId, result.outfall)
    if (offSite.length > 0) return invalid(offSite)

    const { data, error } = await g.authedClient.from('stormwater_outfalls')
      .update({ ...toOutfallRow(result.outfall), updated_by: g.userId, updated_at: new Date().toISOString() })
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').single()
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return Response.json({ error: 'duplicate_outfall_code', details: ['This site already has an outfall with that code.'] }, { status: 409 })
    }
    if (error) return sanitizeError(error, 'PATCH /api/environmental/outfalls/[id]')

    return Response.json({ outfall: data })
  } catch (e) {
    return sanitizeError(e, 'PATCH /api/environmental/outfalls/[id]')
  }
}

// Outfalls that name this one as their representative lose that link on their own:
// the foreign key sets it to null.
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  try {
    const { data: existing, error: readError } = await g.authedClient.from('stormwater_outfalls')
      .select('id').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'DELETE /api/environmental/outfalls/[id]')
    if (!existing) return notFound()

    const { error } = await g.authedClient.from('stormwater_outfalls').delete().eq('tenant_id', g.tenantId).eq('id', id)
    if (error) return sanitizeError(error, 'DELETE /api/environmental/outfalls/[id]')

    return Response.json({ ok: true })
  } catch (e) {
    return sanitizeError(e, 'DELETE /api/environmental/outfalls/[id]')
  }
}
