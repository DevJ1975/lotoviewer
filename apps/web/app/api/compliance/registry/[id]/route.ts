import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { ZodError } from 'zod'
import { requireTenantModuleMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { legalRegisterUpdateSchema } from '@/lib/compliance/validators'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantModuleMember(req, 'compliance')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  // Pull the entry + its attached obligations in two queries so the
  // detail page renders with one round-trip instead of N+1.
  const [entryRes, obligationsRes] = await Promise.all([
    gate.authedClient
      .from('legal_register')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle(),
    gate.authedClient
      .from('compliance_obligations')
      .select('id, title, category, frequency, next_due_date, lead_days, last_completed_at, snoozed_until, not_applicable, responsible_party')
      .eq('legal_register_id', id)
      .eq('tenant_id', gate.tenantId)
      .order('next_due_date', { ascending: true }),
  ])

  if (entryRes.error) {
    Sentry.captureException(entryRes.error, { tags: { route: 'compliance/registry/[id]/GET' } })
    return NextResponse.json({ error: entryRes.error.message }, { status: 500 })
  }
  if (!entryRes.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    entry:        entryRes.data,
    obligations:  obligationsRes.data ?? [],
  })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let payload
  try { payload = legalRegisterUpdateSchema.parse(body) }
  catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: e.issues }, { status: 400 })
    throw e
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await gate.authedClient
    .from('legal_register')
    .update(payload as Record<string, unknown>)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Citation already exists for this tenant' }, { status: 409 })
    }
    if ((error as { code?: string }).code === 'PGRST116') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    Sentry.captureException(error, { tags: { route: 'compliance/registry/[id]/PATCH' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ entry: data })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { error } = await gate.authedClient
    .from('legal_register')
    .delete()
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)

  if (error) {
    Sentry.captureException(error, { tags: { route: 'compliance/registry/[id]/DELETE' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
