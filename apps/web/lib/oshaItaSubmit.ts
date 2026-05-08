// Reusable OSHA ITA submission helper.
//
// Both /api/osha/300a/submit-to-ita (interactive, admin-triggered)
// and /api/cron/osha-ita-auto-submit (daily background job) route
// through this. The HTTP layers handle auth + body parsing + the
// JSON shape they return; the heavy lifting — load establishment +
// summary, classify coverage, build the payload, POST to OSHA,
// persist the response — lives here.
//
// Returns a discriminated union:
//
//   { ok: true,   submitted_at, submission_id, coverage, payload }
//   { ok: 'dry',  payload, coverage }                          (dry run)
//   { ok: 'stub', payload, coverage }                          (env not configured)
//   { ok: false,  error, status, payload? }
//
// `status` is the HTTP status the caller should reflect upstream.

import {
  buildItaSubmissionPayload,
  classifyItaCoverage,
  appendixForNaics,
  type Osha300ASummary,
  type ItaCoverage,
  type ItaSubmissionPayload,
} from '@soteria/core/oshaForms'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sentry from '@sentry/nextjs'

interface SubmitOpts {
  tenant_id:        string
  establishment_id: string
  year:             number
  /** Set true to skip the outbound HTTP and return the payload only. */
  dry_run?:         boolean
  /** Optional auth.users id to record on the row when persisting. */
  submitted_by?:    string | null
}

