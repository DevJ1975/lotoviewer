import { NextResponse } from 'next/server'
import { checkMemoryRateLimit } from './memory'

// Throttle for the four endpoints that mint an invite. Each one sends a Resend
// email and creates an auth.users row, so an admin token that leaks is both a
// spend problem and a domain-reputation problem — the exact deliverability
// risk the invite-link redesign was meant to reduce.
//
// Keyed on the acting principal rather than the IP: these callers are already
// past requireTenantAdmin / requireSuperadmin, so the identity is verified and
// unspoofable, which an IP is not. Not keyed on tenant as well, so a
// superadmin working across tenants is still bounded in aggregate.
//
// 30 per 10 minutes is tuned to sit well above human pace — invites are
// created one at a time from admin forms, there is no bulk or CSV path — while
// bounding a runaway caller. Like everything built on checkMemoryRateLimit
// this is per-instance, so treat it as a brake, not a cap.
const LIMIT = 30
const WINDOW_MS = 10 * 60_000

/**
 * Returns a 429 to return from the route, or null when the caller is under
 * the limit. Call after the auth gate — it needs a verified actor id.
 */
export function inviteIssueRateLimit(actorId: string): NextResponse | null {
  const limit = checkMemoryRateLimit(`invite-issue:${actorId}`, LIMIT, WINDOW_MS)
  if (limit.ok) return null

  return NextResponse.json(
    { error: 'Too many invites sent. Try again shortly.' },
    { status: 429, headers: { 'retry-after': String(limit.retryAfterSec ?? 600) } },
  )
}
