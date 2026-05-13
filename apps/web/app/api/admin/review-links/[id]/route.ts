import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PATCH /api/admin/review-links/[id]
//   Body: { action: 'revoke' | 'regenerate' }
//
// 'revoke'     — marks the row revoked. The public link stops working;
//                no new row is created. Use when you want to retire a
//                department's review surface entirely.
// 'regenerate' — revokes the existing row AND creates a fresh public
//                row for the same department, cycling the token. Use
//                when the link has been over-shared and you want a new
//                URL that supersedes the old one, or when the previous
//                link has been signed off and you want to open a new
//                review pass.

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

  if (body.action !== 'revoke' && body.action !== 'regenerate') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Step 1: revoke the existing row. Both actions need this.
  const { data: revoked, error: revokeErr } = await admin
    .from('loto_review_links')
    .update({ revoked_at: new Date().toISOString(), revoked_by: gate.userId })
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .is('revoked_at', null)
    .select('id, tenant_id, department, is_public, revoked_at, revoked_by')
    .maybeSingle()
  if (revokeErr) {
    Sentry.captureException(revokeErr, { tags: { route: 'review-links/PATCH', stage: 'revoke' } })
    return NextResponse.json({ error: revokeErr.message }, { status: 500 })
  }
  if (!revoked) {
    return NextResponse.json({ error: 'Not found, already revoked, or wrong tenant' }, { status: 404 })
  }

  if (body.action === 'revoke') {
    return NextResponse.json({ link: revoked })
  }

  // Step 2 (regenerate only): create a fresh public row for the same
  // department, cycling the token. Snapshot the current equipment so
  // the new reviewer surface reflects today's department state, not
  // the stale snapshot from the original create.
  if (!revoked.is_public) {
    return NextResponse.json({ error: 'Regenerate only applies to public links' }, { status: 400 })
  }

  const { data: departmentEquipment, error: equipmentErr } = await admin
    .from('loto_equipment')
    .select('equipment_id, description, department')
    .eq('tenant_id', gate.tenantId)
    .eq('department', revoked.department)
    .eq('decommissioned', false)
    .order('equipment_id', { ascending: true })
  if (equipmentErr) {
    Sentry.captureException(equipmentErr, { tags: { route: 'review-links/PATCH', stage: 'regenerate-equipment' } })
    return NextResponse.json({ error: equipmentErr.message }, { status: 500 })
  }
  const equipmentForReview = departmentEquipment ?? []
  if (equipmentForReview.length === 0) {
    return NextResponse.json({ error: 'No active equipment in this department to review' }, { status: 400 })
  }

  const { data: row, error: insertErr } = await admin
    .from('loto_review_links')
    .insert({
      tenant_id:  gate.tenantId,
      department: revoked.department,
      is_public:  true,
      expires_at: '2999-12-31T23:59:59Z',
      created_by: gate.userId,
    })
    .select('id, tenant_id, department, token, expires_at, revoked_at, created_at, is_public')
    .single()
  if (insertErr || !row) {
    Sentry.captureException(insertErr, { tags: { route: 'review-links/PATCH', stage: 'regenerate-insert' } })
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  const snapshotPayloads = equipmentForReview.map((eq, index) => ({
    review_link_id:        row.id,
    tenant_id:             gate.tenantId,
    equipment_id:          eq.equipment_id,
    equipment_description: eq.description,
    department:            revoked.department,
    sort_order:            index,
  }))
  const { error: snapshotErr } = await admin
    .from('loto_review_link_equipment')
    .insert(snapshotPayloads)
  if (snapshotErr) {
    Sentry.captureException(snapshotErr, { tags: { route: 'review-links/PATCH', stage: 'regenerate-snapshot' } })
    await admin.from('loto_review_links').delete().eq('id', row.id)
    return NextResponse.json({ error: snapshotErr.message }, { status: 500 })
  }

  return NextResponse.json({ link: row, regenerated_from: revoked.id })
}
