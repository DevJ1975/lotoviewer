import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/toolbox-talks
//
// Lists the tenant's toolbox talks. Returns today's talk (if any),
// the next 6 days of upcoming generated talks, and the most recent
// 30 historical talks. The list page renders these sections inline.
//
// Read-only. Generation is owned by /api/cron/generate-toolbox-talks
// and there is intentionally no client-facing POST/PATCH on this
// resource — preventing tenant-side abuse of the AI generation
// surface was an explicit operator requirement.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const todayStr = today.toISOString().slice(0, 10)
    const horizon  = new Date(today.getTime() + 6 * 86_400_000).toISOString().slice(0, 10)

    // Upcoming = today and the next 6 days (the cron's window).
    const upcomingQuery = gate.authedClient
      .from('toolbox_talks')
      .select('id, talk_date, title, topic_id, generated_at')
      .eq('tenant_id', gate.tenantId)
      .gte('talk_date', todayStr)
      .lte('talk_date', horizon)
      .order('talk_date', { ascending: true })

    // Past = the 30 most recent talks before today, with their
    // signature counts (so the list can show "12 signed" without an
    // N+1 query). Supabase's nested-count syntax pulls the count in
    // a single round-trip.
    const pastQuery = gate.authedClient
      .from('toolbox_talks')
      .select('id, talk_date, title, topic_id, generated_at, toolbox_talk_signatures(count)')
      .eq('tenant_id', gate.tenantId)
      .lt('talk_date', todayStr)
      .order('talk_date', { ascending: false })
      .limit(30)

    const [upcoming, past] = await Promise.all([upcomingQuery, pastQuery])

    if (upcoming.error) throw new Error(upcoming.error.message)
    if (past.error)     throw new Error(past.error.message)

    return NextResponse.json({
      today_str: todayStr,
      upcoming:  upcoming.data ?? [],
      past:      past.data ?? [],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'toolbox-talks/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
