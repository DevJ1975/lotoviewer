import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// Inspections: list + start (a run of a template). Tenant members can run
// inspections; the 'inspections' module must be enabled for the tenant.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  try {
    const { data, error } = await g.authedClient
      .from('inspections')
      .select('id, title, template_id, status, result, score, max_score, due_at, started_at, submitted_at')
      .order('started_at', { ascending: false })
    if (error) return sanitizeError(error, 'GET /api/inspections')

    // Active templates for the "start an inspection" picker (members can read
    // tenant templates via RLS).
    const { data: templates } = await g.authedClient
      .from('inspection_templates')
      .select('id, name, category')
      .eq('active', true)
      .order('name', { ascending: true })

    return Response.json({ inspections: data ?? [], templates: templates ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/inspections')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }

  const templateId = typeof body.template_id === 'string' ? body.template_id : ''
  if (!templateId) return Response.json({ error: 'template_id_required' }, { status: 400 })

  try {
    const { data: tmpl, error: tErr } = await g.authedClient
      .from('inspection_templates').select('id, name, version, active').eq('id', templateId).maybeSingle()
    if (tErr) return sanitizeError(tErr, 'POST /api/inspections')
    if (!tmpl || tmpl.active === false) return Response.json({ error: 'template_not_found' }, { status: 404 })

    const { data, error } = await g.authedClient
      .from('inspections')
      .insert({
        tenant_id:        g.tenantId,
        template_id:      tmpl.id as string,
        template_version: tmpl.version as number,
        title:            typeof body.title === 'string' && body.title.trim() ? body.title.trim() : (tmpl.name as string),
        subject_type:     typeof body.subject_type === 'string' ? body.subject_type : null,
        subject_id:       typeof body.subject_id === 'string' ? body.subject_id : null,
        assignee_user_id: typeof body.assignee_user_id === 'string' ? body.assignee_user_id : null,
        due_at:           typeof body.due_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.due_at) ? body.due_at : null,
        status:           'in_progress',
        created_by:       g.userId,
      })
      .select('id')
      .single()
    if (error) return sanitizeError(error, 'POST /api/inspections')
    return Response.json({ id: data.id }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/inspections')
  }
}
