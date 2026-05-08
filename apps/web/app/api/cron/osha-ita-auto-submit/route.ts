import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { submitToItaForEstablishment } from '@/lib/oshaItaSubmit'

// Cron: osha-ita-auto-submit.
//
// Daily background job that submits certified 300A summaries to
// OSHA's Injury Tracking Application on behalf of tenants who've
// opted in.
//
// Eligibility (all conditions must hold):
//   - osha_establishments.ita_auto_submit_enabled = true
//   - osha_establishments.ita_establishment_id is not null
//   - osha_establishments.ita_api_token is not null
//   - last attempt is at least 6 hours ago (back-off)
//   - osha_annual_summaries row exists for the most-recent submission
//     year (= current year - 1) AND certified_at is set AND
//     submitted_to_ita_at is null
//
// On stub mode (OSHA_ITA_BASE_URL unset) the cron exits early as a
// no-op — there's no point thrashing rows when the env isn't ready.
//
// Vercel schedule: 0 16 * * * (daily 16:00 UTC ≈ 11 EST). The ITA
// submission window is Jan 1 - Mar 2 each year, but running daily
// year-round is harmless: the eligibility filter ensures nothing
// fires outside the window.

export const runtime = 'nodejs'

const BACKOFF_HOURS = 6

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

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

async function runCron(): Promise<NextResponse> {
  // Stub mode short-circuit.
  if (!process.env.OSHA_ITA_BASE_URL) {
    return NextResponse.json({
      stub: true,
      reason: 'OSHA_ITA_BASE_URL is not configured. Cron is a no-op until the live ITA endpoint is wired up.',
      candidates: 0, succeeded: 0, failed: 0,
    })
  }

  const admin = supabaseAdmin()

  // Default submission year = previous calendar year.
  const today = new Date()
  const reportingYear = today.getUTCFullYear() - 1

  type Candidate = {
    id:                         string
    tenant_id:                  string
    establishment_name:         string
    ita_auto_submit_last_attempt_at: string | null
  }
  const { data: rows, error } = await admin
    .from('osha_establishments')
    .select('id, tenant_id, establishment_name, ita_auto_submit_last_attempt_at')
    .eq('ita_auto_submit_enabled', true)
    .not('ita_establishment_id', 'is', null)
    .not('ita_api_token', 'is', null)
  if (error) {
    Sentry.captureException(error, { tags: { cron: 'osha-ita-auto-submit', stage: 'list' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const candidates = (rows ?? []) as unknown as Candidate[]

  // Drop anything that attempted within the back-off window.
  const cutoff = new Date(today.getTime() - BACKOFF_HOURS * 3600 * 1000)
  const eligible = candidates.filter(c => {
    if (!c.ita_auto_submit_last_attempt_at) return true
    return new Date(c.ita_auto_submit_last_attempt_at) < cutoff
  })

  let succeeded = 0
  let failed = 0
  const failures: Array<{ establishment_id: string; error: string }> = []

  for (const c of eligible) {
    const attemptTs = new Date().toISOString()
    let result
    try {
      result = await submitToItaForEstablishment({
        tenant_id:        c.tenant_id,
        establishment_id: c.id,
        year:             reportingYear,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      Sentry.captureException(e, { tags: { cron: 'osha-ita-auto-submit' }, extra: { establishment_id: c.id } })
      result = { ok: false as const, error: msg, status: 500 }
    }

    // Always record the attempt (drives back-off).
    const lastError = result.ok === true ? null
      : result.ok === 'dry' || result.ok === 'stub' ? null
      : (result as { error: string }).error
    await admin
      .from('osha_establishments')
      .update({
        ita_auto_submit_last_attempt_at: attemptTs,
        ita_auto_submit_last_error:      lastError,
      })
      .eq('id', c.id)

    if (result.ok === true) succeeded++
    else if (result.ok === 'stub' || result.ok === 'dry') {
      // No-op cases: don't count as success or failure.
    }
    else {
      failed++
      failures.push({ establishment_id: c.id, error: lastError ?? 'unknown' })
    }
  }

  return NextResponse.json({
    reporting_year: reportingYear,
    candidates:     candidates.length,
    eligible:       eligible.length,
    succeeded,
    failed,
    failures:       failures.slice(0, 20),
  })
}
