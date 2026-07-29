import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyInviteToken } from '@/lib/invites/tokens'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { clientIp } from '@/lib/rateLimit/clientIp'

// POST /api/invites/validate  { token }
//
// Pre-flight check for /accept-invite. Deliberately does NOT consume the
// token — corporate email scanners prefetch links, and a GET-side or
// validate-side consumption would burn invites before the recipient ever
// sees the page. Consumption happens only in /api/invites/accept, after
// the recipient chooses a password.
//
// No auth gate: the 256-bit token IS the credential. Non-valid statuses
// return no identifying details.

export type InviteValidateStatus =
  | 'valid' | 'expired' | 'superseded' | 'used'
  | 'cancelled' | 'already_active' | 'not_found'

export async function POST(req: Request) {
  const ip = clientIp(req)
  const limit = checkMemoryRateLimit(`invite-validate:${ip}`, 30, 60_000)
  if (!limit.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  let body: { token?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const token = typeof body.token === 'string' ? body.token : ''
  if (!token) return NextResponse.json({ status: 'not_found' satisfies InviteValidateStatus })

  const admin = supabaseAdmin()
  const { status, row } = await verifyInviteToken(admin, token)
  if (status !== 'valid' || !row) return NextResponse.json({ status })

  // A cancelled invite must not be acceptable (mirrors the RLS gates from
  // migration 190 that stop cancelled memberships granting access).
  if (row.tenant_id) {
    const { data: membership } = await admin
      .from('tenant_memberships')
      .select('invite_cancelled_at')
      .eq('user_id', row.user_id)
      .eq('tenant_id', row.tenant_id)
      .maybeSingle()
    if (membership?.invite_cancelled_at) {
      return NextResponse.json({ status: 'cancelled' satisfies InviteValidateStatus })
    }
  }

  // Someone who already signed in has a working password of their own —
  // point them at /login instead of silently rotating it.
  const { data: authUser } = await admin.auth.admin.getUserById(row.user_id)
  if (authUser?.user?.last_sign_in_at) {
    return NextResponse.json({ status: 'already_active' satisfies InviteValidateStatus })
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', row.user_id)
    .maybeSingle()

  let tenantName: string | null = null
  if (row.tenant_id) {
    const { data: tenant } = await admin
      .from('tenants')
      .select('name')
      .eq('id', row.tenant_id)
      .maybeSingle()
    tenantName = (tenant as { name: string } | null)?.name ?? null
  }

  return NextResponse.json({
    status:   'valid' satisfies InviteValidateStatus,
    email:    row.email,
    fullName: (profile as { full_name: string | null } | null)?.full_name ?? '',
    tenantName,
  })
}
