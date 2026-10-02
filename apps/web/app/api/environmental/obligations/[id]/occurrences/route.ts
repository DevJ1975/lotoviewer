import { NextResponse } from 'next/server'
import { isCalendarDate } from '@soteria/core/managementSystem'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  EMS_DISCIPLINES,
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  gateFailure,
  invalidInput,
  invalidJson,
  notFound,
  optionalText,
  readJsonObject,
  text,
  type RouteContext,
} from '@/lib/environmental/registerApi'
import { EVIDENCE_PUBLIC_COLUMNS } from '@/lib/environmental/evidence'

// GET  /api/environmental/obligations/[id]/occurrences   Each time the obligation was done,
//                                                         newest first, with its evidence.
// POST /api/environmental/obligations/[id]/occurrences   { due_on, note? }   Record that the
//   occurrence due on due_on was done; the due date moves on by the obligation's cadence
//   (plan D5). The obligation's owner or an admin may record it: ms_record_obligation_occurrence()
//   decides, so the rule lives in one place. due_on must be the date still due, so a second
//   click cannot complete the next period. Evidence attaches to the returned occurrence.

const NOTE_MAX = 2000

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const [obligation, events] = await Promise.all([
    gate.authedClient.from('compliance_calendar_obligations').select('id')
      .eq('id', id).eq('tenant_id', gate.tenantId).in('discipline', EMS_DISCIPLINES).maybeSingle(),
    gate.authedClient.from('compliance_calendar_events')
      .select('id, obligation_id, occurrence_at, completed_at, completed_by, note')
      .eq('obligation_id', id).eq('tenant_id', gate.tenantId)
      .order('completed_at', { ascending: false }).limit(200),
  ])
  const failed = obligation.error ?? events.error
  if (failed) return sanitizeError(failed, 'environmental/obligations/[id]/occurrences/GET')
  if (!obligation.data) return notFound()

  const eventIds = (events.data ?? []).map(event => (event as { id: string }).id)
  let evidence: unknown[] = []
  if (eventIds.length > 0) {
    const { data, error } = await gate.authedClient
      .from('ms_evidence')
      .select(EVIDENCE_PUBLIC_COLUMNS)
      .eq('tenant_id', gate.tenantId)
      .eq('subject_type', 'compliance_calendar_event')
      .in('subject_id', eventIds)
      .order('uploaded_at', { ascending: false })
    if (error) return sanitizeError(error, 'environmental/obligations/[id]/occurrences/GET evidence')
    evidence = data ?? []
  }
  return NextResponse.json({ occurrences: events.data ?? [], evidence })
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const dueOn = text(body.due_on)
  const note = optionalText(body.note)
  const errors = [
    ...(isCalendarDate(dueOn) ? [] : [{ field: 'dueOn', message: 'is required: the date this occurrence was due (YYYY-MM-DD)' }]),
    ...(note !== null && note.length > NOTE_MAX ? [{ field: 'note', message: `must be at most ${NOTE_MAX} characters` }] : []),
  ]
  if (errors.length > 0) return invalidInput(errors)

  const { data, error } = await gate.authedClient.rpc('ms_record_obligation_occurrence', {
    p_obligation_id: id,
    p_due_on:        dueOn,
    p_note:          note,
  })
  const code = (error as { code?: string } | null)?.code
  // Not found, or not the caller's to record: the function answers both the same way.
  if (code === 'P0002') return notFound()
  // The function's own refusals are written for people: already recorded, or not open.
  if (code === '23514') return NextResponse.json({ error: (error as { message: string }).message }, { status: 409 })
  if (error) return sanitizeError(error, 'environmental/obligations/[id]/occurrences/POST')
  return NextResponse.json({ occurrence: { id: data as string, obligation_id: id, occurrence_at: dueOn } }, { status: 201 })
}
