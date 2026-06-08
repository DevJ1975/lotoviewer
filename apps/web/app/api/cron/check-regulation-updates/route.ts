import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendRegulationUpdateAlert } from '@/lib/email/sendRegulationUpdateAlert'
import { pickLatestAmendment, computeNeedsUpdate, type EcfrVersion } from '@/lib/regulationFreshness'

// Regulation-freshness cron (~every 60 days; scheduled bi-monthly in vercel.json).
//
// The assistant answers OSHA questions via RAG over knowledge_documents. That
// corpus (29 CFR Part 1910) is built offline by scripts/osha_1910_ingest.py from a
// pinned eCFR snapshot — eCFR is too large and Voyage too slow to ingest inside a
// Vercel function. eCFR amends Part 1910 a few times a year, so this cron polls
// eCFR's versions API for each tracked corpus, compares the newest amendment date
// against the snapshot we last ingested (regulation_update_checks.ingested_snapshot),
// and emails the operator to re-run the ingester when an update is due. It does NOT
// re-ingest — that's a deliberate operator action with a Voyage cost.
//
// Auth + run-logging follow the same posture as the other crons.

export const runtime = 'nodejs'

// Don't re-nag more than this often (protects against manual re-triggers). The
// scheduled cadence is bi-monthly, so a still-outdated corpus is reminded then.
const RENOTIFY_AFTER_DAYS = 14
const ECFR_TIMEOUT_MS     = 20_000

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

interface CheckRow {
  source:            string
  title:             string
  ecfr_title:        string
  ecfr_part:         string
  ingested_snapshot: string | null
  last_notified_at:  string | null
}

interface EcfrVersionsResponse {
  content_versions?: EcfrVersion[]
}

// Newest amendment date eCFR reports for a CFR title+part, as an ISO date string.
// Returns null when eCFR is unreachable or reports no versions.
async function fetchLatestAmendment(title: string, part: string): Promise<string | null> {
  const url = `https://www.ecfr.gov/api/versioner/v1/versions/title-${title}.json?part=${part}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ECFR_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'SoteriaField-RAG/1.0 (+https://soteriafield.app)' },
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as EcfrVersionsResponse
    return pickLatestAmendment(json.content_versions ?? [], part)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function runCron(): Promise<NextResponse> {
  const admin = supabaseAdmin()

  let rows: CheckRow[] = []
  try {
    const { data, error } = await admin
      .from('regulation_update_checks')
      .select('source, title, ecfr_title, ecfr_part, ingested_snapshot, last_notified_at')
    if (error) throw new Error(error.message)
    rows = data ?? []
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'check-regulation-updates', stage: 'select' } })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const to = process.env.SUPPORT_EMAIL ?? 'jamil@trainovations.com'
  const nowIso = new Date().toISOString()
  const counts = { checked: 0, outdated: 0, alerts_sent: 0, fetch_failed: 0 }

  for (const row of rows) {
    counts.checked += 1
    const latest = await fetchLatestAmendment(row.ecfr_title, row.ecfr_part)

    if (latest === null) {
      counts.fetch_failed += 1
      await admin
        .from('regulation_update_checks')
        .update({ last_checked_at: nowIso, updated_at: nowIso })
        .eq('source', row.source)
      continue
    }

    const needsUpdate = computeNeedsUpdate(latest, row.ingested_snapshot)
    if (needsUpdate) counts.outdated += 1

    // Throttle re-notification so manual re-triggers don't spam the operator.
    const notifiedRecently =
      row.last_notified_at !== null &&
      Date.now() - new Date(row.last_notified_at).getTime() < RENOTIFY_AFTER_DAYS * 86_400_000

    let notifiedAt = row.last_notified_at
    if (needsUpdate && !notifiedRecently) {
      const sent = await sendRegulationUpdateAlert({
        to,
        title:            row.title,
        ecfrPart:         row.ecfr_part,
        latestAmendment:  latest,
        ingestedSnapshot: row.ingested_snapshot,
      })
      if (sent) {
        counts.alerts_sent += 1
        notifiedAt = nowIso
      }
    }

    await admin
      .from('regulation_update_checks')
      .update({
        latest_amendment: latest,
        needs_update:     needsUpdate,
        last_checked_at:  nowIso,
        last_notified_at: notifiedAt,
        updated_at:       nowIso,
      })
      .eq('source', row.source)
  }

  return NextResponse.json(counts)
}
