import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })
  try {
    const { error } = await g.authedClient.from('notification_rules').delete().eq('id', id)
    if (error) return sanitizeError(error, 'DELETE /api/admin/notifications/rules/[id]')
    return Response.json({ ok: true })
  } catch (e) {
    return sanitizeError(e, 'DELETE /api/admin/notifications/rules/[id]')
  }
}
