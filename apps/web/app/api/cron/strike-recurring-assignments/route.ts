import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'

export const runtime = 'nodejs'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

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

interface RecurrenceRule {
  interval_days?: unknown
  expiry_days?: unknown
}

interface AssignmentRow {
  id: string
  tenant_id: string
  module_id: string
  module_version_id: string | null
  target_type: string
  target_id: string | null
  assigned_by: string | null
  due_at: string | null
  recurrence_rule: RecurrenceRule | null
  reason: string | null
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
  const now = new Date()
  const nowIso = now.toISOString()

  try {
    const { data, error } = await admin
      .from('strike_assignments')
      .select('id,tenant_id,module_id,module_version_id,target_type,target_id,assigned_by,due_at,recurrence_rule,reason')
      .eq('status', 'active')
      .not('recurrence_rule', 'is', null)
      .lte('due_at', nowIso)
      .limit(500)
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as AssignmentRow[]
    let advanced = 0

    for (const row of rows) {
      const intervalDays = Number(row.recurrence_rule?.interval_days)
      if (!Number.isFinite(intervalDays) || intervalDays < 1) continue

      const base = row.due_at ? new Date(row.due_at) : now
      const nextDue = new Date(Math.max(base.getTime(), now.getTime()) + intervalDays * 86_400_000)
      const expiryDays = Number(row.recurrence_rule?.expiry_days)
      const nextExpiry = Number.isFinite(expiryDays) && expiryDays > 0
        ? new Date(nextDue.getTime() + expiryDays * 86_400_000).toISOString()
        : null

      const { error: updateErr } = await admin
        .from('strike_assignments')
        .update({
          due_at: nextDue.toISOString(),
          expires_at: nextExpiry,
          assigned_at: nowIso,
        })
        .eq('id', row.id)
      if (updateErr) throw new Error(updateErr.message)
      advanced += 1
    }

    return NextResponse.json({ assignments_scanned: rows.length, assignments_advanced: advanced })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/strike-recurring-assignments' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
