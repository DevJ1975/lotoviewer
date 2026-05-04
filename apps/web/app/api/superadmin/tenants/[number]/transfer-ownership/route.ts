import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidTenantNumber } from '@/lib/validation/tenants'

// POST /api/superadmin/tenants/[number]/transfer-ownership
//
// Promotes a member to 'owner' AND demotes every other current owner
// to 'admin' in the same operation. Composes two PATCHes that the
// PATCH membership route would already handle individually, but
// guarantees the tenant ends up with exactly one owner — eliminates
// the "promote then demote" two-step that's easy to do half of.
//
// Body: { new_owner_user_id: string }
//
// Refuses if:
//   - new_owner is not a member of the tenant         → 404
//   - new_owner is already the sole owner             → 409 (no-op)
//   - tenant doesn't exist                            → 404
//
// The previous owner(s) become 'admin' (not removed, not demoted to
// member) so they retain admin powers but lose the unique-to-owner
// rights (deleting the tenant, etc.).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!isValidTenantNumber(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  let body: { new_owner_user_id?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const newOwnerId = typeof body.new_owner_user_id === 'string' ? body.new_owner_user_id : ''
  if (!UUID_RE.test(newOwnerId)) {
    return NextResponse.json({ error: 'Valid new_owner_user_id required' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, tenant_number, name')
    .eq('tenant_number', number)
    .maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Snapshot current membership state for the target + current owners.
  const { data: targetMembership } = await admin
    .from('tenant_memberships')
    .select('role')
    .eq('tenant_id', tenant.id)
    .eq('user_id', newOwnerId)
    .maybeSingle()
  if (!targetMembership) {
    return NextResponse.json({ error: 'New owner must already be a member of this tenant' }, { status: 404 })
  }

  const { data: currentOwners } = await admin
    .from('tenant_memberships')
    .select('user_id, role')
    .eq('tenant_id', tenant.id)
    .eq('role', 'owner')
  const owners = currentOwners ?? []

  if (owners.length === 1 && owners[0]!.user_id === newOwnerId) {
    return NextResponse.json({ error: 'User is already the sole owner of this tenant' }, { status: 409 })
  }

  // 1. Promote the target.
  if (targetMembership.role !== 'owner') {
    const { error: promoteErr } = await admin
      .from('tenant_memberships')
      .update({ role: 'owner' })
      .eq('tenant_id', tenant.id)
      .eq('user_id', newOwnerId)
    if (promoteErr) {
      Sentry.captureException(promoteErr, {
        tags: { route: '/api/superadmin/tenants/[number]/transfer-ownership', stage: 'promote' },
      })
      return NextResponse.json({ error: promoteErr.message }, { status: 500 })
    }
  }

  // 2. Demote every previous owner (not including the new one) to admin.
  const previousOwnerIds = owners
    .filter(o => o.user_id !== newOwnerId)
    .map(o => o.user_id)
  if (previousOwnerIds.length > 0) {
    const { error: demoteErr } = await admin
      .from('tenant_memberships')
      .update({ role: 'admin' })
      .eq('tenant_id', tenant.id)
      .in('user_id', previousOwnerIds)
    if (demoteErr) {
      Sentry.captureException(demoteErr, {
        tags: { route: '/api/superadmin/tenants/[number]/transfer-ownership', stage: 'demote' },
      })
      // Note: at this point the new owner was promoted but old owners
      // weren't demoted. The tenant has 2+ owners — not corrupt, just
      // not the desired end state. Surface the error so the operator
      // can retry.
      return NextResponse.json({
        error: `Promoted new owner but failed to demote previous owners: ${demoteErr.message}`,
      }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    tenant: { id: tenant.id, tenant_number: tenant.tenant_number, name: tenant.name },
    new_owner_user_id: newOwnerId,
    demoted_user_ids:  previousOwnerIds,
  })
}
