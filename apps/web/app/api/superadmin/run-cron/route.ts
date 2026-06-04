import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { validateJsonBody } from '@/lib/security/validateBody'

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
  '/api/cron/webhook-reconcile',
  '/api/cron/superadmin-daily-report',
])

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

// Zod refine binds the allowlist + the trim to one schema. The earlier
// hand-rolled `body.path.trim()` followed by `.has(path)` is preserved
// behaviourally.
const RunBodySchema = z.object({
  path: z.string().trim().refine(p => ALLOWED_PATHS.has(p), {
    message: 'Path not in allowlist',
  }),
})

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const parsed = await validateJsonBody(req, RunBodySchema)
  if (!parsed.ok) return parsed.response
  const { path } = parsed.data

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
