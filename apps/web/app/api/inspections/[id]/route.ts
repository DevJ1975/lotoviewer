import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// Inspection detail: the run + its template items + saved responses.

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })
  try {
    const { data: inspection, error } = await g.authedClient
      .from('inspections').select('*').eq('id', id).maybeSingle()
    if (error) return sanitizeError(error, 'GET /api/inspections/[id]')
    if (!inspection) return Response.json({ error: 'not_found' }, { status: 404 })

    const { data: items, error: iErr } = await g.authedClient
      .from('inspection_template_items')
      .select('*').eq('template_id', inspection.template_id as string).order('sort_order', { ascending: true })
    if (iErr) return sanitizeError(iErr, 'GET /api/inspections/[id]')

    const { data: responses, error: rErr } = await g.authedClient
      .from('inspection_responses').select('*').eq('inspection_id', id)
    if (rErr) return sanitizeError(rErr, 'GET /api/inspections/[id]')

    return Response.json({ inspection, items: items ?? [], responses: responses ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/inspections/[id]')
  }
}
