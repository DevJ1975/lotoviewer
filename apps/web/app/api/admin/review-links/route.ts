import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sendReviewLinkEmail } from '@/lib/email/sendReviewLink'

// /api/admin/review-links
//   GET ?department=Mechanical    — list review_links for the active tenant
//                                   (optional filter), newest first.
//   POST { department, reviewer_name, reviewer_email,
//          admin_message?, expires_at? }
//                                  — create a new review link, send the
//                                    Resend email, return the row plus
//                                    the public review URL.
//
// Tenant scoping: caller's JWT identifies the user; the
// `x-active-tenant` header identifies the tenant they're acting on.
// We verify (user, tenant) is a tenant_memberships row with role
// owner|admin, OR the caller is a superadmin (DB flag + env allowlist).
// All inserts are made with the service-role client so RLS isn't
// load-bearing for this admin path — but we still set tenant_id on
// every row so the RLS policy from migration 035 lets future admin
// reads work.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type Gate =
  | { ok: true;  userId: string; userEmail: string | null; tenantId: string }
  | { ok: false; status: number; message: string }

async function requireTenantAdmin(req: Request): Promise<Gate> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Missing bearer token' }
  }
  const token = authHeader.slice('Bearer '.length)

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, status: 500, message: 'Supabase env not configured' }
  }

  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, message: 'Invalid session' }

  const tenantId = req.headers.get('x-active-tenant')?.trim() ?? ''
  if (!UUID_RE.test(tenantId)) {
    return { ok: false, status: 400, message: 'Missing or malformed x-active-tenant header' }
  }

  const admin = supabaseAdmin()

  // Superadmin shortcut — DB flag + env allowlist.
  const { data: profile } = await admin
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .maybeSingle()
  const allow = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isSuperadmin = !!profile?.is_superadmin
                    && !!user.email
                    && allow.includes(user.email.toLowerCase())
  if (isSuperadmin) {
    return { ok: true, userId: user.id, userEmail: user.email ?? null, tenantId }
  }

  // Tenant-membership check — role must be owner or admin to send a
  // review link. Members and viewers can't reach this endpoint.
  const { data: membership } = await admin
    .from('tenant_memberships')
    .select('role')
    .eq('user_id',   user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return { ok: false, status: 403, message: 'Tenant admin or owner required' }
  }

  return { ok: true, userId: user.id, userEmail: user.email ?? null, tenantId }
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url        = new URL(req.url)
  const department = url.searchParams.get('department')?.trim()

  const admin = supabaseAdmin()
  let query = admin
    .from('loto_review_links')
    .select('id, department, reviewer_name, reviewer_email, admin_message, sent_at, first_viewed_at, signed_off_at, signoff_approved, signoff_typed_name, signoff_notes, expires_at, revoked_at, created_at, token')
    .eq('tenant_id', gate.tenantId)
    .order('created_at', { ascending: false })
  if (department) query = query.eq('department', department)
  const { data, error } = await query
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review-links/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ links: data ?? [] })
}

// ─── POST ──────────────────────────────────────────────────────────────────

interface PostBody {
  department?:     unknown
  reviewer_name?:  unknown
  reviewer_email?: unknown
  admin_message?:  unknown
  expires_at?:     unknown   // optional ISO; default = 30d from now
}

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const department    = typeof body.department === 'string' ? body.department.trim() : ''
  const reviewerName  = typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : ''
  const reviewerEmail = typeof body.reviewer_email === 'string' ? body.reviewer_email.trim().toLowerCase() : ''
  const adminMessage  = typeof body.admin_message === 'string' ? body.admin_message.trim() : ''
  const expiresAtIso  = typeof body.expires_at === 'string' ? body.expires_at : null

  if (!department) return NextResponse.json({ error: 'department required' }, { status: 400 })
  if (!reviewerName) return NextResponse.json({ error: 'reviewer_name required' }, { status: 400 })
  if (!EMAIL_RE.test(reviewerEmail)) {
    return NextResponse.json({ error: 'Valid reviewer_email required' }, { status: 400 })
  }

  // Validate optional expires_at; reject in the past.
  let expiresAt: string | null = null
  if (expiresAtIso) {
    const t = Date.parse(expiresAtIso)
    if (!Number.isFinite(t) || t <= Date.now()) {
      return NextResponse.json({ error: 'expires_at must be a future ISO date' }, { status: 400 })
    }
    expiresAt = new Date(t).toISOString()
  }

  const admin = supabaseAdmin()

  // Look up the tenant's display name + the placard count for the email body.
  const [{ data: tenantRow }, { count: placardCountRaw }] = await Promise.all([
    admin.from('tenants').select('name').eq('id', gate.tenantId).maybeSingle(),
    admin.from('loto_equipment')
         .select('*', { count: 'exact', head: true })
         .eq('tenant_id', gate.tenantId)
         .eq('department', department)
         .eq('decommissioned', false),
  ])
  const tenantName = tenantRow?.name ?? 'your tenant'
  const placardCount = placardCountRaw ?? 0

  // Insert. Token is filled in by the BEFORE INSERT trigger (migration 035).
  const insertPayload: Record<string, unknown> = {
    tenant_id:       gate.tenantId,
    department,
    reviewer_name:   reviewerName,
    reviewer_email:  reviewerEmail,
    admin_message:   adminMessage || null,
    created_by:      gate.userId,
  }
  if (expiresAt) insertPayload.expires_at = expiresAt

  const { data: row, error: insertErr } = await admin
    .from('loto_review_links')
    .insert(insertPayload)
    .select('id, token, expires_at, department, reviewer_name, reviewer_email, admin_message, created_at')
    .single()
  if (insertErr || !row) {
    Sentry.captureException(insertErr, { tags: { route: 'review-links/POST', stage: 'insert' } })
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  const reviewUrl = `${publicAppUrl(req)}/review/${row.token}`

  // Fire the Resend send. We don't fail the request if email send fails —
  // the row exists, the admin gets the URL back to copy-paste as fallback.
  const emailResult = await sendReviewLinkEmail({
    to:           reviewerEmail,
    reviewerName,
    tenantName,
    department,
    placardCount,
    reviewUrl,
    expiresAt:    row.expires_at,
    adminMessage: adminMessage || undefined,
    replyTo:      gate.userEmail ?? undefined,
  })

  // Mark sent_at + provider id so the admin UI can show "Sent" status.
  if (emailResult.sent) {
    const { error: updateErr } = await admin
      .from('loto_review_links')
      .update({
        sent_at:           new Date().toISOString(),
        email_provider_id: emailResult.providerId,
      })
      .eq('id', row.id)
    if (updateErr) {
      // Non-fatal; email already went out. Log + continue.
      Sentry.captureException(updateErr, { tags: { route: 'review-links/POST', stage: 'mark-sent' } })
    }
  }

  return NextResponse.json({
    link: {
      ...row,
      review_url:        reviewUrl,
      email_sent:        emailResult.sent,
      email_provider_id: emailResult.providerId,
    },
  }, { status: 201 })
}
