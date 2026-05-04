import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { TenantRole } from '@/lib/types'

// GET /api/superadmin/users
//
// Cross-tenant member list for the /superadmin landing page. Returns
// every profile with:
//   - last_sign_in_at + status (invited / active)  from auth.users
//   - memberships: [{ tenant_number, tenant_name, role }]
// Service-role read (no RLS) so superadmin sees the full picture.
//
// Pagination is server-side bounded (200 users × up to 50 pages on
// listUsers); profiles + memberships are read in single round-trips.

export interface SuperadminUserRow {
  user_id:         string
  email:           string | null
  full_name:       string | null
  is_admin:        boolean
  is_superadmin:   boolean
  last_sign_in_at: string | null
  status:          'invited' | 'active'
  memberships:    Array<{
    tenant_id:     string
    tenant_number: string
    tenant_name:   string
    role:          TenantRole
  }>
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()

  // 1. Profiles
  const { data: profiles, error: pErr } = await admin
    .from('profiles')
    .select('id, email, full_name, is_admin, is_superadmin, created_at')
    .order('created_at', { ascending: false })
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  // 2. Memberships joined to tenants
  const { data: memberships, error: mErr } = await admin
    .from('tenant_memberships')
    .select('user_id, role, tenant_id, tenants(id, tenant_number, name)')
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  type RawMembership = {
    user_id: string; role: TenantRole; tenant_id: string
    tenants: { id: string; tenant_number: string; name: string } | { id: string; tenant_number: string; name: string }[] | null
  }
  const membershipsByUser = new Map<string, SuperadminUserRow['memberships']>()
  for (const m of (memberships ?? []) as RawMembership[]) {
    const t = Array.isArray(m.tenants) ? m.tenants[0] ?? null : m.tenants
    if (!t) continue
    const list = membershipsByUser.get(m.user_id) ?? []
    list.push({ tenant_id: t.id, tenant_number: t.tenant_number, tenant_name: t.name, role: m.role })
    membershipsByUser.set(m.user_id, list)
  }

  // 3. last_sign_in_at — page through listUsers (same shape as the
  //    members route).
  const lastSignInByUserId = new Map<string, string | null>()
  const PAGE_SIZE = 200
  const MAX_PAGES = 50
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data: authData, error: aErr } =
      await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
    const users = authData?.users ?? []
    for (const u of users) lastSignInByUserId.set(u.id, u.last_sign_in_at ?? null)
    if (users.length < PAGE_SIZE) break
  }

  type RawProfile = {
    id: string; email: string | null; full_name: string | null
    is_admin: boolean | null; is_superadmin: boolean | null
  }

  const rows: SuperadminUserRow[] = (profiles ?? [] as RawProfile[]).map((p: RawProfile) => {
    const lastSignInAt = lastSignInByUserId.get(p.id) ?? null
    return {
      user_id:         p.id,
      email:           p.email ?? null,
      full_name:       p.full_name ?? null,
      is_admin:        p.is_admin === true,
      is_superadmin:   p.is_superadmin === true,
      last_sign_in_at: lastSignInAt,
      status:          lastSignInAt ? 'active' : 'invited',
      memberships:     membershipsByUser.get(p.id) ?? [],
    }
  })

  return NextResponse.json({ users: rows })
}
