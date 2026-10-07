import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { classifyUrgency, daysUntilDue } from '@soteria/core/complianceCalendar'
import { LIBRARY_CATEGORY } from '@soteria/core/environmental/calendarPlan'
import { toDeadlineRow, validateDeadline } from '@soteria/core/environmental/deadlines'
import { badId, invalid, readJson, refused, UUID_RE } from '@/lib/environmental/http'

// The environmental compliance calendar: its deadlines (members read) and custom
// deadlines (tenant admins create). Library deadlines arrive through apply-library
// and permits; this lists them all together and adds the ones a site makes itself.

export const runtime = 'nodejs'

const STATUS_FILTERS = ['open', 'completed', 'dismissed', 'all'] as const

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const query = new URL(req.url).searchParams
  const requested = query.get('facility_id')
  if (requested && !UUID_RE.test(requested)) return badId()
  const facilityId = requested ?? g.facilityId
  const status = query.get('status') ?? 'open'
  if (!(STATUS_FILTERS as readonly string[]).includes(status)) return invalid([`status must be one of: ${STATUS_FILTERS.join(', ')}.`])
  const program = query.get('program')

  try {
    let q = g.authedClient.from('compliance_calendar_obligations').select('*')
      .eq('tenant_id', g.tenantId).eq('category', LIBRARY_CATEGORY)
    // A site's calendar also shows the deadlines shared by every site.
    if (facilityId) q = q.or(`facility_id.eq.${facilityId},facility_id.is.null`)
    if (status !== 'all') q = q.eq('status', status)
    if (program) q = q.eq('program', program)
    const { data, error } = await q.order('next_due_at', { ascending: true })
    if (error) return sanitizeError(error, 'GET /api/environmental/calendar')

    const rows = data ?? []
    const lastCompleted = new Map<string, string>()
    if (rows.length > 0) {
      const { data: events, error: eventsError } = await g.authedClient.from('compliance_calendar_events')
        .select('obligation_id, completed_at').eq('tenant_id', g.tenantId)
        .in('obligation_id', rows.map(r => r.id as string)).order('completed_at', { ascending: false })
      if (eventsError) return sanitizeError(eventsError, 'GET /api/environmental/calendar')
      for (const e of events ?? []) if (!lastCompleted.has(e.obligation_id as string)) lastCompleted.set(e.obligation_id as string, e.completed_at as string)
    }

    const now = new Date()
    const obligations = rows.map(r => ({
      ...r,
      urgency:       r.status === 'open' ? classifyUrgency(r.next_due_at as string, now, r.lead_days as number) : null,
      days_until:    r.status === 'open' ? daysUntilDue(r.next_due_at as string, now) : null,
      last_completed_at: lastCompleted.get(r.id as string) ?? null,
    }))
    return Response.json({ obligations })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/calendar')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const raw = typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}

  // The active site is the default; an explicit null makes it a deadline shared by every site.
  const result = validateDeadline({ facility_id: g.facilityId, ...raw })
  if (!result.ok) return invalid(result.errors)
  const { deadline } = result

  try {
    if (deadline.facilityId) {
      // The deadline's site column is a plain reference, so confirm the caller can see that site.
      const { data: site, error: siteError } = await g.authedClient.from('facilities').select('id').eq('id', deadline.facilityId).maybeSingle()
      if (siteError) return sanitizeError(siteError, 'POST /api/environmental/calendar')
      if (!site) return Response.json({ error: 'facility_not_found' }, { status: 404 })
    }

    const { data, error } = await g.authedClient.from('compliance_calendar_obligations')
      .insert({ tenant_id: g.tenantId, category: LIBRARY_CATEGORY, source: 'tenant', created_by: g.userId, ...toDeadlineRow(deadline) })
      .select('*').single()
    if (error) return sanitizeError(error, 'POST /api/environmental/calendar')
    return Response.json({ obligation: data }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/calendar')
  }
}
