import { NextResponse, after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { runAudit, type RunAuditScope } from '@/lib/loto/audit/runAudit'

// Cron: resume LOTO audit runs that stalled mid-sweep.
//
// A multi-agent audit fans out hundreds of model calls; a single serverless
// invocation gets reclaimed long before a large scope finishes, leaving the run
// 'running' with partial progress. The engine is resumable (it skips equipment
// already at agent_phase='ehs_done'), so this cron re-kicks any 'running' run
// that hasn't made progress recently — letting "Start and walk away" complete
// the full inventory across many ticks without a human re-triggering each chunk.
//
// Schedule (vercel.json): every 5 minutes.
// Auth: Bearer CRON_SECRET (Vercel) OR x-internal-secret INTERNAL_PUSH_SECRET
//       (manual curl) — the same pattern as the other crons.

export const runtime     = 'nodejs'
export const maxDuration = 300

// A run with no result-row update for this long is treated as stalled (its
// invocation died). Comfortably above a single equipment's FPE→DS→EHS time so
// we never re-kick a run whose invocation is still actively working.
const STALL_SECONDS = 150
// Cap concurrent resumes per tick so one cron invocation doesn't try to run
// several full sweeps at once.
const MAX_RESUMES_PER_TICK = 3

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
  id:          string
  tenant_id:   string
  scope:       RunAuditScope | null
  created_by:  string | null
  started_at:  string
}

async function handler(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const { data: runs, error } = await admin
    .from('loto_audit_runs')
    .select('id, tenant_id, scope, created_by, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: true })
    .limit(20)
  if (error) {
    Sentry.captureException(error, { tags: { source: 'cron.loto-audit-resume.pick' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const resumed: string[] = []
  const skipped: string[] = []

  for (const run of (runs ?? []) as RunRow[]) {
    if (resumed.length >= MAX_RESUMES_PER_TICK) break

    // Last activity = newest result-row update, or the run's start if it never
    // produced one (it died very early).
    const { data: last } = await admin
      .from('loto_audit_equipment_results')
      .select('updated_at')
      .eq('run_id', run.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ updated_at: string }>()
    const lastActivity = last?.updated_at ? Date.parse(last.updated_at) : Date.parse(run.started_at)

    if (now - lastActivity < STALL_SECONDS * 1000) {
      skipped.push(run.id)  // still actively processing — leave it alone
      continue
    }

    // Stalled → resume. The engine skips finished equipment and flips the run
    // to 'awaiting_review' when the sweep completes, after which this cron
    // stops picking it up.
    after(() =>
      runAudit({ tenantId: run.tenant_id, runId: run.id, userId: run.created_by ?? null, scope: run.scope ?? {} })
        .catch(err => Sentry.captureException(err, {
          tags: { source: 'cron.loto-audit-resume.run' }, extra: { runId: run.id },
        })),
    )
    resumed.push(run.id)
  }

  return NextResponse.json({ ok: true, running: (runs ?? []).length, resumed, skipped })
}

export async function POST(req: Request) { return withCronLogging(req, () => handler(req)) }
export async function GET(req: Request)  { return withCronLogging(req, () => handler(req)) }
