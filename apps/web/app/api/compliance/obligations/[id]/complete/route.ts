import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { advanceDueDate, type ObligationCadence } from '@soteria/core/complianceCalendar'

// Mark a compliance obligation done: log a completion event, then either
// close it (cadence='once') or roll its next_due_at forward by the cadence.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body OK */ }
  const evidenceId = typeof body.evidence_id === 'string' ? body.evidence_id : null
  const note = typeof body.note === 'string' ? body.note : null

  try {
    const { data: ob, error: loadErr } = await g.authedClient
      .from('compliance_calendar_obligations')
      .select('id, cadence, cadence_days, next_due_at, status')
      .eq('id', id)
      .maybeSingle()
    if (loadErr) return sanitizeError(loadErr, 'POST /api/compliance/obligations/[id]/complete')
    if (!ob) return Response.json({ error: 'not_found' }, { status: 404 })

    const { error: evErr } = await g.authedClient.from('compliance_calendar_events').insert({
      tenant_id:     g.tenantId,
      obligation_id: ob.id as string,
      occurrence_at: ob.next_due_at as string,
      completed_by:  g.userId,
      evidence_id:   evidenceId,
      note,
    })
    if (evErr) return sanitizeError(evErr, 'POST /api/compliance/obligations/[id]/complete')

    const cadence = ob.cadence as ObligationCadence
    const update = cadence === 'once'
      ? { status: 'completed', updated_at: new Date().toISOString() }
      : {
          next_due_at: advanceDueDate(ob.next_due_at as string, cadence, ob.cadence_days as number | null),
          status: 'open',
          updated_at: new Date().toISOString(),
        }

    const { data, error } = await g.authedClient
      .from('compliance_calendar_obligations').update(update).eq('id', ob.id as string).select('*').single()
    if (error) return sanitizeError(error, 'POST /api/compliance/obligations/[id]/complete')
    return Response.json({ obligation: data })
  } catch (e) {
    return sanitizeError(e, 'POST /api/compliance/obligations/[id]/complete')
  }
}