export type SubmitResult =
  | { ok: true;   submitted_at: string; submission_id: string | null; coverage: ItaCoverage; payload: ItaSubmissionPayload; upstream: unknown }
  | { ok: 'dry';  coverage: ItaCoverage; payload: ItaSubmissionPayload }
  | { ok: 'stub'; coverage: ItaCoverage; payload: ItaSubmissionPayload; hint: string }
  | { ok: false;  error: string; status: number; payload?: ItaSubmissionPayload; upstream?: unknown }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function submitToItaForEstablishment(opts: SubmitOpts): Promise<SubmitResult> {
  const { tenant_id, establishment_id, year, dry_run, submitted_by } = opts
  if (!UUID_RE.test(tenant_id))
    return { ok: false, error: 'tenant_id must be a uuid', status: 400 }
  if (!UUID_RE.test(establishment_id))
    return { ok: false, error: 'establishment_id must be a uuid', status: 400 }
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    return { ok: false, error: 'year is required (int 2000-2100)', status: 400 }

  const admin = supabaseAdmin()

  // ── Load establishment ────────────────────────────────────────────────
  type EstRow = {
    id:                   string
    establishment_name:   string
    street:               string | null
    city:                 string | null
    state:                string | null
    zip:                  string | null
    naics_code:           string | null
    ita_establishment_id: string | null
    ita_api_token:        string | null
  }
  const { data: estData, error: estErr } = await admin
    .from('osha_establishments')
    .select('id, establishment_name, street, city, state, zip, naics_code, ita_establishment_id, ita_api_token')
    .eq('id', establishment_id)
    .eq('tenant_id', tenant_id)
    .maybeSingle()
  if (estErr) return { ok: false, error: estErr.message, status: 500 }
  const est = estData as unknown as EstRow | null
  if (!est) return { ok: false, error: 'Establishment not found', status: 404 }
  if (!est.ita_establishment_id)
    return { ok: false, error: 'Missing OSHA Establishment ID. Register at osha.gov/ita and paste the ID into Settings.', status: 400 }
  if (!est.ita_api_token)
    return { ok: false, error: 'Missing ITA API token. Generate one in the ITA admin console and paste it into Settings.', status: 400 }

  // ── Load certified 300A summary ───────────────────────────────────────
  type SummaryRow = {
    id:                    string
    totals_json:           Osha300ASummary
    total_hours_worked:    number
    annual_avg_employees:  number
    certified_at:          string | null
    certified_typed_name:  string | null
    submitted_to_ita_at:   string | null
    ita_submission_id:     string | null
  }
  const { data: summaryData, error: sErr } = await admin
    .from('osha_annual_summaries')
    .select('id, totals_json, total_hours_worked, annual_avg_employees, certified_at, certified_typed_name, submitted_to_ita_at, ita_submission_id')
    .eq('tenant_id', tenant_id)
    .eq('establishment_id', establishment_id)
    .eq('year', year)
    .maybeSingle()
  if (sErr) return { ok: false, error: sErr.message, status: 500 }
  const summary = summaryData as unknown as SummaryRow | null
  if (!summary)
    return { ok: false, error: `No 300A on file for ${year}. Certify first.`, status: 400 }
  if (!summary.certified_at)
    return { ok: false, error: '300A must be certified by a company executive before electronic submission.', status: 400 }
  if (summary.submitted_to_ita_at)
    return {
      ok: false, status: 409,
      error: 'This summary has already been submitted to OSHA ITA on '
        + new Date(summary.submitted_to_ita_at).toLocaleString()
        + (summary.ita_submission_id ? ` (tracking id ${summary.ita_submission_id})` : '') + '.',
    }

  // ── Build payload + classify coverage ─────────────────────────────────
  const totals = summary.totals_json
  const appendix = appendixForNaics(est.naics_code)
  const coverage = classifyItaCoverage({
    annual_avg_employees: summary.annual_avg_employees,
    appendix,
  })
  const payload = buildItaSubmissionPayload({
    year,
    establishment_id:     est.ita_establishment_id,
    establishment_name:   est.establishment_name,
    street:               est.street,
    city:                 est.city,
    state:                est.state,
    zip:                  est.zip,
    naics_code:           est.naics_code,
    industry_description: null,
    summary:              totals,
    certified_typed_name: summary.certified_typed_name,
    certified_at:         summary.certified_at,
    include_cases:        coverage === 'summary_and_cases',
    cases:                undefined,
  })

  if (dry_run) return { ok: 'dry', coverage, payload }

  // ── Stub mode (no live endpoint configured) ───────────────────────────
  const baseUrl    = process.env.OSHA_ITA_BASE_URL
  const authHeader = process.env.OSHA_ITA_AUTH_HEADER ?? 'Authorization'
  if (!baseUrl) {
    return {
      ok: 'stub', coverage, payload,
      hint: 'Set OSHA_ITA_BASE_URL (and OSHA_ITA_AUTH_HEADER if non-default) ' +
        'in env after verifying OSHA\'s current ITA API contract.',
    }
  }

  // ── Live submission ───────────────────────────────────────────────────
  let upstream: Response
  try {
    upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/submission`, {
      method: 'POST',
      headers: {
        'content-type':  'application/json',
        'accept':        'application/json',
        [authHeader]:    `Bearer ${est.ita_api_token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { component: 'oshaItaSubmit' } })
    return { ok: false, error: `Could not reach OSHA ITA: ${msg}`, status: 502, payload }
  }

  let upstreamBody: unknown
  try { upstreamBody = await upstream.json() }
  catch { upstreamBody = { _raw: await upstream.text().catch(() => '') } }

  if (!upstream.ok) {
    Sentry.captureMessage('OSHA ITA submission rejected', {
      level: 'warning',
      extra: { status: upstream.status, body: upstreamBody, establishment_id, year },
    })
    return {
      ok: false,
      error: `OSHA ITA rejected the submission (HTTP ${upstream.status}).`,
      status: 502,
      upstream: upstreamBody,
      payload,
    }
  }

  const submissionId =
    typeof upstreamBody === 'object' && upstreamBody !== null && 'submission_id' in upstreamBody
      ? String((upstreamBody as Record<string, unknown>).submission_id)
      : null

  // ── Persist ───────────────────────────────────────────────────────────
  const submittedAt = new Date().toISOString()
  const { error: updErr } = await admin
    .from('osha_annual_summaries')
    .update({
      submitted_to_ita_at: submittedAt,
      ita_submission_id:   submissionId,
      ita_response_json:   upstreamBody,
      submitted_by:        submitted_by ?? null,
    })
    .eq('id', summary.id)
  if (updErr) {
    Sentry.captureException(new Error('ITA persisted submission row update failed'), {
      extra: { id: summary.id, error: updErr.message },
    })
  }

  return {
    ok: true,
    submitted_at:  submittedAt,
    submission_id: submissionId,
    coverage,
    payload,
    upstream:      upstreamBody,
  }
}
