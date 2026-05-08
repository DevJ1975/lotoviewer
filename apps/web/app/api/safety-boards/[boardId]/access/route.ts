import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET    /api/safety-boards/[boardId]/access   List scope rows for a board.
// POST   /api/safety-boards/[boardId]/access   Add a scope row. Admin only.
// DELETE /api/safety-boards/[boardId]/access?id=<row-id>   Remove a row. Admin only.
//
// Empty list (no rows) means "any tenant member can post" — the
// default. Adding rows narrows access to (role='admin' OR
// role='owner' OR department='maintenance' OR …).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SCOPE_TYPES = ['role', 'department'] as const
const ROLES = ['owner', 'admin', 'member', 'viewer'] as const

interface RouteContext { params: Promise<{ boardId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('safety_board_access')
      .select('id, scope_type, scope_value, created_at')
      .eq('board_id', boardId)
      .eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ scopes: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-board-access/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
  if (!isPriv) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  let body: { scope_type?: string; scope_value?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const scopeType = (body.scope_type ?? '').trim()
  const scopeValue = (body.scope_value ?? '').trim()
  if (!(SCOPE_TYPES as readonly string[]).includes(scopeType)) {
    return NextResponse.json({ error: `scope_type must be one of ${SCOPE_TYPES.join(', ')}` }, { status: 400 })
  }
  if (!scopeValue) return NextResponse.json({ error: 'scope_value required' }, { status: 400 })
  if (scopeType === 'role' && !(ROLES as readonly string[]).includes(scopeValue)) {
    return NextResponse.json({ error: `role must be one of ${ROLES.join(', ')}` }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: board } = await admin
      .from('safety_boards').select('id').eq('id', boardId).eq('tenant_id', gate.tenantId).maybeSingle()
    if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

    const { data, error } = await admin
      .from('safety_board_access')
      .insert({
        tenant_id:    gate.tenantId,
        board_id:     boardId,
        scope_type:   scopeType,
        scope_value:  scopeValue,
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That scope is already on this board.' }, { status: 409 })
      }
      Sentry.captureException(error, { tags: { route: 'safety-board-access/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ scope: data }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-board-access/POST' } })
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

  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id query param required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('safety_board_access')
      .delete()
      .eq('id', id)
      .eq('board_id', boardId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-board-access/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-board-access/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
