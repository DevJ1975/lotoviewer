import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET    /api/incidents/qr-tokens         List (any tenant member)
// POST   /api/incidents/qr-tokens         Create (admin)
// PATCH  /api/incidents/qr-tokens?id=     Toggle enabled / relabel
// DELETE /api/incidents/qr-tokens?id=     Owner only — destroys posted-sign target

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COLS = [
  'id', 'tenant_id', 'label', 'token',
  'rate_limit_per_hour', 'enabled',
  'total_reports', 'last_used_at',
  'created_at', 'updated_at', 'created_by', 'updated_by',
].join(', ')

interface PostBody {
  label:                string
  rate_limit_per_hour?: number
}

interface PatchBody {
  label?:               string
  enabled?:             boolean
  rate_limit_per_hour?: number | null
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incident_anon_intake_tokens')
      .select(COLS)
      .eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ tokens: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.label || !body.label.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  if (body.rate_limit_per_hour != null) {
    if (!Number.isInteger(body.rate_limit_per_hour) || body.rate_limit_per_hour <= 0) {
      return NextResponse.json({ error: 'rate_limit_per_hour must be a positive integer' }, { status: 400 })
    }
  }

  // 32 bytes of randomness → 64 hex chars. Same shape as the
  // witness-statement token so /report and /witness can share
  // validation regex.
  const token = randomBytes(32).toString('hex')

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incident_anon_intake_tokens')
      .insert({
        tenant_id:           gate.tenantId,
        label:               body.label.trim(),
        token,
        rate_limit_per_hour: body.rate_limit_per_hour ?? null,
        created_by:          gate.userId,
        updated_by:          gate.userId,
      })
      .select(COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'qr-tokens/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ qr_token: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: '?id= is required' }, { status: 400 })

  let body: PatchBody
  try { body = (await req.json()) as PatchBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_by: gate.userId }
  if (typeof body.label === 'string')   update.label   = body.label.trim() || null
  if (typeof body.enabled === 'boolean') update.enabled = body.enabled
  if ('rate_limit_per_hour' in body)
    update.rate_limit_per_hour = body.rate_limit_per_hour
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incident_anon_intake_tokens')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select(COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'qr-tokens/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ qr_token: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  if (gate.role !== 'owner' && gate.role !== 'superadmin') {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  }
  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: '?id= is required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('incident_anon_intake_tokens')
      .delete()
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'qr-tokens/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
