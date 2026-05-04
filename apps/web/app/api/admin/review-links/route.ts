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
    .select('id, department, reviewer_name, reviewer_email, admin_message, sent_at, first_viewed_at, signed_off_at, signoff_approved, signoff_typed_name, signoff_notes, expires_at, revoked_at, created_at, token, email_channel')
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

// Maximum reviewers per single batch submit. Hard cap at the API
// boundary so a runaway client can't DDOS the Resend dashboard.
// Bump if the user-facing modal cap changes.
const MAX_REVIEWERS_PER_BATCH = 5

// Singular shape (legacy) and batch shape are both accepted. The
// admin UI today posts the batch shape even for one reviewer.
interface PostBody {
  department?:     unknown
  // Singular shape — back-compat with v1.
  reviewer_name?:  unknown
  reviewer_email?: unknown
  // Batch shape — preferred. 1..MAX_REVIEWERS_PER_BATCH entries.
  reviewers?:      unknown
  admin_message?:  unknown
  expires_at?:     unknown   // optional ISO; default = 30d from now
  // When true, skip the Resend send entirely. The row is still
  // created (token + URL still valid); the admin sends the message
  // through their own mail client via the manual-send fallback.
  skip_email?:     unknown
}

interface ParsedReviewer {
  name:  string
  email: string
}

/**
 * Normalize the singular vs batch shape into a single
 * ParsedReviewer[] with light validation. Returns either the
 * normalized array or an HTTP error.
 */
