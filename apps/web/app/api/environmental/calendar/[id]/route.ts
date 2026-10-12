import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { LIBRARY_CATEGORY } from '@soteria/core/environmental/calendarPlan'
import { parseDeadlineRow, toDeadlineRow, validateDeadline } from '@soteria/core/environmental/deadlines'
import { badId, invalid, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { isActiveMember, OWNER_NOT_MEMBER } from '@/lib/environmental/members'

// Edit one environmental deadline (tenant admins): its owner, date, reminder
// window, or status (dismiss / reopen). A deadline stays on its site, so
// facility_id in the body is ignored. Only environmental deadlines are reachable
// here; the general compliance calendar has its own admin screen.

export const runtime = 'nodejs'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const { facility_id: _ignored, ...changes } = (typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body)
    ? parsed.body : {}) as Record<string, unknown>

  try {
    const { data: existing, error: readError } = await g.authedClient.from('compliance_calendar_obligations')
      .select('*').eq('tenant_id', g.tenantId).eq('category', LIBRARY_CATEGORY).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'PATCH /api/environmental/calendar/[id]')
    if (!existing) return notFound()

    const result = validateDeadline(changes, parseDeadlineRow(existing))
    if (!result.ok) return invalid(result.errors)
    const { ownerUserId } = result.deadline
    if (ownerUserId && ownerUserId !== existing.owner_user_id && !(await isActiveMember(g.tenantId, ownerUserId))) {
      return invalid([OWNER_NOT_MEMBER])
    }

    const { data, error } = await g.authedClient.from('compliance_calendar_obligations')
      .update({ ...toDeadlineRow(result.deadline), updated_at: new Date().toISOString() })
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').single()
    if (error) return sanitizeError(error, 'PATCH /api/environmental/calendar/[id]')
    return Response.json({ obligation: data })
  } catch (e) {
    return sanitizeError(e, 'PATCH /api/environmental/calendar/[id]')
  }
}
