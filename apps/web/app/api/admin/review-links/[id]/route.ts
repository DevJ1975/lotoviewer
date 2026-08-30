import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'

// PATCH /api/admin/review-links/[id]
//   Body: { action: 'revoke' }
//
// The only currently-supported mutation is revocation. Future
// actions (resend-email, edit-reviewer-email, etc.) plug in as
// additional `action` values. Resend in particular is intentionally
// left for v2 — it requires deciding whether to rotate the token.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: { action?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action !== 'revoke') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: row, error } = await admin
    .from('loto_review_links')
    .update({ revoked_at: new Date().toISOString(), revoked_by: gate.userId })
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .is('revoked_at', null)
    .select('id, revoked_at, revoked_by')
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review-links/PATCH', stage: 'revoke' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ error: 'Not found, already revoked, or wrong tenant' }, { status: 404 })
  }

  return NextResponse.json({ link: row })
}
