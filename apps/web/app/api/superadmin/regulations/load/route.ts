import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { enqueueServiceJob } from '@/lib/serviceJobs'
import { findRegulationSource } from '@soteria/core/regulationSources'

// POST /api/superadmin/regulations/load
//
// Queues the Python service to load one part of the CFR into the shared
// knowledge base (the platform-level `regulation_ingest` job). Superadmin only:
// the result is shared by every tenant, and a real load spends embedding credits.
//
// Body: { source, date, dry_run? }
//   source   a key from REGULATION_SOURCES
//   date     the eCFR snapshot to load, YYYY-MM-DD (the part's latest amendment)
//   dry_run  defaults to TRUE. A dry run fetches and parses but writes nothing and
//            costs nothing, and reports what a real run would do: do one first.
//            Only an explicit `false` queues a real load.

export const runtime = 'nodejs'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { source?: unknown; date?: unknown; dry_run?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 }) }

  const source = typeof body.source === 'string' ? findRegulationSource(body.source) : undefined
  if (!source) return NextResponse.json({ error: 'Unknown regulation source.' }, { status: 400 })
  if (typeof body.date !== 'string' || !DATE_RE.test(body.date)) {
    return NextResponse.json({ error: 'date is required, as YYYY-MM-DD.' }, { status: 400 })
  }
  const dryRun = body.dry_run !== false

  const job = await enqueueServiceJob({
    kind: 'regulation_ingest',
    payload: { source: source.key, date: body.date, dry_run: dryRun },
    requestedBy: gate.userId,
    // One live job per part, date and mode: a dry run in flight must never be
    // returned in place of the real load someone just asked for.
    dedupeKey: `${source.key}:${body.date}:${dryRun ? 'dry' : 'load'}`,
  })
  if (!job) {
    return NextResponse.json(
      { error: 'The service could not queue this. Check that it is running with SERVICE_JOBS_ENABLED, that migrations 295 and 297 are applied, and that the date is real and not in the future.' },
      { status: 503 },
    )
  }
  return NextResponse.json({ job_id: job.jobId, dry_run: dryRun }, { status: 202 })
}
