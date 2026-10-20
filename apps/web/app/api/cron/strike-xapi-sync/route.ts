import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { safeEqual } from '@/lib/security/safeEqual'
import { flushStrikeXapiOutbox } from '@/lib/strike/lrs'

export const runtime = 'nodejs'
// At most 1000 statements per tick in batches of 50, one LRS call each with
// a 15s timeout, and a tenant's remaining batches wait after its first
// failure. Typical ticks send a handful of statements in well under a second.
export const maxDuration = 300

function authorize(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret && bearer && safeEqual(bearer, cronSecret)) return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer && safeEqual(bearer, internalSecret)) return true
  return false
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

async function runCron(): Promise<NextResponse> {
  try {
    const summary = await flushStrikeXapiOutbox(supabaseAdmin(), new Date())
    return NextResponse.json(summary)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: '/api/cron/strike-xapi-sync' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
