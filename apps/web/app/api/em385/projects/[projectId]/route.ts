import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { EM385_PROJECT_STATUSES, type Em385ProjectStatus } from '@soteria/core/em385'
import { computeEm385Metrics, type Em385ItemForMetrics } from '@soteria/core/em385Metrics'

// GET    /api/em385/projects/[projectId]   Project + register items + dashboard
//                                          metrics (member).
// PATCH  /api/em385/projects/[projectId]   Edit contract metadata / status (admin).
// DELETE /api/em385/projects/[projectId]   Remove the contract + cascade (admin).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { projectId } = await ctx.params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data: project, error: projErr } = await gate.authedClient
      .from('em385_projects')
      .select('*')
      .eq('id', projectId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (projErr) throw new Error(projErr.message)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: items, error: itemsErr } = await gate.authedClient
      .from('em385_register_items')
      .select('id, project_id, requirement_id, title, category, status, not_applicable_justification, responsible_party, due_date, submitted_at, accepted_at, accepted_by, effective_date, expires_at, version, linked_record_id, linked_module, notes, created_at, updated_at')
      .eq('project_id', projectId)
      .order('category', { ascending: true })
      .order('title', { ascending: true })
    if (itemsErr) throw new Error(itemsErr.message)

    const metrics = computeEm385Metrics((items ?? []) as Em385ItemForMetrics[])

    return NextResponse.json({ project, items: items ?? [], metrics })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/projects/[projectId]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

export async function PATCH(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { projectId } = await ctx.params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  const setText = (key: string) => {
    const v = body[key]
    if (v === null) update[key] = null
    else if (typeof v === 'string') update[key] = v.trim() || null
  }

  // edition is intentionally NOT editable — the register was seeded from it.
  for (const key of ['title', 'gda', 'prime_contractor', 'location', 'start_date', 'end_date', 'ssho_name']) {
    setText(key)
  }
  // Title is required: reject an explicit blank rather than persisting null.
  if ('title' in update && update.title === null) {
    return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
  }

  if (typeof body.status === 'string') {
    if (!(EM385_PROJECT_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    update.status = body.status as Em385ProjectStatus
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }
  update.updated_by = gate.userId

  try {
    const { data, error } = await supabaseAdmin()
      .from('em385_projects')
      .update(update)
      .eq('id', projectId)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) return sanitizeError(error, 'em385/projects/[projectId]/PATCH')
    if (!data) return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })
    return NextResponse.json({ project: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/projects/[projectId]/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { projectId } = await ctx.params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { error } = await supabaseAdmin()
      .from('em385_projects')
      .delete()
      .eq('id', projectId)
      .eq('tenant_id', gate.tenantId)
    if (error) return sanitizeError(error, 'em385/projects/[projectId]/DELETE')
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/projects/[projectId]/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
