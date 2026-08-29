import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { enqueueVisionSweep } from '@/lib/ai/vision/hazardSweep'

// Cron: open a vision hazard sweep for every tenant that has opted in.
//
// This route ONLY enqueues. It opens a run and writes one claimable work row
// per photo, then returns — the photos are processed by
// /api/cron/vision-sweep-resume, which drains the queue across as many ticks as
// it takes. A tenant's photo backlog is not bounded by this function's 300s
// ceiling, so doing the work here would mean a sweep that silently truncates at
// whatever the invocation managed before being reclaimed.
//
// OPT-IN, OFF BY DEFAULT. A tenant participates only when
// `tenants.settings.vision_sweep_enabled` is exactly true. This lives in
// settings rather than the feature catalog because it is operational AI config
// — the same place ai_disabled and ai_daily_budget_cents live — not a navigable
// module. Until the review queue has a UI, leaving it off is the right default:
// signals nobody reads are worse than no signals.
//
// Schedule (vercel.json): daily at 08:00 UTC.
// Auth: Bearer CRON_SECRET (Vercel) OR x-internal-secret INTERNAL_PUSH_SECRET.

export const runtime     = 'nodejs'
export const maxDuration = 300

// Only photos newer than this are enqueued when a tenant has never swept.
// Bounds the first run so enabling the feature does not queue years of history.
const FIRST_RUN_LOOKBACK_DAYS = 7
// Tenants opened per tick. Enqueue is a handful of bounded selects per tenant,
// but a hundred tenants in one invocation is still not worth the tail risk.
const MAX_TENANTS_PER_TICK = 20

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
  return false
}

interface TenantRow {
  id:       string
  settings: Record<string, unknown> | null
}

async function handler(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()

  const { data, error } = await admin.from('tenants').select('id, settings')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enabled = ((data ?? []) as TenantRow[])
    .filter(t => t.settings?.vision_sweep_enabled === true
              && t.settings?.ai_disabled !== true)
    .slice(0, MAX_TENANTS_PER_TICK)

  const opened: { tenantId: string; runId: string; queued: number; skipped: number }[] = []
  const failed: { tenantId: string; error: string }[] = []

  for (const tenant of enabled) {
    try {
      // A tenant already mid-sweep is left alone: opening a second run would
      // double the spend and race the first one's work rows.
      const { data: inFlight } = await admin
        .from('vision_sweep_runs')
        .select('id').eq('tenant_id', tenant.id).eq('status', 'running').limit(1)
      if ((inFlight ?? []).length > 0) continue

      const result = await enqueueVisionSweep(admin, {
        tenantId: tenant.id,
        since:    await sinceFor(admin, tenant.id),
      })
      opened.push({ tenantId: tenant.id, ...result })
    } catch (err) {
      // One tenant's misconfiguration (no API key, budget exhausted) must not
      // stop the others from sweeping.
      const message = err instanceof Error ? err.message : 'unknown error'
      failed.push({ tenantId: tenant.id, error: message })
      Sentry.captureException(err, { tags: { cron: 'vision-hazard-sweep', tenant_id: tenant.id } })
    }
  }

  return NextResponse.json({
    ok: true,
    tenantsConsidered: enabled.length,
    opened,
    failed,
  })
}

// Resume where the last completed sweep stopped so nothing is re-read and
// nothing is missed. A tenant that has never swept gets a bounded lookback
// rather than its entire photo history.
async function sinceFor(admin: ReturnType<typeof supabaseAdmin>, tenantId: string): Promise<string> {
  const { data } = await admin
    .from('vision_sweep_runs')
    .select('started_at')
    .eq('tenant_id', tenantId).eq('status', 'completed')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const previous = (data as { started_at?: string } | null)?.started_at
  if (typeof previous === 'string') return previous
  return new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 86_400_000).toISOString()
}

export async function POST(req: Request) { return withCronLogging(req, () => handler(req)) }
export async function GET(req: Request)  { return withCronLogging(req, () => handler(req)) }
