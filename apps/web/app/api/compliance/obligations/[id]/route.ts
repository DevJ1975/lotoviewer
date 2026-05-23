import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// Update / delete a single compliance obligation. Admin-only, tenant-scoped.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description
  if (typeof body.regulatory_ref === 'string' || body.regulatory_ref === null) patch.regulatory_ref = body.regulatory_ref
  if (typeof body.owner_user_id === 'string' || body.owner_user_id === null) patch.owner_user_id = body.owner_user_id
  if (typeof body.site_label === 'string' || body.site_label === null) patch.site_label = body.site_label
  if (typeof body.next_due_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.next_due_at)) patch.next_due_at = body.next_due_at
  if (body.status === 'open' || body.status === 'completed' || body.status === 'dismissed') patch.status = body.status

  try {
    const { data, error } = await g.authedClient
      .from('compliance_obligations').update(patch).eq('id', id).select('*').maybeSingle()
    if (error) return sanitizeError(error, 'PATCH /api/compliance/obligations/[id]')
    if (!data) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ obligation: data })
  } catch (e) {
    return sanitizeError(e, 'PATCH /api/compliance/obligations/[id]')
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })

  try {
    const { error } = await g.authedClient.from('compliance_obligations').delete().eq('id', id)
    if (error) return sanitizeError(error, 'DELETE /api/compliance/obligations/[id]')
    return Response.json({ ok: true })
  } catch (e) {
    return sanitizeError(e, 'DELETE /api/compliance/obligations/[id]')
  }
}
