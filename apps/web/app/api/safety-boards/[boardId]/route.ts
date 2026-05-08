import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET    /api/safety-boards/[boardId]   Board detail.
// PATCH  /api/safety-boards/[boardId]   Edit name/description (admin).
// DELETE /api/safety-boards/[boardId]   Archive (soft-delete; admin).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ boardId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data } = await admin
      .from('safety_boards')
      .select('*')
      .eq('id', boardId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    return NextResponse.json({ board: data })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-boards/[id]/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
  if (!isPriv) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  let body: { name?: string; description?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const n = body.name.trim()
    if (n.length < 1 || n.length > 80) {
      return NextResponse.json({ error: 'name must be 1-80 chars' }, { status: 400 })
    }
    update.name = n
  }
  if ('description' in body) {
    const d = (body.description ?? '').toString().trim()
    update.description = d || null
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('safety_boards')
      .update(update)
      .eq('id', boardId)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-boards/[id]/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    return NextResponse.json({ board: data })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-boards/[id]/PATCH' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
  if (!isPriv) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('safety_boards')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', boardId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-boards/[id]/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-boards/[id]/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
