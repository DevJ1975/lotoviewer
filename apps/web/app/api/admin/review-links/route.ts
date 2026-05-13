import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// /api/admin/review-links
//
// Public review-link model (migration 138). One shareable URL per
// (tenant, department); anyone with the URL can leave per-placard notes
// and sign off. Get-or-create semantics so calling POST twice is safe.
//
//   GET ?department=Mechanical  — return the current active public link
//                                 for that department (or null), plus
//                                 the eventual signoff payload.
//   POST { department }         — get-or-create the public link.
//                                 Returns { link, review_url }.
//
// Tenant scoping mirrors the legacy per-reviewer route: caller's JWT
// identifies the user; `x-active-tenant` identifies the tenant; the
// user must be owner|admin for that tenant (or a superadmin per env
// allowlist). All inserts use the service-role client.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Far-future expiry sentinel so the public reviewer-portal lookup
// (which still checks expires_at) doesn't reject the link. The column
// stays NOT NULL by design; rather than drop the constraint, we burn
// a value that won't matter for centuries.
const PUBLIC_EXPIRY_ISO = '2999-12-31T23:59:59Z'

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

interface DepartmentEquipmentForReview {
  equipment_id: string
  description:  string | null
  department:   string
  photo_status: 'missing' | 'partial' | 'complete'
  placard_url:  string | null
}

const PUBLIC_LINK_COLUMNS =
  'id, tenant_id, department, token, expires_at, revoked_at, first_viewed_at, signed_off_at, signoff_approved, signoff_typed_name, signoff_notes, created_at, is_public'

// ─── GET ──────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url        = new URL(req.url)
  const department = url.searchParams.get('department')?.trim()

  const admin = supabaseAdmin()
  let query = admin
    .from('loto_review_links')
    .select(PUBLIC_LINK_COLUMNS)
    .eq('tenant_id', gate.tenantId)
    .eq('is_public', true)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (department) query = query.eq('department', department)

  const { data, error } = await query
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review-links/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const baseUrl = publicAppUrl(req)
  const links = (data ?? []).map(row => ({
    ...row,
    review_url: `${baseUrl}/review/${row.token}`,
  }))

  return NextResponse.json({ links })
}

// ─── POST ─────────────────────────────────────────────────────────────────

interface PostBody {
  department?: unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const department = typeof body.department === 'string' ? body.department.trim() : ''
  if (!department) {
    return NextResponse.json({ error: 'department required' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Reuse an existing active public link rather than creating a duplicate.
  // The unique partial index from migration 138 also enforces this server-side.
  const { data: existing, error: lookupErr } = await admin
    .from('loto_review_links')
    .select(PUBLIC_LINK_COLUMNS)
    .eq('tenant_id', gate.tenantId)
    .eq('department', department)
    .eq('is_public', true)
    .is('revoked_at', null)
    .maybeSingle()
  if (lookupErr) {
    Sentry.captureException(lookupErr, { tags: { route: 'review-links/POST', stage: 'lookup' } })
    return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  }

  const baseUrl = publicAppUrl(req)
  if (existing) {
    return NextResponse.json({
      link:       existing,
      review_url: `${baseUrl}/review/${existing.token}`,
      created:    false,
    })
  }

  // Snapshot the department equipment so the reviewer portal has a
  // stable list. New equipment added after the link is generated won't
  // appear until an admin regenerates the link (via PATCH).
  const { data: departmentEquipment, error: equipmentErr } = await admin
    .from('loto_equipment')
    .select('equipment_id, description, department, photo_status, placard_url')
    .eq('tenant_id', gate.tenantId)
    .eq('department', department)
    .eq('decommissioned', false)
    .order('equipment_id', { ascending: true })
  if (equipmentErr) {
    Sentry.captureException(equipmentErr, { tags: { route: 'review-links/POST', stage: 'equipment' } })
    return NextResponse.json({ error: equipmentErr.message }, { status: 500 })
  }
  const equipmentForReview = (departmentEquipment ?? []) as DepartmentEquipmentForReview[]
  if (equipmentForReview.length === 0) {
    return NextResponse.json({ error: 'No active equipment in this department to review' }, { status: 400 })
  }

  // Insert the public row. Token is populated by the BEFORE INSERT trigger
  // from migration 035.
  const { data: row, error: insertErr } = await admin
    .from('loto_review_links')
    .insert({
      tenant_id:    gate.tenantId,
      department,
      is_public:    true,
      expires_at:   PUBLIC_EXPIRY_ISO,
      created_by:   gate.userId,
    })
    .select(PUBLIC_LINK_COLUMNS)
    .single()
  if (insertErr || !row) {
    Sentry.captureException(insertErr, { tags: { route: 'review-links/POST', stage: 'insert' } })
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  const snapshotPayloads = equipmentForReview.map((eq, index) => ({
    review_link_id:        row.id,
    tenant_id:             gate.tenantId,
    equipment_id:          eq.equipment_id,
    equipment_description: eq.description,
    department:            department,
    sort_order:            index,
  }))
  const { error: snapshotErr } = await admin
    .from('loto_review_link_equipment')
    .insert(snapshotPayloads)
  if (snapshotErr) {
    Sentry.captureException(snapshotErr, { tags: { route: 'review-links/POST', stage: 'snapshot' } })
    await admin.from('loto_review_links').delete().eq('id', row.id)
    return NextResponse.json({ error: snapshotErr.message }, { status: 500 })
  }

  return NextResponse.json({
    link:       row,
    review_url: `${baseUrl}/review/${row.token}`,
    created:    true,
  }, { status: 201 })
}
