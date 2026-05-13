import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// /api/admin/review-links
//
// One anonymous public link per tenant (migration 138). Anyone with the
// URL can leave per-placard comments on any of the tenant's active
// equipment. No email, no department scoping, no sign-off.
//
//   GET   — return the current active public link for the tenant
//           (or null), plus its first_viewed timestamp.
//   POST  — get-or-create the public link. Returns { link, review_url }.
//
// Tenant scoping mirrors the legacy route: JWT identifies the user,
// `x-active-tenant` identifies the tenant, the user must be owner|admin
// (or a superadmin per env allowlist). Service-role client under the
// hood.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Far-future sentinel so the public reviewer lookup (which still
// checks expires_at for legacy rows) doesn't reject the tenant-wide
// row. Keeping the column NOT NULL avoids touching the 035 schema for
// the legacy rows we just revoked.
const PUBLIC_EXPIRY_ISO = '2999-12-31T23:59:59Z'

const PUBLIC_LINK_COLUMNS =
  'id, tenant_id, department, token, expires_at, revoked_at, first_viewed_at, created_at, is_public'

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

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

async function findActiveTenantLink(tenantId: string) {
  const admin = supabaseAdmin()
  return admin
    .from('loto_review_links')
    .select(PUBLIC_LINK_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('is_public', true)
    .is('revoked_at', null)
    .maybeSingle()
}

// ─── GET ──────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await findActiveTenantLink(gate.tenantId)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review-links/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ link: null })
  }

  const baseUrl = publicAppUrl(req)
  return NextResponse.json({
    link:       data,
    review_url: `${baseUrl}/review/${data.token}`,
  })
}

// ─── POST ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const baseUrl = publicAppUrl(req)

  // Reuse an existing active row rather than creating a duplicate. The
  // unique partial index from migration 138 also enforces this server-side.
  const { data: existing, error: lookupErr } = await findActiveTenantLink(gate.tenantId)
  if (lookupErr) {
    Sentry.captureException(lookupErr, { tags: { route: 'review-links/POST', stage: 'lookup' } })
    return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json({
      link:       existing,
      review_url: `${baseUrl}/review/${existing.token}`,
      created:    false,
    })
  }

  // No equipment snapshot for the public path — the reviewer page queries
  // active equipment live so the URL stays current as the tenant adds or
  // decommissions placards.
  const { data: row, error: insertErr } = await admin
    .from('loto_review_links')
    .insert({
      tenant_id:  gate.tenantId,
      department: null,
      is_public:  true,
      expires_at: PUBLIC_EXPIRY_ISO,
      created_by: gate.userId,
    })
    .select(PUBLIC_LINK_COLUMNS)
    .single()
  if (insertErr || !row) {
    Sentry.captureException(insertErr, { tags: { route: 'review-links/POST', stage: 'insert' } })
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({
    link:       row,
    review_url: `${baseUrl}/review/${row.token}`,
    created:    true,
  }, { status: 201 })
}
