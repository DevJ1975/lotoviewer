import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendAlert, type AlertChannel, type AlertAudience, type AlertResult } from '@/lib/ai/alerts'

// Cron: pick assistant_tasks rows where status='pending' AND run_at <= now()
// and execute them. Schedule (vercel.json): every 5 minutes.
//
// Auth: Bearer CRON_SECRET (Vercel scheduled invocation) OR
//       x-internal-secret INTERNAL_PUSH_SECRET (manual curl). Same
//       pattern as the other crons under /api/cron/.
//
// Concurrency: a row is reserved by transitioning pending → running
// in a single update. The cron runs every 5 minutes and a typical
// task completes in <1s — the chance of the next tick picking up an
// in-flight row is small in practice, but the status guard is here
// to make it impossible.
//
// Failure handling: an uncaught error in a single task transitions
// that row to 'failed' with last_error captured. Other tasks in the
// same tick proceed normally.

export const runtime     = 'nodejs'
export const maxDuration = 60

const TASK_BATCH_LIMIT = 50

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

interface TaskRow {
  id:              string
  tenant_id:       string
  user_id:         string
  conversation_id: string | null
  kind:            'alert' | 'reminder' | 'followup'
  payload:         {
    audience?:       string
    departmentName?: string | null
    message?:        string
    channels?:       string[]
  }
  run_at:          string
  attempts:        number
}

async function handler(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const nowIso = new Date().toISOString()

  // Pull pending rows due to fire. We don't claim them in the same
  // SELECT — Supabase's PostgREST doesn't expose SKIP LOCKED — so we
  // do the optimistic claim per row inside the loop. At 5-min cadence
  // the worst case is a single duplicate dispatch; the alert
  // executor's idempotency on (tenant, user, message) is "good
  // enough" for that — push de-dupes via tag, email accepts the
  // duplicate, in-app shows two rows. If duplicate cost ever bites
  // we'll add SKIP LOCKED via an RPC.
  const { data: rows, error: pickErr } = await admin
    .from('assistant_tasks')
    .select('id, tenant_id, user_id, conversation_id, kind, payload, run_at, attempts')
    .eq('status', 'pending')
    .lte('run_at', nowIso)
    .order('run_at', { ascending: true })
    .limit(TASK_BATCH_LIMIT)

  if (pickErr) {
    Sentry.captureException(pickErr, { tags: { source: 'cron.run-assistant-tasks.pick' } })
    return NextResponse.json({ error: pickErr.message }, { status: 500 })
  }
  const tasks = (rows ?? []) as TaskRow[]

  let executed = 0
  let failed   = 0
  const results: Array<{ id: string; ok: boolean; recipients?: number; error?: string }> = []

  for (const task of tasks) {
    // Optimistic claim: pending → running, only if still pending.
    const { data: claimed, error: claimErr } = await admin
      .from('assistant_tasks')
      .update({ status: 'running', attempts: task.attempts + 1, updated_at: nowIso })
      .eq('id', task.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (claimErr) {
      Sentry.captureException(claimErr, { tags: { source: 'cron.run-assistant-tasks.claim', task_id: task.id } })
      continue
    }
    if (!claimed) {
      // Another tick already claimed it — skip.
      continue
    }

    try {
      const r = await runTask(task)
      await admin.from('assistant_tasks').update({
        status:    'done',
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', task.id)
      executed++
      results.push({ id: task.id, ok: true, recipients: r?.recipients })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      Sentry.captureException(err, {
        tags: { source: 'cron.run-assistant-tasks.exec', task_id: task.id, kind: task.kind },
      })
      await admin.from('assistant_tasks').update({
        status:     'failed',
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq('id', task.id)
      failed++
      results.push({ id: task.id, ok: false, error: message })
    }
  }

  return NextResponse.json({
    ok:        true,
    picked:    tasks.length,
    executed,
    failed,
    results,
  })
}

async function runTask(task: TaskRow): Promise<AlertResult | null> {
  const channels = (task.payload.channels ?? []) as AlertChannel[]
  const message  = String(task.payload.message ?? '').trim()
  if (!message) throw new Error('task payload missing message')

  switch (task.kind) {
    case 'alert':
    case 'reminder':
    case 'followup': {
      const audience = (task.payload.audience ?? 'all') as AlertAudience
      const result = await sendAlert({
        tenantId:        task.tenant_id,
        audience,
        departmentName:  task.payload.departmentName ?? null,
        message,
        channels:        channels.length > 0 ? channels : ['in-app'],
        requesterId:     task.user_id,
      })
      return result
    }
  }
}

export async function POST(req: Request) { return withCronLogging(req, () => handler(req)) }
export async function GET(req: Request)  { return withCronLogging(req, () => handler(req)) }
