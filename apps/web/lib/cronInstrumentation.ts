// Run-instrumentation helper for /api/cron/* routes.
//
// Each cron handler wraps itself with:
//
//   export async function GET(req: Request) {
//     return withCronLogging(req, () => runCron(req))
//   }
//
// where `runCron` returns a NextResponse as before. The wrapper:
//   1. INSERTs a cron_runs row with status='running'
//   2. Awaits the inner handler
//   3. UPDATEs the row to 'success' (2xx) or 'error' (everything else)
//      with ended_at + a summary line built from the response body
//   4. Returns the inner handler's NextResponse to the caller
//
// Best-effort: any failure to write the cron_runs row goes to Sentry
// but never blocks the cron's actual work. The dashboard treats a
// missing row as "no data" rather than as failure.
//
// Summary extraction: tries to read the response body to extract a
// shape-aware summary (e.g. archive cron returns { archived: 5 }),
// falling back to the HTTP status when the body isn't JSON or
// doesn't carry actionable data.

import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sentry from '@sentry/nextjs'
import type { NextResponse } from 'next/server'

export async function withCronLogging(
  req: Request,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const url = new URL(req.url)
  const path = url.pathname

  // Detect manual triggers via headers set by /api/superadmin/run-cron.
  const trigger = req.headers.get('x-cron-trigger') === 'manual' ? 'manual' : 'scheduled'
  const triggeredBy = req.headers.get('x-cron-triggered-by') ?? null

  const admin = supabaseAdmin()
  let runId: number | null = null

  try {
    const { data } = await admin
      .from('cron_runs')
      .insert({
        cron_path:    path,
        trigger,
        triggered_by: triggeredBy,
      })
      .select('id')
      .single()
    if (data) runId = data.id
  } catch (e) {
    Sentry.captureException(e, { tags: { source: 'cron-instrumentation', stage: 'insert' } })
  }

  let response: NextResponse
  let thrown: unknown = null
  try {
    response = await handler()
  } catch (err) {
    thrown = err
    response = null as unknown as NextResponse  // never returned; we re-throw
  }

  if (runId !== null) {
    const status = thrown
      ? 'error'
      : response.status >= 200 && response.status < 300
        ? 'success'
        : 'error'

    let summary: string | null = null
    if (thrown) {
      summary = thrown instanceof Error ? thrown.message.slice(0, 500) : String(thrown).slice(0, 500)
    } else {
      summary = await buildSummary(response).catch(() => null)
    }

    try {
      await admin
        .from('cron_runs')
        .update({
          ended_at: new Date().toISOString(),
          status,
          summary,
        })
        .eq('id', runId)
    } catch (e) {
      Sentry.captureException(e, { tags: { source: 'cron-instrumentation', stage: 'update' } })
    }
  }

  if (thrown) throw thrown
  return response
}

/** Best-effort summary extractor. Clones the response so the original
 *  body isn't consumed before being returned to the caller. */
async function buildSummary(response: NextResponse): Promise<string> {
  try {
    const cloned = response.clone()
    const body = await cloned.json() as Record<string, unknown>
    const interesting: string[] = []
    // Surface common count-style fields the existing crons return.
    for (const key of ['archived', 'emails_sent', 'tenants_scanned', 'recipients', 'count', 'updated', 'sent', 'alerts_sent']) {
      if (typeof body[key] === 'number') interesting.push(`${key}: ${body[key]}`)
    }
    if (typeof body.error === 'string') interesting.push(`error: ${body.error.slice(0, 80)}`)
    if (typeof body.message === 'string' && interesting.length === 0) interesting.push(body.message.slice(0, 100))
    return interesting.length > 0 ? interesting.join(', ') : `status: ${response.status}`
  } catch {
    return `status: ${response.status}`
  }
}
