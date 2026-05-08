import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { submitToItaForEstablishment } from '@/lib/oshaItaSubmit'

// POST /api/osha/300a/submit-to-ita
//
// Admin-triggered submission of a tenant's certified 300A annual
// summary (and 300+301 case rows for large establishments in
// Appendix B industries) to OSHA's Injury Tracking Application.
//
// Required body: { year:int, establishment_id:uuid }
// Optional body: { dry_run:bool } — builds the payload + returns it
//                without contacting OSHA. Useful for shape-validation
//                before go-live.
//
// The heavy lifting lives in lib/oshaItaSubmit so the daily
// auto-submit cron can share the same logic.
//
// Stub mode: when OSHA_ITA_BASE_URL is not set in env, the route
// runs everything except the outbound HTTP call and returns 501
// with the would-have-been payload.

interface PostBody {
  year:             number
  establishment_id: string
  dry_run?:         boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }) }

  const { year, establishment_id, dry_run } = body
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    return NextResponse.json({ error: 'year is required (int 2000-2100)' }, { status: 400 })
  if (!establishment_id || !UUID_RE.test(establishment_id))
    return NextResponse.json({ error: 'establishment_id (uuid) is required' }, { status: 400 })

  try {
    const result = await submitToItaForEstablishment({
      tenant_id:        gate.tenantId,
      establishment_id,
      year,
      dry_run,
      submitted_by:     gate.userId,
    })
    if (result.ok === true) {
      return NextResponse.json({
        submitted_at:  result.submitted_at,
        submission_id: result.submission_id,
        coverage:      result.coverage,
        upstream:      result.upstream,
      })
    }
    if (result.ok === 'dry') {
      return NextResponse.json({ dry_run: true, coverage: result.coverage, payload: result.payload })
    }
    if (result.ok === 'stub') {
      return NextResponse.json({
        error:    'ITA submission endpoint is not configured on this deploy.',
        hint:     result.hint + ' The payload we would have submitted is included for review.',
        coverage: result.coverage,
        payload:  result.payload,
      }, { status: 501 })
    }
    // Failure path.
    return NextResponse.json({
      error:    result.error,
      ...(result.upstream != null && { upstream: result.upstream }),
    }, { status: result.status })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'osha.submit_ita' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
