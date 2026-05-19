import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/admin/review-links/[id]/extend
//   Body: { hours: number }   default 24, max 168 (7 days)
//
// Pushes the link's expires_at forward. The new expiry is computed from
// `greatest(expires_at, now())` so a fresh extension on an already-
// expired link gives a full new window rather than a window starting
// from a stale past timestamp. Audit columns capture who + when + how
// many times.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_HOURS = 24
const MAX_HOURS     = 168   // one week — beyond this, mint a new link

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: { hours?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const hoursRaw = typeof body.hours === 'number' ? body.hours : DEFAULT_HOURS
  const hours    = Math.floor(hoursRaw)
  if (!Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json({ error: 'hours must be a positive number' }, { status: 400 })
  }
  if (hours > MAX_HOURS) {
    return NextResponse.json({ error: `hours must be ≤ ${MAX_HOURS} (one week). Mint a new link for longer windows.` }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Load current expiry so we can compute the new one client-side. A
  // raw SQL `expires_at = greatest(expires_at, now()) + interval` would
  // be one round-trip cheaper but PostgREST doesn't accept expressions
  // in .update() — and the tradeoff between two requests vs. an RPC
  // isn't worth a new RPC for an admin-rate-limited path.
  const { data: link, error: loadErr } = await admin
    .from('loto_review_links')
    .select('id, expires_at, revoked_at, extension_count')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (loadErr) {
    Sentry.captureException(loadErr, { tags: { route: 'review-links/extend', stage: 'load' } })
    return NextResponse.json({ error: loadErr.message }, { status: 500 })
  }
  if (!link)             return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })
  if (link.revoked_at)   return NextResponse.json({ error: 'Cannot extend a revoked link' }, { status: 409 })

  const nowMs   = Date.now()
  const currMs  = Date.parse(link.expires_at)
  const baseMs  = Number.isFinite(currMs) && currMs > nowMs ? currMs : nowMs
  const newIso  = new Date(baseMs + hours * 3_600_000).toISOString()

  const { data: updated, error: patchErr } = await admin
    .from('loto_review_links')
    .update({
      expires_at:       newIso,
      extension_count:  (link.extension_count ?? 0) + 1,
      last_extended_at: new Date().toISOString(),
      last_extended_by: gate.userId,
    })
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('id, expires_at, extension_count, last_extended_at, last_extended_by')
    .maybeSingle()
  if (patchErr) {
    Sentry.captureException(patchErr, { tags: { route: 'review-links/extend', stage: 'patch' } })
    return NextResponse.json({ error: patchErr.message }, { status: 500 })
  }

  return NextResponse.json({ link: updated })
}
