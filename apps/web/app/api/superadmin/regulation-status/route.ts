import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/regulation-status
//
// Backs the superadmin "Regulation freshness" panel. Returns the
// regulation_update_checks rows (maintained by /api/cron/check-regulation-updates
// and the ingester's record-snapshot.sql) so an operator can see, at a glance,
// whether the RAG corpus is behind the latest eCFR amendment.

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

export interface RegulationStatusRow {
  source:            string
  title:             string
  ecfr_title:        string
  ecfr_part:         string
  ingested_snapshot: string | null
  ingested_at:       string | null
  latest_amendment:  string | null
  needs_update:      boolean
  last_checked_at:   string | null
  last_notified_at:  string | null
}

/** A recent regulation_ingest job, for the panel's "recent loads" list. */
export interface RegulationJobRow {
  id:          string
  status:      'queued' | 'running' | 'succeeded' | 'failed'
  payload:     { source?: string; date?: string; dry_run?: boolean }
  progress:    Record<string, unknown> | null
  result:      Record<string, unknown> | null
  last_error:  string | null
  attempts:    number
  created_at:  string
  finished_at: string | null
}

export interface RegulationStatusResponse {
  rows: RegulationStatusRow[]
  jobs: RegulationJobRow[]
}

const RECENT_JOBS = 20
// Postgres / PostgREST codes for "the table is not there": migration 295 is applied by hand.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('regulation_update_checks')
    .select('source, title, ecfr_title, ecfr_part, ingested_snapshot, ingested_at, latest_amendment, needs_update, last_checked_at, last_notified_at')
    .order('source')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Recent loads. Before migration 295 there is no queue yet; that is not an error.
  const { data: jobs, error: jobsError } = await admin
    .from('service_jobs')
    .select('id, status, payload, progress, result, last_error, attempts, created_at, finished_at')
    .eq('kind', 'regulation_ingest')
    .order('created_at', { ascending: false })
    .limit(RECENT_JOBS)
  if (jobsError && !MISSING_TABLE_CODES.has(jobsError.code ?? '')) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 })
  }

  return NextResponse.json({
    rows: data ?? [],
    jobs: (jobsError ? [] : jobs ?? []) as RegulationJobRow[],
  } satisfies RegulationStatusResponse)
}
