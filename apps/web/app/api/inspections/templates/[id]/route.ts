import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// Template detail (with items) + delete. Admin-only.

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })
  try {
    const { data: template, error } = await g.authedClient
      .from('inspection_templates').select('*').eq('id', id).maybeSingle()
    if (error) return sanitizeError(error, 'GET /api/inspections/templates/[id]')
    if (!template) return Response.json({ error: 'not_found' }, { status: 404 })
    const { data: items, error: iErr } = await g.authedClient
      .from('inspection_template_items').select('*').eq('template_id', id).order('sort_order', { ascending: true })
    if (iErr) return sanitizeError(iErr, 'GET /api/inspections/templates/[id]')
    return Response.json({ template, items: items ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/inspections/templates/[id]')
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })
  try {
    // Soft-disable rather than hard-delete so existing inspections keep their
    // template reference (FK is restrict).
    const { data, error } = await g.authedClient
      .from('inspection_templates').update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id).select('id').maybeSingle()
    if (error) return sanitizeError(error, 'DELETE /api/inspections/templates/[id]')
    if (!data) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (e) {
    return sanitizeError(e, 'DELETE /api/inspections/templates/[id]')
  }
}
