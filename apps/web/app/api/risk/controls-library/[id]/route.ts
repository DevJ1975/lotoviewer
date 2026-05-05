import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PATCH /api/risk/controls-library/[id]
// DELETE /api/risk/controls-library/[id]
//
// Tenant admin/owner only. Active=false soft-deletes (the row stays
// for audit but the wizard doesn't suggest it). Hard delete is also
// supported via DELETE method but disallowed when the control is
// referenced by any risk_controls row.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_HIERARCHY_LEVELS = ['elimination','substitution','engineering','administrative','ppe']

interface PatchBody {
  name?:                  unknown
  description?:           unknown
  hierarchy_level?:       unknown
  applicable_categories?: unknown
  active?:                unknown
  regulatory_ref?:        unknown
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: PatchBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    if (body.name.trim().length === 0) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }
    update.name = body.name.trim()
  }
  if (body.description !== undefined) {
    update.description = typeof body.description === 'string' ? body.description.trim() || null : null
  }
  if (typeof body.hierarchy_level === 'string') {
    if (!VALID_HIERARCHY_LEVELS.includes(body.hierarchy_level)) {
      return NextResponse.json({ error: 'Invalid hierarchy_level' }, { status: 400 })
    }
    update.hierarchy_level = body.hierarchy_level
  }
  if (Array.isArray(body.applicable_categories)) {
    update.applicable_categories = body.applicable_categories.filter(c => typeof c === 'string')
  }
  if (typeof body.active === 'boolean') update.active = body.active
  if (body.regulatory_ref !== undefined) {
    update.regulatory_ref = typeof body.regulatory_ref === 'string' ? body.regulatory_ref.trim() || null : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }
  update.updated_by = gate.userId

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('controls_library')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'controls-library/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })
    return NextResponse.json({ control: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'controls-library/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Disallow hard-delete when the control is referenced by any
  // risk_controls row. Caller should soft-delete via PATCH active=false
  // instead. Mirrors the standard "preserve audit history" pattern
  // we use elsewhere.
  const { count, error: countErr } = await admin
    .from('risk_controls')
    .select('*', { count: 'exact', head: true })
    .eq('control_id', id)
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 })
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `Control is in use on ${count} risk(s). Deactivate via the Active toggle to keep audit history.`,
      code:  'control_in_use',
    }, { status: 422 })
  }

  const { error } = await admin
    .from('controls_library')
    .delete()
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'controls-library/DELETE' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
