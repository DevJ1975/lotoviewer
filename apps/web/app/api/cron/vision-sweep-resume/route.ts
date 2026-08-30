import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { drainVisionSweep } from '@/lib/ai/vision/hazardSweep'

// Cron: drain open vision sweeps.
//
// /api/cron/vision-hazard-sweep only OPENS runs; this does the work. Each tick
// claims a bounded batch per open run, processes it inside a wall-clock budget
// well short of maxDuration, and returns — so a run of any size completes
// across successive ticks instead of being truncated when one invocation is
// reclaimed. Same shape as loto-audit-resume, for the same reason.
//
// Two housekeeping passes run first:
//   * Claimed rows that never completed are released back to 'queued'. Their
//     invocation died; without this they would sit claimed forever and the run
//     would never drain.
//   * Runs whose queue is empty are closed.
//
// Schedule (vercel.json): every 5 minutes.
// Auth: Bearer CRON_SECRET (Vercel) OR x-internal-secret INTERNAL_PUSH_SECRET.

export const runtime     = 'nodejs'
export const maxDuration = 300

// A claim older than this belongs to a dead invocation. Comfortably above one
// photo's download + vision call so a row still being worked is never stolen.
const CLAIM_STALE_SECONDS = 180
// Wall-clock budget for the drain itself, leaving headroom inside maxDuration
// for the housekeeping passes and the response.
const DRAIN_BUDGET_MS = 200_000
// Open runs advanced per tick. Keeps one busy tenant from starving the others.
const MAX_RUNS_PER_TICK = 3

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

interface RunRow {
  id:        string
  tenant_id: string
}

async function handler(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const startedAt = Date.now()

  const released = await releaseStaleClaims(admin)

  const { data, error } = await admin
    .from('vision_sweep_runs')
    .select('id, tenant_id')
    .eq('status', 'running')
    .order('started_at', { ascending: true })
    .limit(MAX_RUNS_PER_TICK)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const runs = (data ?? []) as RunRow[]
  const drained: Record<string, unknown>[] = []

  for (const run of runs) {
    const remaining = DRAIN_BUDGET_MS - (Date.now() - startedAt)
    if (remaining <= 10_000) break

    try {
      const result = await drainVisionSweep(admin, {
        runId:    run.id,
        tenantId: run.tenant_id,
        budgetMs: remaining,
      })
      drained.push({ runId: run.id, ...result })
    } catch (err) {
      // drainVisionSweep marks the run failed for errors it owns (no API key,
      // budget exhausted). Anything reaching here is unexpected — record it and
      // let the next tick retry rather than failing the whole cron.
      Sentry.captureException(err, { tags: { cron: 'vision-sweep-resume', run_id: run.id } })
      drained.push({ runId: run.id, error: err instanceof Error ? err.message : 'unknown error' })
    }
  }

  return NextResponse.json({ ok: true, released, runsAdvanced: drained.length, drained })
}

// Rows whose worker died mid-flight. Returning them to 'queued' is safe because
// signal writes are upserts on a content-addressed natural key: re-processing a
// photo cannot create a second copy of the same finding.
async function releaseStaleClaims(admin: ReturnType<typeof supabaseAdmin>): Promise<number> {
  const cutoff = new Date(Date.now() - CLAIM_STALE_SECONDS * 1000).toISOString()
  const { data, error } = await admin
    .from('vision_sweep_photos')
    .update({ state: 'queued', claimed_at: null })
    .eq('state', 'claimed')
    .lt('claimed_at', cutoff)
    .select('id')
  if (error) {
    Sentry.captureException(new Error(error.message), { tags: { cron: 'vision-sweep-resume', step: 'release' } })
    return 0
  }
  return (data ?? []).length
}

export async function POST(req: Request) { return withCronLogging(req, () => handler(req)) }
export async function GET(req: Request)  { return withCronLogging(req, () => handler(req)) }
