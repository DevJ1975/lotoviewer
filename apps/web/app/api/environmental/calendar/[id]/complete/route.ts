import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { LIBRARY_CATEGORY } from '@soteria/core/environmental/calendarPlan'
import { badId, invalid, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'

// Mark one occurrence of an environmental deadline done, without a checklist
// (a filed report, a paid fee). Tenant admins, or the person the deadline is
// assigned to, may do it.
//
// The work is done by env_complete_obligation() (migration 315), in one database
// transaction: it decides who may complete the deadline, refuses a stale due date
// (so a second click cannot skip a period), records the completion and moves the
// deadline on, keeping a period-end deadline on period ends. This route only
// checks the shape of the request and translates the function's answers, so the
// rules live in exactly one place, shared with the checklist path.

export const runtime = 'nodejs'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_NOTE = 2000

const NO_DATA_FOUND = 'P0002'
const CHECK_VIOLATION = '23514'

/** The function's refusals that a person can act on, mapped to the codes the screens already understand. */
function refusal(message: string) {
  if (message.startsWith('The occurrence due on')) {
    return Response.json({ error: 'stale', details: ['This deadline has already moved on. Refresh to see its current due date.'] }, { status: 409 })
  }
  if (message.startsWith('This deadline is')) return Response.json({ error: 'not_open' }, { status: 409 })
  return Response.json({ error: 'cannot_complete', details: [message] }, { status: 409 })
}

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

  const deadline = () => g.authedClient.from('compliance_calendar_obligations')
    .select('*').eq('tenant_id', g.tenantId).eq('category', LIBRARY_CATEGORY).eq('id', id).maybeSingle()

  try {
    // This route completes the suite's own deadlines; the function would complete any deadline the caller may.
    const { data: before, error: readError } = await deadline()
    if (readError) return sanitizeError(readError, 'POST /api/environmental/calendar/[id]/complete')
    if (!before) return notFound()

    const { error } = await g.authedClient.rpc('env_complete_obligation', {
      p_obligation_id: id,
      p_due_on:        occurrenceAt,
      p_note:          typeof note === 'string' ? note : null,
      p_evidence_id:   typeof evidence === 'string' ? evidence : null,
      p_inspection_id: null,
    })
    if (error?.code === NO_DATA_FOUND) return notFound()
    if (error?.code === CHECK_VIOLATION) return refusal(error.message)
    if (error) return sanitizeError(error, 'POST /api/environmental/calendar/[id]/complete')

    const { data: after, error: afterError } = await deadline()
    if (afterError) return sanitizeError(afterError, 'POST /api/environmental/calendar/[id]/complete')
    return Response.json({ obligation: after })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/calendar/[id]/complete')
  }
}
