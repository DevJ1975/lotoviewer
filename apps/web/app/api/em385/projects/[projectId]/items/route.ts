import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  validateCreateRegisterItemInput,
  type Em385Category,
} from '@soteria/core/em385'

// GET  /api/em385/projects/[projectId]/items   List register items (member).
// POST /api/em385/projects/[projectId]/items   Add a custom item (admin).
//
// Custom items have requirement_id = null. Items seeded from the catalog are
// created at project creation (see ../route.ts POST).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { projectId } = await ctx.params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('em385_register_items')
      .select('id, project_id, requirement_id, title, category, status, not_applicable_justification, responsible_party, due_date, submitted_at, accepted_at, accepted_by, effective_date, expires_at, version, linked_record_id, linked_module, notes, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('tenant_id', gate.tenantId)
      .order('category', { ascending: true })
      .order('title', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ items: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/items/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { projectId } = await ctx.params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const validationError = validateCreateRegisterItemInput({
    title:    typeof body.title === 'string' ? body.title : undefined,
    category: typeof body.category === 'string' ? body.category as Em385Category : undefined,
  })
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    // Confirm the project belongs to the active tenant before attaching to it.
    const { data: project, error: projErr } = await admin
      .from('em385_projects')
      .select('id')
      .eq('id', projectId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (projErr) return sanitizeError(projErr, 'em385/items/POST:project')
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const insert = {
      tenant_id:         gate.tenantId,
      project_id:        projectId,
      requirement_id:    null,
      title:             (body.title as string).trim(),
      category:          body.category as Em385Category,
      responsible_party: str(body.responsible_party),
      due_date:          str(body.due_date),
      notes:             str(body.notes),
      updated_by:        gate.userId,
    }

    const { data, error } = await admin
      .from('em385_register_items')
      .insert(insert)
      .select('*')
      .single()
    if (error) return sanitizeError(error, 'em385/items/POST')
    return NextResponse.json({ item: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/items/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
