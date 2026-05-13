import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { ZodError } from 'zod'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { obligationCreateSchema } from '@/lib/compliance/validators'
import {
  deriveObligationStatus,
  todayUTC,
  OBLIGATION_CATEGORIES,
  OBLIGATION_STATUSES,
  type ObligationStatus,
  type ObligationFrequency,
} from '@soteria/core/compliance'

// GET  /api/compliance/obligations  — list with filters + status derivation
// POST /api/compliance/obligations  — create one (tenant member)
//
// We DERIVE status at read time rather than storing it. The query
// returns the raw row plus a computed `status` field so callers don't
// have to re-derive on every render.

const MAX_LIMIT = 500

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'compliance')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const statusParam   = url.searchParams.get('status')?.trim()       ?? ''
  const categoryParam = url.searchParams.get('category')?.trim()     ?? ''
  const registerId    = url.searchParams.get('legal_register_id')?.trim() ?? ''
  const dueFrom       = url.searchParams.get('due_from')?.trim()     ?? ''
  const dueTo         = url.searchParams.get('due_to')?.trim()       ?? ''
  const search        = url.searchParams.get('q')?.trim()            ?? ''
  const limit         = clamp(parseInt(url.searchParams.get('limit') ?? '100', 10), 1, MAX_LIMIT, 100)
  const offset        = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  let q = gate.authedClient
    .from('compliance_obligations')
    .select('*', { count: 'exact' })
    .order('next_due_date', { ascending: true })
    .range(offset, offset + limit - 1)

  if (categoryParam && (OBLIGATION_CATEGORIES as readonly string[]).includes(categoryParam)) {
    q = q.eq('category', categoryParam)
  }
  if (registerId) q = q.eq('legal_register_id', registerId)
  if (dueFrom && /^\d{4}-\d{2}-\d{2}$/.test(dueFrom)) q = q.gte('next_due_date', dueFrom)
  if (dueTo   && /^\d{4}-\d{2}-\d{2}$/.test(dueTo))   q = q.lte('next_due_date', dueTo)
  if (search) {
    const escaped = search.replace(/[%,]/g, m => '\\' + m)
    q = q.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`)
  }

  const { data, error, count } = await q
  if (error) {
    Sentry.captureException(error, { tags: { route: 'compliance/obligations/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const today = todayUTC()
  const enriched = (data ?? []).map(row => ({
    ...row,
    status: deriveObligationStatus({
      frequency:       row.frequency       as ObligationFrequency,
      nextDueDate:     row.next_due_date   as string,
      leadDays:        (row.lead_days      as number) ?? 14,
      lastCompletedAt: row.last_completed_at as string | null,
      snoozedUntil:    row.snoozed_until   as string | null,
      notApplicable:   !!row.not_applicable,
    }, today),
  }))

  let filtered = enriched
  if (statusParam && (OBLIGATION_STATUSES as readonly string[]).includes(statusParam)) {
    filtered = enriched.filter(r => (r.status as ObligationStatus) === statusParam)
  }

  return NextResponse.json({
    obligations: filtered,
    total:       count ?? 0,
    limit,
    offset,
    today,
  })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, 'compliance')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let payload
  try { payload = obligationCreateSchema.parse(body) }
  catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: e.issues }, { status: 400 })
    throw e
  }

  // If the row references a legal_register row, confirm it lives in
  // the same tenant — RLS would block it anyway, but a 422 here is
  // friendlier than the RLS-blocked "row violates RLS policy" error.
  if (payload.legal_register_id) {
    const { data: lr } = await gate.authedClient
      .from('legal_register')
      .select('id')
      .eq('id', payload.legal_register_id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!lr) return NextResponse.json({ error: 'legal_register_id not found in tenant' }, { status: 422 })
  }

  const { data, error } = await gate.authedClient
    .from('compliance_obligations')
    .insert({
      tenant_id:           gate.tenantId,
      legal_register_id:   payload.legal_register_id ?? null,
      title:               payload.title,
      description:         payload.description       ?? null,
      category:            payload.category,
      jurisdiction:        payload.jurisdiction      ?? null,
      frequency:           payload.frequency,
      frequency_days:      payload.frequency_days    ?? null,
      next_due_date:       payload.next_due_date,
      lead_days:           payload.lead_days,
      snoozed_until:       payload.snoozed_until     ?? null,
      not_applicable:      payload.not_applicable,
      responsible_party:   payload.responsible_party ?? null,
      evidence_required:   payload.evidence_required,
      notes:               payload.notes             ?? null,
      created_by:          gate.userId,
    })
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { route: 'compliance/obligations/POST' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ obligation: data }, { status: 201 })
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
