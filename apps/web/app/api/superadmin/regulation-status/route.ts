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

export interface RegulationStatusResponse {
  rows: RegulationStatusRow[]
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('regulation_update_checks')
    .select('source, title, ecfr_title, ecfr_part, ingested_snapshot, ingested_at, latest_amendment, needs_update, last_checked_at, last_notified_at')
    .order('source')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] } satisfies RegulationStatusResponse)
}
