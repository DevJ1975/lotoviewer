import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  buildItaSubmissionPayload,
  classifyItaCoverage,
  type Osha300ASummary,
} from '@soteria/core/oshaForms'

// POST /api/osha/300a/submit-to-ita
//
// Submits a tenant's certified 300A annual summary (and 300+301 case
// rows for large establishments in Appendix B industries) to OSHA's
// Injury Tracking Application.
//
// Required body: { year:int, establishment_id:uuid }
// Optional body: { dry_run:bool } — builds the payload + returns it
//                without contacting OSHA. Useful in tests + before
//                go-live so an admin can preview what will be sent.
//
// Pre-conditions enforced here:
//   - admin caller (token + RLS aren't enough for an irreversible
//     external regulatory submission)
//   - 300A is certified (osha_annual_summaries.certified_at is set)
//   - establishment has both ita_establishment_id + ita_api_token set
//   - not already submitted (refuse re-submit unless ?force=1, which
//     is a future story; for now hard-fail to prevent dupes)
//
// Stub mode: when OSHA_ITA_BASE_URL is not set in env, the route
// runs everything except the outbound HTTP call and returns 501
// with the would-have-been payload. This lets an admin verify the
// wiring end-to-end before the customer's IT team finishes ITA
// registration.
//
// Sandbox-honesty: I could not verify OSHA's current ITA endpoint
// schema or auth from this development sandbox (osha.gov is
// blocked at the egress firewall). The submission body shape comes
// from the documented CSV columns; if OSHA's JSON contract differs,
// the field names need adjusting. Audit `OSHA_ITA_BASE_URL` +
// `OSHA_ITA_AUTH_HEADER` env names + the payload shape against
// live OSHA developer docs before flipping a tenant live.

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
    const admin = supabaseAdmin()

    // Load establishment (including ITA credentials).
    type EstRow = {
      id:                   string
      tenant_id:            string
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
      .select(
        'id, tenant_id, establishment_name, street, city, state, zip, naics_code,' +
        ' ita_establishment_id, ita_api_token',
      )
      .eq('id', establishment_id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (estErr) throw new Error(estErr.message)
    const est = estData as unknown as EstRow | null
    if (!est) return NextResponse.json({ error: 'Establishment not found' }, { status: 404 })

    if (!est.ita_establishment_id)
      return NextResponse.json({
        error: 'Establishment is missing the OSHA-issued Establishment ID. ' +
          'Register the site at osha.gov/ita and paste the ID into Settings.',
      }, { status: 400 })
    if (!est.ita_api_token)
      return NextResponse.json({
        error: 'Establishment is missing its ITA API token. ' +
          'Generate one in the ITA admin console and paste it into Settings.',
      }, { status: 400 })

    // Load the certified 300A summary.
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
      .select('id, totals_json, total_hours_worked, annual_avg_employees,' +
              ' certified_at, certified_typed_name, submitted_to_ita_at,' +
              ' ita_submission_id')
      .eq('tenant_id', gate.tenantId)
      .eq('establishment_id', establishment_id)
      .eq('year', year)
      .maybeSingle()
    if (sErr) throw new Error(sErr.message)
    const summary = summaryData as unknown as SummaryRow | null
    if (!summary)
      return NextResponse.json({
        error: `No 300A on file for ${year}. Certify first.`,
      }, { status: 400 })
    if (!summary.certified_at)
      return NextResponse.json({
        error: '300A must be certified by a company executive before electronic submission.',
      }, { status: 400 })
    if (summary.submitted_to_ita_at)
      return NextResponse.json({
        error: 'This summary has already been submitted to OSHA ITA on ' +
          new Date(summary.submitted_to_ita_at).toLocaleString() +
          (summary.ita_submission_id ? ` (tracking id ${summary.ita_submission_id})` : '') + '.',
      }, { status: 409 })

    // Build the payload. We don't yet maintain an Appendix-A/B NAICS
    // lookup; until that lands, default appendix=null and let admins
    // override via the dry-run preview.
    const totals = summary.totals_json as Osha300ASummary
    const coverage = classifyItaCoverage({
      annual_avg_employees: summary.annual_avg_employees,
      appendix: null,
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
      // 300/301 case rows would be loaded here when include_cases=true.
      // Deferred — ITA's 300/301 schema needs verification first.
      cases:                undefined,
    })

    if (dry_run) {
      return NextResponse.json({
        dry_run: true,
        coverage,
        payload,
      })
    }

    // Stub mode — env not configured. Return 501 with the payload so
    // an admin can confirm the shape before going live.
    const baseUrl    = process.env.OSHA_ITA_BASE_URL
    const authHeader = process.env.OSHA_ITA_AUTH_HEADER ?? 'Authorization'
    if (!baseUrl) {
      return NextResponse.json({
        error: 'ITA submission endpoint is not configured on this deploy.',
        hint:  'Set OSHA_ITA_BASE_URL (and OSHA_ITA_AUTH_HEADER if non-default) ' +
          'in env after verifying OSHA\'s current ITA API contract. The payload ' +
          'we would have submitted is included for review.',
        coverage,
        payload,
      }, { status: 501 })
    }

    // Live submission.
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
      Sentry.captureException(e, { tags: { route: 'osha.submit_ita' } })
      return NextResponse.json({
        error: `Could not reach OSHA ITA: ${msg}`,
      }, { status: 502 })
    }

    let upstreamBody: unknown
    try { upstreamBody = await upstream.json() }
    catch { upstreamBody = { _raw: await upstream.text().catch(() => '') } }

    if (!upstream.ok) {
      Sentry.captureMessage('OSHA ITA submission rejected', {
        level: 'warning',
        extra: { status: upstream.status, body: upstreamBody },
      })
      return NextResponse.json({
        error: `OSHA ITA rejected the submission (HTTP ${upstream.status}).`,
        upstream: upstreamBody,
      }, { status: 502 })
    }

    // Persist the result.
    const submissionId =
      typeof upstreamBody === 'object' && upstreamBody !== null && 'submission_id' in upstreamBody
        ? String((upstreamBody as Record<string, unknown>).submission_id)
        : null

    const { error: updErr } = await admin
      .from('osha_annual_summaries')
      .update({
        submitted_to_ita_at: new Date().toISOString(),
        ita_submission_id:   submissionId,
        ita_response_json:   upstreamBody,
        submitted_by:        gate.userId,
      })
      .eq('id', summary.id)
    if (updErr) {
      // Log but still return success — OSHA accepted, we just lost the
      // bookkeeping. Operator can replay from Sentry.
      Sentry.captureException(new Error('ITA persisted submission row update failed'), {
        extra: { id: summary.id, error: updErr.message },
      })
    }

    return NextResponse.json({
      submitted_at:    new Date().toISOString(),
      submission_id:   submissionId,
      coverage,
      upstream:        upstreamBody,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'osha.submit_ita' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
