import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/chat/unread
// Cheap summary for the header badge: returns total unread chat
// messages across all the caller's non-muted channels in the active
// tenant.

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    // One set-based round-trip instead of 1 membership read + 2 reads per
    // channel. The RPC returns per-channel tallies with the caller's muted
    // flag; the badge counts only non-muted channels, as before.
    const { data, error } = await admin.rpc('chat_unread_counts', {
      p_user:   gate.userId,
      p_tenant: gate.tenantId,
    })
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as Array<{ unread_count: number; muted: boolean }>
    const total = rows.reduce((sum, r) => (r.muted ? sum : sum + (r.unread_count ?? 0)), 0)

    return NextResponse.json({ unread: total })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-unread/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
