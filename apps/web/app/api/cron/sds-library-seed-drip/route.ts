import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { researchSeedBatch } from '@/lib/sdsLibrarySeed'

// SDS-library seed drip.
//
// Processes one capped batch of APPROVED items for the oldest still-researching
// seed run, discovering each chemical's SDS into the global library. Intended
// to be triggered repeatedly (via Superadmin → Run now) to drain a large seed
// run without a single long request. It is deliberately NOT on a Vercel
// schedule: autonomous AI spend stays opt-in until an operator wants it.
//
// Auth + run-logging mirror the other crons (CRON_SECRET / INTERNAL_PUSH_SECRET).

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_PER_RUN = 25

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
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

async function runCron(): Promise<NextResponse> {
  const admin = supabaseAdmin()

  const { data: runs, error } = await admin
    .from('sds_library_seed_runs')
    .select('id')
    .eq('status', 'researching')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) {
    Sentry.captureException(error, { tags: { source: 'sds-library-seed-drip', stage: 'select' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const run = (runs ?? [])[0] as { id: string } | undefined
  if (!run) return NextResponse.json({ processed: 0, note: 'no active seed run' })

  try {
    const result = await researchSeedBatch({ seedRunId: run.id, max: MAX_PER_RUN })
    return NextResponse.json({ run_id: run.id, ...result })
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'sds-library-seed-drip', run: run.id } })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
