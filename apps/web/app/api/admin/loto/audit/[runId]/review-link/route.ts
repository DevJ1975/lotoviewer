import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/admin/loto/audit/[runId]/review-link — mint (or fetch) the audit
// review link for a run. The link (kind='audit', bound to the run) is what the
// reviewer opens to see the change summary + per-item diffs and approve/reject.
// Get-or-create: returns the existing non-revoked link if one is already bound.

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { runId } = await ctx.params

  const admin = supabaseAdmin()
  const { data: run } = await admin
    .from('loto_audit_runs').select('id, review_link_id').eq('id', runId).eq('tenant_id', gate.tenantId).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const baseUrl = publicAppUrl(req)

  // Reuse an existing, non-revoked audit link if one is already bound.
  if (run.review_link_id) {
    const { data: existing } = await admin
      .from('loto_review_links')
      .select('id, token, expires_at, revoked_at')
      .eq('id', run.review_link_id).maybeSingle()
    if (existing && !existing.revoked_at) {
      return NextResponse.json({
        review_url: `${baseUrl}/review/audit/${existing.token}`,
        token: existing.token, expires_at: existing.expires_at, created: false,
      })
    }
  }

  // token + expires_at come from the loto_review_links defaults/trigger.
  const { data: link, error } = await admin
    .from('loto_review_links')
    .insert({
      tenant_id:     gate.tenantId,
      kind:          'audit',
      audit_run_id:  runId,
      is_public:     false,
      email_channel: 'manual',
      created_by:    gate.userId,
    })
    .select('id, token, expires_at')
    .single()
  if (error || !link) {
    Sentry.captureException(error, { tags: { route: 'admin/loto/audit/review-link', stage: 'insert' } })
    return NextResponse.json({ error: error?.message ?? 'Failed to mint link' }, { status: 500 })
  }

  await admin.from('loto_audit_runs').update({ review_link_id: link.id }).eq('id', runId)

  return NextResponse.json({
    review_url: `${baseUrl}/review/audit/${link.token}`,
    token: link.token, expires_at: link.expires_at, created: true,
  }, { status: 201 })
}
