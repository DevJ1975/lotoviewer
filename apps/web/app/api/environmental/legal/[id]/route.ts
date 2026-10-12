import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { parseLegalRow, toLegalRow, validateLegalEntry } from '@soteria/core/environmental/legalRegister'
import { badId, invalid, notFound, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { isActiveMember, OWNER_NOT_MEMBER } from '@/lib/environmental/members'

// Edit or remove one register entry (tenant admins). An edit changes the
// descriptive fields only: the rating goes through /evaluate and the review date
// through /review. An entry stays on its site unless the body names another.

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const LIBRARY_DELETE_WARNING = 'This entry came from the library. Applying the library again will bring it back.'

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const changes = typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}

  try {
    const { data: existing, error: readError } = await g.authedClient.from('legal_register')
      .select('*').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'PATCH /api/environmental/legal/[id]')
    if (!existing) return notFound()

    const result = validateLegalEntry(changes, { evidencePathPrefix: `${g.tenantId}/`, current: parseLegalRow(existing) })
    if (!result.ok) return invalid(result.errors)
    const { ownerUserId } = result.entry
    if (ownerUserId && ownerUserId !== existing.owner_user_id && !(await isActiveMember(g.tenantId, ownerUserId))) {
      return invalid([OWNER_NOT_MEMBER])
    }

    const { data, error } = await g.authedClient.from('legal_register')
      .update(toLegalRow(result.entry))
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').single()
    // Moving a library entry to a site that already has it collides on the library key.
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return Response.json({ error: 'duplicate_entry', details: ['This requirement is already in the register for that site.'] }, { status: 409 })
    }
    if (error?.code === PG_FOREIGN_KEY_VIOLATION) {
      return Response.json({ error: 'reference_not_found', details: ['The site or owner you chose is not part of this account.'] }, { status: 404 })
    }
    if (error) return sanitizeError(error, 'PATCH /api/environmental/legal/[id]')

    return Response.json({ entry: data })
  } catch (e) {
    return sanitizeError(e, 'PATCH /api/environmental/legal/[id]')
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  try {
    const { data: existing, error: readError } = await g.authedClient.from('legal_register')
      .select('id, source').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'DELETE /api/environmental/legal/[id]')
    if (!existing) return notFound()

    const { error } = await g.authedClient.from('legal_register').delete().eq('tenant_id', g.tenantId).eq('id', id)
    if (error) return sanitizeError(error, 'DELETE /api/environmental/legal/[id]')

    // The library is the source of a library entry, so it can put the entry back.
    return Response.json(existing.source === 'library' ? { ok: true, warning: LIBRARY_DELETE_WARNING } : { ok: true })
  } catch (e) {
    return sanitizeError(e, 'DELETE /api/environmental/legal/[id]')
  }
}
