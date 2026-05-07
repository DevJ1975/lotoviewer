import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/cron-runs?days=7
//
// Superadmin-only. Returns the most recent cron_runs rows in the
// requested window plus a per-cron summary (last fired + last
// status). The /superadmin/cron page consumes this.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 7
const MAX_DAYS     = 90

export interface CronRunRow {
  id:           number
  cron_path:    string
  started_at:   string
  ended_at:     string | null
  status:       'running' | 'success' | 'error' | null
  summary:      string | null
  trigger:      'scheduled' | 'manual'
  triggered_by: string | null
}

export interface CronRunsResponse {
  windowDays: number
  runs:       CronRunRow[]
  perCron: Array<{
    cron_path:        string
    last_started_at:  string
    last_ended_at:    string | null
    last_status:      'running' | 'success' | 'error' | null
    last_summary:     string | null
    last_trigger:     'scheduled' | 'manual'
    runs_in_window:   number
    error_count:      number
  }>
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const daysRaw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS)
  const days = Number.isFinite(daysRaw) && daysRaw > 0
    ? Math.min(Math.floor(daysRaw), MAX_DAYS)
    : DEFAULT_DAYS

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const admin = supabaseAdmin()

  const { data, error } = await admin
    .from('cron_runs')
    .select('id, cron_path, started_at, ended_at, status, summary, trigger, triggered_by')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const runs = (data ?? []) as CronRunRow[]

  // Roll up to per-cron summary. The first row encountered for each
  // cron_path is the most recent (response is ordered by started_at desc).
  const perCronMap = new Map<string, CronRunsResponse['perCron'][number]>()
  for (const r of runs) {
    let row = perCronMap.get(r.cron_path)
    if (!row) {
      row = {
        cron_path:       r.cron_path,
        last_started_at: r.started_at,
        last_ended_at:   r.ended_at,
        last_status:     r.status,
        last_summary:    r.summary,
        last_trigger:    r.trigger,
        runs_in_window:  0,
        error_count:     0,
      }
      perCronMap.set(r.cron_path, row)
    }
    row.runs_in_window += 1
    if (r.status === 'error') row.error_count += 1
  }

  const perCron = Array.from(perCronMap.values())
    .sort((a, b) => a.cron_path.localeCompare(b.cron_path))

  const payload: CronRunsResponse = { windowDays: days, runs, perCron }
  return NextResponse.json(payload)
}
