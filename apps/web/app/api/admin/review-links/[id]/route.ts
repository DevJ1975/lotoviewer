import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PATCH /api/admin/review-links/[id]
//   Body: { action: 'revoke' }
//
// The only currently-supported mutation is revocation. Future
// actions (resend-email, edit-reviewer-email, etc.) plug in as
// additional `action` values. Resend in particular is intentionally
// left for v2 — it requires deciding whether to rotate the token.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Gate =
  | { ok: true;  userId: string; tenantId: string }
  | { ok: false; status: number; message: string }

async function requireTenantAdmin(req: Request): Promise<Gate> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Missing bearer token' }
  }
  const token = authHeader.slice('Bearer '.length)

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return { ok: false, status: 500, message: 'Supabase env missing' }

  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, message: 'Invalid session' }

  const tenantId = req.headers.get('x-active-tenant')?.trim() ?? ''
  if (!UUID_RE.test(tenantId)) {
    return { ok: false, status: 400, message: 'Missing or malformed x-active-tenant header' }
  }

  const admin = supabaseAdmin()
  const { data: profile } = await admin.from('profiles')
    .select('is_superadmin').eq('id', user.id).maybeSingle()
  const allow = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (profile?.is_superadmin && user.email && allow.includes(user.email.toLowerCase())) {
    return { ok: true, userId: user.id, tenantId }
  }

  const { data: membership } = await admin
    .from('tenant_memberships')
    .select('role')
    .eq('user_id',   user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return { ok: false, status: 403, message: 'Tenant admin or owner required' }
  }

  return { ok: true, userId: user.id, tenantId }
}

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
