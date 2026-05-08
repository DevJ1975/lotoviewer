import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET    /api/safety-boards/[boardId]/templates     List active templates.
// POST   /api/safety-boards/[boardId]/templates     Create. Admin only.
// DELETE /api/safety-boards/[boardId]/templates?id=  Archive. Admin only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = ['hazard_report','near_miss_reflection','lesson_learned','alert','question','discussion'] as const

interface RouteContext { params: Promise<{ boardId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { boardId } = await ctx.params
  if (!UUID_RE.test(boardId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('safety_board_thread_templates')
      .select('id, name, description, kind, default_title, default_body, fields_schema, sort_order, created_at')
      .eq('board_id', boardId)
      .eq('tenant_id', gate.tenantId)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ templates: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-templates/GET' } })
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

  let body: {
    name?: string
    description?: string
    kind?: string
    default_title?: string
    default_body?: string
    fields_schema?: unknown
    sort_order?: number
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = (body.name ?? '').trim()
  if (name.length < 1 || name.length > 80) return NextResponse.json({ error: 'name must be 1-80 chars' }, { status: 400 })
  if (!body.kind || !(KINDS as readonly string[]).includes(body.kind)) {
    return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
  }
  // Light validation of fields_schema: must be an array of objects
  // with key + type. Defer richer validation to the runtime widget.
  const fields = Array.isArray(body.fields_schema) ? body.fields_schema : []
  for (const f of fields as Array<Record<string, unknown>>) {
    if (typeof f.key !== 'string' || typeof f.type !== 'string') {
      return NextResponse.json({ error: 'fields_schema entries need key + type' }, { status: 400 })
    }
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('safety_board_thread_templates')
      .insert({
        tenant_id:     gate.tenantId,
        board_id:      boardId,
        name,
        description:   (body.description ?? '').trim() || null,
        kind:          body.kind,
        default_title: (body.default_title ?? '').trim() || null,
        default_body:  (body.default_body ?? '').trim() || null,
        fields_schema: fields,
        sort_order:    typeof body.sort_order === 'number' ? body.sort_order : 100,
        created_by:    gate.userId,
      })
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-templates/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ template: data }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-templates/POST' } })
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
      .from('safety_board_thread_templates')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('board_id', boardId)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-templates/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-templates/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
