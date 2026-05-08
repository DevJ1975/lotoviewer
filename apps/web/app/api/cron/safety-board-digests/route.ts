import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendBoardDigest, type BoardDigestThreadEntry } from '@/lib/email/sendBoardDigest'

// Cron: safety-board-digests.
//
// Schedule (vercel.json or equivalent): hourly. The cron is a single
// global pass that delivers daily digests to anyone whose
// last_sent_at is > 24h old, and weekly digests to anyone whose
// last_sent_at is > 7d old.
//
// Each user gets one email per (user, tenant) pair where they have a
// non-off cadence. Skipped silently when:
//   - There's no board activity in the window (so we don't spam empty
//     emails — the digest is content-based, not cadence-based).
//   - The user has no boards visible to them (RLS-safe by virtue of
//     using the same access predicate the UI uses).

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

export async function GET(req: Request)  {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)
  const now = new Date()

  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    // Pull all non-off prefs in one shot. Small table; per-user loop
    // is fine.
    const { data: prefs, error } = await admin
      .from('user_digest_preferences')
      .select('user_id, tenant_id, cadence, last_sent_at, email')
      .neq('cadence', 'off')
    if (error) throw new Error(error.message)
    type Pref = { user_id: string; tenant_id: string; cadence: 'daily' | 'weekly'; last_sent_at: string | null; email: string }
    const rows = (((prefs ?? []) as unknown) as Pref[])

    // Tenant lookup for the email subject line.
    const tenantIds = Array.from(new Set(rows.map(p => p.tenant_id)))
    const tenantById = new Map<string, string>()
    if (tenantIds.length > 0) {
      const { data: tenants } = await admin
        .from('tenants').select('id, name').in('id', tenantIds)
      for (const t of (tenants ?? []) as Array<{ id: string; name: string }>) {
        tenantById.set(t.id, t.name)
      }
    }

    for (const pref of rows) {
      const dueWindowMs = pref.cadence === 'daily' ? 24 * 3_600_000 : 7 * 24 * 3_600_000
      const lastSent = pref.last_sent_at ? new Date(pref.last_sent_at).getTime() : 0
      const ageMs = now.getTime() - lastSent
      // Allow a 30-min slack so an hourly cron firing at :05 and :35
      // doesn't both send.
      if (lastSent && ageMs < dueWindowMs - 30 * 60_000) {
        skipped++
        continue
      }

      const windowStart = new Date(now.getTime() - dueWindowMs).toISOString()

      // Threads in the user's tenant with activity in the window.
      // A thread is "active" if it was created OR a reply landed in
      // the window. We surface either trigger.
      const { data: threadRows } = await admin
        .from('safety_board_threads')
        .select('id, board_id, kind, title, pinned, acknowledgement_required, created_at, last_reply_at')
        .eq('tenant_id', pref.tenant_id)
        .is('deleted_at', null)
        .or(`created_at.gte.${windowStart},last_reply_at.gte.${windowStart}`)
        .order('pinned', { ascending: false })
        .order('last_reply_at', { ascending: false })
        .limit(80)

      type ThreadLite = { id: string; board_id: string; kind: string; title: string; pinned: boolean; acknowledgement_required: boolean; created_at: string; last_reply_at: string }
      const threads = (((threadRows ?? []) as unknown) as ThreadLite[])

      // Lookup board names + reply counts.
      const boardIds = Array.from(new Set(threads.map(t => t.board_id)))
      const boardNameById = new Map<string, string>()
      if (boardIds.length > 0) {
        const { data: boards } = await admin
          .from('safety_boards')
          .select('id, name')
          .in('id', boardIds)
          .eq('tenant_id', pref.tenant_id)
        for (const b of (boards ?? []) as Array<{ id: string; name: string }>) {
          boardNameById.set(b.id, b.name)
        }
      }
      const replyCountByThread = new Map<string, number>()
      await Promise.all(threads.map(async t => {
        const { count } = await admin
          .from('safety_board_replies')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', t.id)
          .eq('tenant_id', pref.tenant_id)
          .is('deleted_at', null)
          .gte('created_at', windowStart)
        replyCountByThread.set(t.id, count ?? 0)
      }))

      // Unacked count: threads where acknowledgement_required=true
      // and the user has no row in safety_board_acknowledgements.
      const ackRequiredIds = threads.filter(t => t.acknowledgement_required).map(t => t.id)
      let unackedCount = 0
      if (ackRequiredIds.length > 0) {
        const { data: existing } = await admin
          .from('safety_board_acknowledgements')
          .select('thread_id')
          .eq('user_id', pref.user_id)
          .in('thread_id', ackRequiredIds)
        const acked = new Set(((existing ?? []) as Array<{ thread_id: string }>).map(r => r.thread_id))
        unackedCount = ackRequiredIds.filter(id => !acked.has(id)).length
      }

      const entries: BoardDigestThreadEntry[] = threads.map(t => ({
        board_id:      t.board_id,
        board_name:    boardNameById.get(t.board_id) ?? 'Board',
        thread_id:     t.id,
        title:         t.title,
        kind:          t.kind,
        pinned:        t.pinned,
        ack_required:  t.acknowledgement_required,
        created_at:    t.created_at,
        last_reply_at: t.last_reply_at,
        reply_count:   replyCountByThread.get(t.id) ?? 0,
      }))

      // Skip empty digests so we don't spam.
      if (entries.length === 0 && unackedCount === 0) {
        skipped++
        // Bump last_sent_at anyway so the next run isn't always
        // re-evaluating this user.
        await admin
          .from('user_digest_preferences')
          .update({ last_sent_at: now.toISOString() })
          .eq('user_id', pref.user_id)
          .eq('tenant_id', pref.tenant_id)
        continue
      }

      // Display name lookup.
      const { data: profile } = await admin
        .from('profiles').select('full_name').eq('id', pref.user_id).maybeSingle()
      const recipientName = (profile as { full_name: string | null } | null)?.full_name ?? null

      const ok = await sendBoardDigest({
        to: pref.email,
        recipientName,
        tenantId: pref.tenant_id,
        tenantName: tenantById.get(pref.tenant_id) ?? null,
        cadence: pref.cadence,
        windowStart,
        threads: entries,
        unackedCount,
        appUrl,
      })

      if (ok) {
        await admin
          .from('user_digest_preferences')
          .update({ last_sent_at: now.toISOString() })
          .eq('user_id', pref.user_id)
          .eq('tenant_id', pref.tenant_id)
        sent++
      } else {
        failed++
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/safety-board-digests' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
