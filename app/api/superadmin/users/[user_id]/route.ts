import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// DELETE /api/superadmin/users/[user_id]
//
// Deletes a user from the entire system. Cascades through:
//   - tenant_memberships  (FK on delete cascade)
//   - profiles            (FK on delete cascade)
//   - auth.users          (the row itself)
//
// Use cases:
//   - Decommissioning an employee who's leaving the company
//   - Removing a test account
//   - Fixing a typo'd invite that already accepted on another tenant
//
// Refuses to delete the caller (you can't delete yourself) or the last
// owner of any tenant the user belongs to (would orphan the tenant).
//
// Distinct from DELETE /api/superadmin/tenants/[number]/members/[user_id]
// which only removes one membership without touching auth.users.

export async function DELETE(req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { user_id } = await ctx.params
  if (!user_id || user_id.length < 8) {
    return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 })
  }

  if (user_id === gate.userId) {
    return NextResponse.json({
      error: 'Cannot delete your own account',
    }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Last-owner protection across all tenants the user belongs to.
  const { data: memberships } = await admin
    .from('tenant_memberships')
    .select('tenant_id, role')
    .eq('user_id', user_id)
  const ownedTenantIds = (memberships ?? []).filter(m => m.role === 'owner').map(m => m.tenant_id)
  for (const tenantId of ownedTenantIds) {
    const { count } = await admin
      .from('tenant_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return NextResponse.json({
        error: 'User is the last owner of at least one tenant. Promote another member to owner in each tenant first.',
      }, { status: 409 })
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user_id)
  if (error) {
    Sentry.captureException(error,
      { tags: { route: '/api/superadmin/users/[user_id]', stage: 'delete' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
