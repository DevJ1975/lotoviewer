import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/risk/members
// Returns every tenant_membership for the active tenant joined to
// the profiles row + auth.users (for email). Powers the member-
// picker in the risk wizard's Assign step + future risk admin UIs
// that need to surface "who can be assigned this risk."
//
// Auth: any tenant member. The list of members within a tenant is
// not sensitive — every tenant member already sees them in other
// surfaces (Members panel, audit log).

interface MemberRow {
  user_id:    string
  role:       string
  email:      string | null
  full_name:  string | null
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: memberships, error } = await admin
      .from('tenant_memberships')
      .select('user_id, role, profiles(full_name)')
      .eq('tenant_id', gate.tenantId)
    if (error) throw new Error(error.message)

    const userIds = (memberships ?? []).map(m => m.user_id)
    if (userIds.length === 0) return NextResponse.json({ members: [] })

    // auth.users is locked down — service-role admin client reads
    // emails; we batch through admin.auth.admin.listUsers() to avoid
    // N email lookups.
    const { data: usersList, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (usersErr) throw new Error(usersErr.message)
    const emailById = new Map((usersList?.users ?? []).map(u => [u.id, u.email ?? null]))

    type MembershipShape = { user_id: string; role: string; profiles: { full_name?: string | null } | null }
    const out: MemberRow[] = (memberships as unknown as MembershipShape[] ?? []).map(m => ({
      user_id:    m.user_id,
      role:       m.role,
      email:      emailById.get(m.user_id) ?? null,
      full_name:  m.profiles?.full_name ?? null,
    }))

    // Stable sort: full_name (when present) → email → role.
    out.sort((a, b) => {
      const aName = a.full_name ?? a.email ?? ''
      const bName = b.full_name ?? b.email ?? ''
      return aName.localeCompare(bName)
    })

    return NextResponse.json({ members: out })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/members/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
