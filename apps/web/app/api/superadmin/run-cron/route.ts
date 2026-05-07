import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'

// POST /api/superadmin/run-cron  { path: '/api/cron/...' }
//
// Manually triggers a cron route by hitting it server-to-server with
// the Bearer secret + an x-cron-trigger header. The cron's
// withCronLogging wrapper sees the manual trigger and records it
// distinctly from scheduled invocations.
//
// Why route-through-server: Vercel cron secrets shouldn't be exposed
// to the browser. The superadmin clicks "Run now" → this route runs
// the secret-Bearer fetch on their behalf.
//
// We allowlist cron paths from vercel.json so a forgotten typo or a
// malicious actor can't pivot this into "fetch arbitrary internal
// route as service-role." Add new crons here when adding to vercel.json.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_PATHS = new Set<string>([
  '/api/cron/meter-bump-reminders',
  '/api/cron/daily-health-report',
  '/api/cron/risk-review-reminders',
  '/api/cron/archive-resolved-tickets',
  '/api/cron/training-expiry-reminders',
])

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { path?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const path = body?.path?.trim() ?? ''
  if (!ALLOWED_PATHS.has(path)) {
    return NextResponse.json({ error: 'Path not in allowlist' }, { status: 400 })
  }

  const secret = process.env.CRON_SECRET ?? process.env.INTERNAL_PUSH_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'No CRON_SECRET configured on this deployment' }, { status: 500 })
  }

  const target = `${publicAppUrl(req)}${path}`
  const startedAt = Date.now()
  let upstreamStatus = 0
  let upstreamBody: unknown = null
  try {
    const res = await fetch(target, {
      method:  'POST',
      headers: {
        authorization:           `Bearer ${secret}`,
        'x-cron-trigger':        'manual',
        'x-cron-triggered-by':   gate.userId,
      },
    })
    upstreamStatus = res.status
    upstreamBody = await res.json().catch(() => null)
  } catch (e) {
    return NextResponse.json({
      error:    e instanceof Error ? e.message : String(e),
      target,
    }, { status: 502 })
  }

  return NextResponse.json({
    triggered:    path,
    elapsedMs:    Date.now() - startedAt,
    upstreamStatus,
    upstreamBody,
  })
}
