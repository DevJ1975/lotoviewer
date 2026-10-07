import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { advanceDueDate, type ObligationCadence } from '@soteria/core/complianceCalendar'
import { LIBRARY_CATEGORY } from '@soteria/core/environmental/calendarPlan'
import { badId, invalid, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'

// Mark one occurrence of an environmental deadline done, without a checklist
// (a filed report, a paid fee). Tenant admins, or the person the deadline is
// assigned to, may do it.
//
// The caller names the due date they are completing. If the deadline has moved
// since they loaded the page, someone else completed it first, and completing
// again would skip a period: the request is refused as stale instead. The
// advance is also conditional on that date, so two simultaneous clicks cannot
// both succeed.

export const runtime = 'nodejs'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_NOTE = 2000
const ADMIN_ROLES = ['owner', 'admin', 'superadmin']

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as Record<string, unknown>
  const occurrenceAt = body.occurrence_at
  const note = body.note
  const evidence = body.evidence_id
  const problems: string[] = []
  if (typeof occurrenceAt !== 'string' || !ISO_DATE.test(occurrenceAt)) problems.push('occurrence_at is required: the due date you are completing, like 2026-12-31.')
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_NOTE)) problems.push(`note must be text of at most ${MAX_NOTE} characters.`)
  if (evidence !== undefined && evidence !== null
      && (typeof evidence !== 'string' || !evidence.startsWith(`${g.tenantId}/`) || evidence.includes('..') || evidence.length > 300)) {
    problems.push('evidence_id must be a file you uploaded to this account.')
  }
  if (problems.length > 0) return invalid(problems)

  try {
    const { data: ob, error: readError } = await g.authedClient.from('compliance_calendar_obligations')
      .select('id, status, cadence, cadence_days, next_due_at, due_anchor, owner_user_id')
      .eq('tenant_id', g.tenantId).eq('category', LIBRARY_CATEGORY).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'POST /api/environmental/calendar/[id]/complete')
    if (!ob) return notFound()

    if (!ADMIN_ROLES.includes(g.role) && ob.owner_user_id !== g.userId) {
      return Response.json({ error: 'owner_or_admin_required', details: ['Only an admin or the person this deadline is assigned to can complete it.'] }, { status: 403 })
    }
    if (ob.status !== 'open') return Response.json({ error: 'not_open' }, { status: 409 })
    if (ob.next_due_at !== occurrenceAt) {
      return Response.json({ error: 'stale', details: ['This deadline has already moved on. Refresh to see its current due date.'], next_due_at: ob.next_due_at }, { status: 409 })
    }

    const cadence = ob.cadence as ObligationCadence
    const update = cadence === 'once'
      ? { status: 'completed' }
      : { next_due_at: advanceDueDate(ob.next_due_at as string, cadence, ob.cadence_days as number | null, { clampToMonthEnd: ob.due_anchor === 'period_end' }) }

    // The conditional update is the lock: only one caller moves the deadline off this date.
    const { data: moved, error: moveError } = await g.authedClient.from('compliance_calendar_obligations')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('tenant_id', g.tenantId).eq('id', id).eq('next_due_at', occurrenceAt as string).eq('status', 'open')
      .select('*')
    if (moveError) return sanitizeError(moveError, 'POST /api/environmental/calendar/[id]/complete')
    if (!moved || moved.length === 0) return Response.json({ error: 'stale', details: ['Someone else just completed this deadline.'] }, { status: 409 })

    const { error: eventError } = await g.authedClient.from('compliance_calendar_events').insert({
      tenant_id: g.tenantId, obligation_id: id, occurrence_at: occurrenceAt, completed_by: g.userId,
      evidence_id: typeof evidence === 'string' ? evidence : null, note: typeof note === 'string' ? note.trim() || null : null,
    })
    if (eventError) {
      // A completion with no record is worse than none: put the deadline back.
      await g.authedClient.from('compliance_calendar_obligations')
        .update({ next_due_at: occurrenceAt, status: 'open', updated_at: new Date().toISOString() }).eq('tenant_id', g.tenantId).eq('id', id)
      return sanitizeError(eventError, 'POST /api/environmental/calendar/[id]/complete')
    }
    return Response.json({ obligation: moved[0] })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/calendar/[id]/complete')
  }
}
