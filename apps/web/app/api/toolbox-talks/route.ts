import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { dateWindow, localDateString, tenantTimeZone } from '@/lib/toolboxDates'
import { TOOLBOX_TALK_ARCHIVE_DAYS, TOOLBOX_TALK_DAYS_AHEAD, TOOLBOX_TALKS_MODULE_ID } from '@/lib/toolboxTalkPacks'

// GET /api/toolbox-talks
// GET /api/toolbox-talks?archive=1
//
// Default mode lists the tenant's toolbox talks: today's talk (if
// any), the next 13 days of upcoming generated talks, and the most
// recent 30 historical talks.
//
// `?archive=1` widens the past list to up to one year of history for
// the on-page archive section. The list page renders the archive
// lazily — it's hidden behind a "View archive" toggle to keep the
// default response fast.
//
// Read-only. Generation is owned by /api/cron/generate-toolbox-talks
// and there is intentionally no client-facing POST/PATCH on this
// resource — preventing tenant-side abuse of the AI generation
// surface was an explicit operator requirement.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, TOOLBOX_TALKS_MODULE_ID)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url     = new URL(req.url)
  const archive = url.searchParams.get('archive') === '1'

  try {
    const timeZone = tenantTimeZone(gate.tenantSettings)
    const todayStr = localDateString(new Date(), timeZone)
    const horizon  = dateWindow(todayStr, TOOLBOX_TALK_DAYS_AHEAD).at(-1) ?? todayStr

    // Upcoming = today and the next 13 days (the cron's window).
    const upcomingQuery = gate.authedClient
      .from('toolbox_talks')
      .select('id, talk_date, title, topic_id, generated_at')
      .eq('tenant_id', gate.tenantId)
      .gte('talk_date', todayStr)
      .lte('talk_date', horizon)
      .order('talk_date', { ascending: true })

    // Past — capped at 30 by default; 365 in archive mode. The cap
    // is here to keep the default page response under ~30 KB; the
    // archive opt-in sends one round-trip when the user actually
    // wants the full library.
    const pastLimit = archive ? TOOLBOX_TALK_ARCHIVE_DAYS : 30
    const pastQuery = gate.authedClient
      .from('toolbox_talks')
      .select('id, talk_date, title, topic_id, generated_at')
      .eq('tenant_id', gate.tenantId)
      .lt('talk_date', todayStr)
      .order('talk_date', { ascending: false })
      .limit(pastLimit)

    const [upcoming, past] = await Promise.all([upcomingQuery, pastQuery])

    if (upcoming.error) throw new Error(upcoming.error.message)
    if (past.error)     throw new Error(past.error.message)

    // Sign-in counts per past talk. We tally these from a thin,
    // talk_id-only read rather than the obvious embedded
    // `toolbox_talk_signatures(count)`: migration 137 revoked
    // table-level SELECT on the signatures table (granting only the
    // non-image columns), and PostgREST's embedded count reads the
    // related row whole — a privilege the column-level grant cannot
    // satisfy, which surfaces as "permission denied for table
    // toolbox_talk_signatures". Selecting only the granted talk_id
    // column keeps the signature image server-side while still showing
    // members the attendance tally.
    const pastTalks = past.data ?? []
    const signCounts = await countSignaturesByTalk(
      gate.authedClient,
      gate.tenantId,
      pastTalks.map(t => t.id),
    )

    return NextResponse.json({
      today_str: todayStr,
      time_zone: timeZone,
      upcoming:  upcoming.data ?? [],
      past:      pastTalks.map(t => ({
        ...t,
        toolbox_talk_signatures: [{ count: signCounts.get(t.id) ?? 0 }],
      })),
      archive,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'toolbox-talks/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Tally sign-ins per talk by reading only the granted talk_id column.
// Returns a map of talk_id → signature count; talks with no sign-ins are
// simply absent from the map (callers default to 0).
async function countSignaturesByTalk(
  client: SupabaseClient,
  tenantId: string,
  talkIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (talkIds.length === 0) return counts

  const { data, error } = await client
    .from('toolbox_talk_signatures')
    .select('talk_id')
    .eq('tenant_id', tenantId)
    .in('talk_id', talkIds)
  if (error) throw new Error(error.message)

  for (const { talk_id } of data ?? []) {
    counts.set(talk_id, (counts.get(talk_id) ?? 0) + 1)
  }
  return counts
}
