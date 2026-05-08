import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { runDriftCheck, type DriftCheckRow } from '@/lib/chemicalSdsDrift'

// Daily SDS-drift cron.
//
// Iterates every chemical_products row with a `sds_source_url` set whose
// active SDS hasn't been re-checked in CHECK_INTERVAL_DAYS (or never).
// Caps per-tenant work so a tenant with thousands of products doesn't
// chew the entire run window in a single execution; the next run picks
// up where this one stopped.
//
// Auth + run-logging follow the same posture as the other crons.

export const runtime = 'nodejs'
// Most chems are checked once per quarter; revisions are rare and
// the cap protects per-run cost. Tenants with hot products can hit
// the manual button.
const CHECK_INTERVAL_DAYS = 30
const MAX_PER_RUN          = 50

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
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

export async function GET(req: Request)  {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

interface ProductRow {
  id:                string
  tenant_id:         string
  active_sds_id:     string | null
  sds_source_url:    string | null
  sds_revision_date: string | null
}

async function runCron(): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - CHECK_INTERVAL_DAYS)
  const cutoffIso = cutoff.toISOString()

  let candidates: ProductRow[] = []
  try {
    // Pull products with a source_url, not archived, and either never
    // checked or last-checked > CHECK_INTERVAL_DAYS ago. The "never
    // checked" arm is captured by the LEFT JOIN trick below — we use
    // the latest checked_at via a sub-select.
    const { data, error } = await admin
      .from('chemical_products')
      .select(`
        id, tenant_id, active_sds_id, sds_source_url, sds_revision_date,
        chemical_sds_revision_checks ( checked_at )
      `)
      .not('sds_source_url', 'is', null)
      .is('archived_at', null)
      .order('updated_at', { ascending: true })
      .limit(500)
    if (error) throw new Error(error.message)

    candidates = (data ?? [])
      .filter(p => {
        const checks = (p as { chemical_sds_revision_checks?: { checked_at: string }[] }).chemical_sds_revision_checks
        if (!checks || checks.length === 0) return true
        const newest = checks
          .map(c => c.checked_at)
          .sort()
          .reverse()[0]
        return !newest || newest < cutoffIso
      })
      .slice(0, MAX_PER_RUN)
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'check-sds-revisions', stage: 'select' } })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const counts = { checked: 0, unchanged: 0, newer: 0, older: 0, unknown: 0, fetch_failed: 0 }

  for (const p of candidates) {
    if (!p.sds_source_url) continue
    counts.checked += 1
    try {
      const row: DriftCheckRow = {
        id:                p.id,
        tenant_id:         p.tenant_id,
        source_url:        p.sds_source_url,
        sds_revision_date: p.sds_revision_date,
        active_sds_id:     p.active_sds_id,
      }
      const result = await runDriftCheck({
        product:     row,
        trigger:     'scheduled',
        triggeredBy: null,
      })
      counts[result.outcome] = (counts[result.outcome] ?? 0) + 1
    } catch (err) {
      Sentry.captureException(err, { tags: { source: 'check-sds-revisions', product: p.id } })
      counts.unknown += 1
    }
  }

  return NextResponse.json({
    candidates_considered: candidates.length,
    counts,
  })
}
