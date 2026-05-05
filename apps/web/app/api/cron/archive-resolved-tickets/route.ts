import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Daily cron: archive support tickets that have been resolved for ≥ 30 days.
//
// Why this exists: the Resolved tab on /superadmin/support is meant
// to be a "recently closed" working view, not a forever-growing list.
// After 30 days a ticket has served its triage purpose; flipping it
// to archived hides it from both Open and Resolved without losing
// the row (the conversation transcript + ticket metadata stay queryable
// via the Archive tab and the metrics page).
//
// Auth: Bearer CRON_SECRET (Vercel scheduled invocation) OR
//       x-internal-secret INTERNAL_PUSH_SECRET (manual curl).
//       Same posture as the other crons under /api/cron/.
//
// Vercel schedule: 0 7 * * * (02:00 EST / 03:00 EDT — quiet hours).

export const runtime = 'nodejs'

const ARCHIVE_AFTER_DAYS = 30

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

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const admin = supabaseAdmin()

  try {
    const { data, error } = await admin
      .from('support_tickets')
      .update({ archived_at: new Date().toISOString() })
      .lt('resolved_at', cutoff)
      .is('archived_at', null)
      .not('resolved_at', 'is', null)
      .select('id')
    if (error) {
      Sentry.captureException(error, {
        tags: { route: '/api/cron/archive-resolved-tickets', stage: 'update' },
      })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const archived = data?.length ?? 0
    return NextResponse.json({ archived, cutoff, retentionDays: ARCHIVE_AFTER_DAYS })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/archive-resolved-tickets' } })
    return NextResponse.json({ error: 'Archive cron failed' }, { status: 500 })
  }
}

// POST mirrors GET so manual triggers via curl can use either verb.
export const POST = GET
