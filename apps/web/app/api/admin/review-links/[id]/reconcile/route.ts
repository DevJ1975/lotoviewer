import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'

// Admin photo-reconcile for a review link.
//
//   GET  /api/admin/review-links/[id]/reconcile
//     → { replacements: [...] }  the pending staged photos for this link,
//        with old vs new URLs for a side-by-side preview.
//
//   POST /api/admin/review-links/[id]/reconcile
//     Body: { action: 'apply' | 'reject' | 'apply-all', replacement_id?, reason? }
//     → applies/rejects a single staged photo, or applies every pending one.
//
// The reconcile RPCs are SECURITY DEFINER and do NOT check the tenant
// themselves, so THIS route is the tenant boundary: every replacement is
// confirmed to belong to the gate's tenant (and this link) before any RPC
// runs. Idempotent end-to-end — re-running apply on an already-applied row
// is a no-op in the RPC.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Confirm the link exists and belongs to the gate's tenant. Returns the
// tenant-scoped link id, or null if it isn't this tenant's link.
async function assertLinkInTenant(linkId: string, tenantId: string): Promise<boolean> {
  const admin = supabaseAdmin()
  const { data } = await admin
    .from('loto_review_links')
    .select('id')
    .eq('id', linkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return Boolean(data)
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  if (!(await assertLinkInTenant(id, gate.tenantId))) {
    return NextResponse.json({ error: 'Review link not found' }, { status: 404 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('loto_review_photo_replacements')
    .select('id, equipment_id, slot, old_photo_url, new_photo_url, replaced_by_name, replaced_at, status')
    .eq('review_link_id', id)
    .eq('status', 'pending')
    .order('replaced_at', { ascending: true })
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review-links/reconcile/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ replacements: data ?? [] })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  if (!(await assertLinkInTenant(id, gate.tenantId))) {
    return NextResponse.json({ error: 'Review link not found' }, { status: 404 })
  }

  let body: { action?: unknown; replacement_id?: unknown; reason?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const action = typeof body.action === 'string' ? body.action : ''
  const admin = supabaseAdmin()

  // ─── apply-all ────────────────────────────────────────────────────────
  if (action === 'apply-all') {
    const { data, error } = await admin.rpc('reconcile_review_link_photos', {
      p_review_link_id: id,
      p_applied_by:     gate.userId,
    })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'review-links/reconcile/POST', stage: 'apply-all' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, applied: typeof data === 'number' ? data : 0 })
  }

  // ─── per-item apply / reject ──────────────────────────────────────────
  if (action === 'apply' || action === 'reject') {
    const replacementId = typeof body.replacement_id === 'string' ? body.replacement_id : ''
    if (!UUID_RE.test(replacementId)) {
      return NextResponse.json({ error: 'replacement_id required' }, { status: 400 })
    }
    // Tenant boundary: the replacement must belong to THIS link and tenant.
    const { data: rep, error: repErr } = await admin
      .from('loto_review_photo_replacements')
      .select('id, status')
      .eq('id', replacementId)
      .eq('review_link_id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (repErr) {
      Sentry.captureException(repErr, { tags: { route: 'review-links/reconcile/POST', stage: 'lookup' } })
      return NextResponse.json({ error: repErr.message }, { status: 500 })
    }
    if (!rep) return NextResponse.json({ error: 'Replacement not found' }, { status: 404 })

    if (action === 'apply') {
      const { data, error } = await admin.rpc('apply_staged_photo_replacement', {
        p_replacement_id: replacementId,
        p_applied_by:     gate.userId,
      })
      if (error) {
        Sentry.captureException(error, { tags: { route: 'review-links/reconcile/POST', stage: 'apply' } })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, status: data })
    }

    const reason = typeof body.reason === 'string' ? body.reason : null
    const { data, error } = await admin.rpc('reject_staged_photo_replacement', {
      p_replacement_id: replacementId,
      p_applied_by:     gate.userId,
      p_reason:         reason,
    })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'review-links/reconcile/POST', stage: 'reject' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, status: data })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
