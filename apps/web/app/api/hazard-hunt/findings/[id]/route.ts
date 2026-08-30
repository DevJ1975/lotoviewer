import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// PATCH /api/hazard-hunt/findings/[id]
// Moves a finding through its non-escalation lifecycle: open → in_progress →
// closed. (Escalation to a risk is a separate, idempotent action on
// .../escalate.) Closing stamps closed_at, which — like escalation — counts the
// finding as "resolved" for the proactive EHS indicator.

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PATCHABLE_STATUSES = ['open', 'in_progress', 'closed'] as const

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }

  const status = body.status
  if (typeof status !== 'string' || !(PATCHABLE_STATUSES as readonly string[]).includes(status)) {
    return Response.json({ error: `status must be one of ${PATCHABLE_STATUSES.join(', ')}` }, { status: 400 })
  }

  const patch: { status: string; closed_at: string | null } = {
    status,
    closed_at: status === 'closed' ? new Date().toISOString() : null,
  }

  try {
    const { data, error } = await g.authedClient
      .from('hazard_hunt_findings')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', g.tenantId)
      .select('id, finding_number, status, closed_at')
      .maybeSingle()
    if (error) return sanitizeError(error, 'PATCH /api/hazard-hunt/findings/[id]')
    if (!data) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ finding: data })
  } catch (e) {
    return sanitizeError(e, 'PATCH /api/hazard-hunt/findings/[id]')
  }
}
