import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'

// Cron: drain finished pg_net responses into loto_webhook_deliveries.
//
// fire_webhooks() (mig 059) inserts a delivery row + captures the
// pg_net request id at fire time. The HTTP response lands in
// net._http_response some milliseconds-to-seconds later. This cron
// calls public.reconcile_webhook_deliveries() which patches the
// delivery rows with status / body / duration.
//
// Schedule: every 5 minutes. Bigger gaps mean operators see "pending"
// rows for longer in the explorer; smaller gaps waste invocations.
// 5 min is the cheapest Vercel cron tier.
//
// Auth: same Bearer/internal-secret pattern as the other crons.

export const runtime = 'nodejs'

const BATCH = 500

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
  return withCronLogging(req, () => runCron())
}

async function runCron(): Promise<NextResponse> {
  const admin = supabaseAdmin()
  try {
    const { data, error } = await admin.rpc('reconcile_webhook_deliveries', { limit_n: BATCH })
    if (error) {
      Sentry.captureException(error, {
        tags: { route: '/api/cron/webhook-reconcile', stage: 'rpc' },
      })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const patched = typeof data === 'number' ? data : 0
    return NextResponse.json({ patched, batch: BATCH })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/webhook-reconcile' } })
    return NextResponse.json({ error: 'Webhook reconcile failed' }, { status: 500 })
  }
}

export const POST = GET