function parseReviewers(body: PostBody):
  | { ok: true;  reviewers: ParsedReviewer[] }
  | { ok: false; status: number; message: string }
{
  // Batch shape takes precedence if it's present + non-empty.
  if (Array.isArray(body.reviewers) && body.reviewers.length > 0) {
    if (body.reviewers.length > MAX_REVIEWERS_PER_BATCH) {
      return { ok: false, status: 400, message: `At most ${MAX_REVIEWERS_PER_BATCH} reviewers per batch` }
    }
    const out: ParsedReviewer[] = []
    const seen = new Set<string>()
    for (const r of body.reviewers as unknown[]) {
      if (!r || typeof r !== 'object') {
        return { ok: false, status: 400, message: 'reviewers entries must be objects' }
      }
      const rec   = r as Record<string, unknown>
      const name  = typeof rec.name === 'string'  ? rec.name.trim() : ''
      const email = typeof rec.email === 'string' ? rec.email.trim().toLowerCase() : ''
      if (!name)  return { ok: false, status: 400, message: 'Each reviewer needs a name' }
      if (!EMAIL_RE.test(email)) {
        return { ok: false, status: 400, message: `Invalid email: ${email || '(empty)'}` }
      }
      if (seen.has(email)) {
        return { ok: false, status: 400, message: `Duplicate email in batch: ${email}` }
      }
      seen.add(email)
      out.push({ name, email })
    }
    return { ok: true, reviewers: out }
  }

  // Singular shape fallback.
  const name  = typeof body.reviewer_name === 'string'  ? body.reviewer_name.trim() : ''
  const email = typeof body.reviewer_email === 'string' ? body.reviewer_email.trim().toLowerCase() : ''
  if (!name)  return { ok: false, status: 400, message: 'reviewer_name required' }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, status: 400, message: 'Valid reviewer_email required' }
  }
  return { ok: true, reviewers: [{ name, email }] }
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

  const department   = typeof body.department === 'string' ? body.department.trim() : ''
  const adminMessage = typeof body.admin_message === 'string' ? body.admin_message.trim() : ''
  const expiresAtIso = typeof body.expires_at === 'string' ? body.expires_at : null
  const skipEmail    = body.skip_email === true
  const channel      = skipEmail ? 'manual' : 'auto'

  if (!department) return NextResponse.json({ error: 'department required' }, { status: 400 })

  const parsed = parseReviewers(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: parsed.status })

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
  // One read serves the whole batch — every reviewer gets the same numbers.
  const [{ data: tenantRow }, { count: placardCountRaw }] = await Promise.all([
    admin.from('tenants').select('name').eq('id', gate.tenantId).maybeSingle(),
    admin.from('loto_equipment')
         .select('*', { count: 'exact', head: true })
         .eq('tenant_id', gate.tenantId)
         .eq('department', department)
         .eq('decommissioned', false),
  ])
  const tenantName   = tenantRow?.name ?? 'your tenant'
  const placardCount = placardCountRaw ?? 0

  // Build N insert payloads. Token gets populated by the BEFORE INSERT
  // trigger (migration 035) per row, so each reviewer ends up with a
  // unique URL.
  const insertPayloads = parsed.reviewers.map(r => {
    const payload: Record<string, unknown> = {
      tenant_id:       gate.tenantId,
      department,
      reviewer_name:   r.name,
      reviewer_email:  r.email,
      admin_message:   adminMessage || null,
      email_channel:   channel,
      created_by:      gate.userId,
    }
    if (expiresAt) payload.expires_at = expiresAt
    return payload
  })

  // Single round-trip insert; .select() returns every row + its
  // populated token in insert order so we can fan out emails afterward.
  const { data: rows, error: insertErr } = await admin
    .from('loto_review_links')
    .insert(insertPayloads)
    .select('id, token, expires_at, department, reviewer_name, reviewer_email, admin_message, email_channel, created_at')
  if (insertErr || !rows?.length) {
    Sentry.captureException(insertErr, { tags: { route: 'review-links/POST', stage: 'insert' } })
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  const baseUrl = publicAppUrl(req)
  const linkSummaries = rows.map(row => ({
    ...row,
    review_url: `${baseUrl}/review/${row.token}`,
  }))

  // ─── Resend fan-out (only when skip_email !== true) ──────────────────────
  // One Resend send per reviewer, in parallel via Promise.allSettled so a
  // single failure doesn't poison the rest of the batch. Per-row results
  // ride back in the response so the UI can flag the partial failures.
  const emailResults: { sent: boolean; providerId: string | null }[] = []
  if (skipEmail) {
    for (let i = 0; i < linkSummaries.length; i++) {
      emailResults.push({ sent: false, providerId: null })
    }
  } else {
    const settles = await Promise.allSettled(
      linkSummaries.map(link => sendReviewLinkEmail({
        to:           link.reviewer_email,
        reviewerName: link.reviewer_name,
        tenantName,
        department,
        placardCount,
        reviewUrl:    link.review_url,
        expiresAt:    link.expires_at,
        adminMessage: adminMessage || undefined,
        replyTo:      gate.userEmail ?? undefined,
      })),
    )
    for (const s of settles) {
      if (s.status === 'fulfilled') emailResults.push(s.value)
      else                          emailResults.push({ sent: false, providerId: null })
    }

    // Mark sent_at + email_provider_id for the rows whose Resend send
    // succeeded. Failed-send rows stay sent_at = NULL so the UI surfaces
    // a "Pending send" / "Retry via your email" affordance.
    const sentUpdates = linkSummaries
      .map((link, i) => ({ link, result: emailResults[i]! }))
      .filter(({ result }) => result.sent)
    if (sentUpdates.length > 0) {
      const nowIso = new Date().toISOString()
      // Supabase doesn't support multi-row update with different values
      // in one call without an RPC; loop one update per success.
      // Per-row updates run in parallel since they target distinct rows.
      await Promise.all(sentUpdates.map(({ link, result }) =>
        admin
          .from('loto_review_links')
          .update({ sent_at: nowIso, email_provider_id: result.providerId })
          .eq('id', link.id)
          .then(({ error }) => {
            if (error) {
              Sentry.captureException(error, { tags: { route: 'review-links/POST', stage: 'mark-sent' } })
            }
          }),
      ))
    }
  }

  return NextResponse.json({
    links: linkSummaries.map((link, i) => ({
      ...link,
      email_sent:        emailResults[i]!.sent,
      email_provider_id: emailResults[i]!.providerId,
    })),
  }, { status: 201 })
}
