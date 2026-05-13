import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { ZodError } from 'zod'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { obligationCompletionSchema } from '@/lib/compliance/validators'
import {
  advanceNextDueDate,
  type ObligationFrequency,
} from '@soteria/core/compliance'

// POST /api/compliance/obligations/[id]/complete
//
// Records a completion in the audit log and bumps the parent
// obligation's last_completed_at + next_due_date. Two-step write
// (insert completion, update obligation) — RLS ensures both happen
// in the caller's tenant. We don't wrap in an RPC because the
// completion log can survive even if the obligation update fails
// (worst case: an admin re-marks complete and the cadence catches
// up; never a data-integrity loss).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantModuleMember(req, 'compliance')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: unknown = {}
  if (req.headers.get('content-length') && req.headers.get('content-length') !== '0') {
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }

  let payload
  try { payload = obligationCompletionSchema.parse(body) }
  catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: e.issues }, { status: 400 })
    throw e
  }

  // Fetch the obligation to read frequency + frequency_days for cadence math.
  const { data: row, error: fetchErr } = await gate.authedClient
    .from('compliance_obligations')
    .select('id, frequency, frequency_days, not_applicable')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!row)     return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.not_applicable) {
    return NextResponse.json({ error: 'Cannot complete a not-applicable obligation' }, { status: 422 })
  }

  const completedAt = payload.completed_at ?? new Date().toISOString()

  // 1. Append the completion record.
  const { data: completion, error: insertErr } = await gate.authedClient
    .from('compliance_obligation_completions')
    .insert({
      obligation_id: id,
      tenant_id:     gate.tenantId,
      completed_at:  completedAt,
      completed_by:  gate.userId,
      notes:         payload.notes        ?? null,
      evidence_url:  payload.evidence_url ?? null,
    })
    .select('*')
    .single()
  if (insertErr) {
    Sentry.captureException(insertErr, { tags: { route: 'compliance/obligations/complete', stage: 'insert' } })
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // 2. Advance cadence on the parent obligation.
  const nextDue = advanceNextDueDate(
    row.frequency as ObligationFrequency,
    completedAt,
    (row.frequency_days as number | null) ?? null,
  )

  const update: Record<string, unknown> = {
    last_completed_at: completedAt,
    // Clear any active snooze — completing implies the admin has
    // engaged with the obligation, the snooze is moot.
    snoozed_until: null,
  }
  // For non-one-time cadences, push next_due_date forward. For
  // one_time, leave next_due_date untouched — the derived status
  // becomes 'completed' once last_completed_at is non-null.
  if (nextDue) update.next_due_date = nextDue

  const { data: updated, error: updateErr } = await gate.authedClient
    .from('compliance_obligations')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .single()
  if (updateErr) {
    Sentry.captureException(updateErr, { tags: { route: 'compliance/obligations/complete', stage: 'update' } })
    // Completion already logged; surface the error but the audit
    // entry remains. Operator can manually adjust next_due_date.
    return NextResponse.json({ error: updateErr.message, completion }, { status: 500 })
  }

  return NextResponse.json({ obligation: updated, completion })
}
