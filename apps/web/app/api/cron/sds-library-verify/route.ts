import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { verifyLibraryBatch } from '@/lib/sdsLibraryVerify'

// SDS-library source-URL verification. Re-fetches stale library source URLs,
// hash-compares to detect manufacturer revisions / link-rot, and records the
// outcome. No AI, no stored PDF — cheap enough to schedule, but kept opt-in
// (run-cron) alongside the seed drip. Auth mirrors the other crons.

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_PER_RUN = 50

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
  try {
    const result = await verifyLibraryBatch({ max: MAX_PER_RUN })
    return NextResponse.json(result)
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'sds-library-verify' } })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
