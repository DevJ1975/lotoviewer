import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { ZodError } from 'zod'
import { requireTenantModuleMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { obligationUpdateSchema } from '@/lib/compliance/validators'
import {
  deriveObligationStatus,
  todayUTC,
  type ObligationFrequency,
} from '@soteria/core/compliance'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantModuleMember(req, 'compliance')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const [rowRes, completionsRes] = await Promise.all([
    gate.authedClient
      .from('compliance_obligations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle(),
    gate.authedClient
      .from('compliance_obligation_completions')
      .select('id, completed_at, completed_by, notes, evidence_url')
      .eq('obligation_id', id)
      .eq('tenant_id', gate.tenantId)
      .order('completed_at', { ascending: false })
      .limit(50),
  ])

  if (rowRes.error) {
    Sentry.captureException(rowRes.error, { tags: { route: 'compliance/obligations/[id]/GET' } })
    return NextResponse.json({ error: rowRes.error.message }, { status: 500 })
  }
  if (!rowRes.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const row = rowRes.data
  const today = todayUTC()
  const status = deriveObligationStatus({
    frequency:       row.frequency       as ObligationFrequency,
    nextDueDate:     row.next_due_date   as string,
    leadDays:        (row.lead_days      as number) ?? 14,
    lastCompletedAt: row.last_completed_at as string | null,
    snoozedUntil:    row.snoozed_until   as string | null,
    notApplicable:   !!row.not_applicable,
  }, today)

  return NextResponse.json({
    obligation:  { ...row, status },
    completions: completionsRes.data ?? [],
    today,
  })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantModuleMember(req, 'compliance')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let payload
  try { payload = obligationUpdateSchema.parse(body) }
  catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: e.issues }, { status: 400 })
    throw e
  }
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await gate.authedClient
    .from('compliance_obligations')
    .update(payload as Record<string, unknown>)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .single()

  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    Sentry.captureException(error, { tags: { route: 'compliance/obligations/[id]/PATCH' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ obligation: data })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { error } = await gate.authedClient
    .from('compliance_obligations')
    .delete()
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)

  if (error) {
    Sentry.captureException(error, { tags: { route: 'compliance/obligations/[id]/DELETE' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
