import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { renderOsha300APdf } from '@/lib/pdfOsha300A'
import {
  build300ASummary,
  type Osha300Row,
  type Osha300ASummary,
} from '@soteria/core/oshaForms'

// GET  /api/osha/300a?year=&establishment=[&format=pdf]
//   Computes the 300A summary from the cached 300 log entries +
//   establishment hours/employees jsonb. If a certified
//   osha_annual_summaries row exists, returns its locked totals
//   instead (so a later edit to a 300 row doesn't retroactively
//   change a posted form).
//
// POST /api/osha/300a   body: { year, establishment_id, certified_typed_name? }
//   Locks the 300A: persists the computed totals + (if a name is
//   typed) the certifying signature. Idempotent on
//   (tenant_id, establishment_id, year).
//   Admin or owner.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface EstablishmentRow {
  id:                          string
  establishment_name:          string
  street:                      string | null
  city:                        string | null
  state:                       string | null
  zip:                         string | null
  naics_code:                  string | null
  hours_employees_by_year:     Record<string, { employees?: number; hours?: number }> | null
  certifying_executive_name:   string | null
  certifying_executive_title:  string | null
  is_partial_year:             boolean
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const yearStr = url.searchParams.get('year') ?? ''
  const year = parseInt(yearStr, 10)
  if (!yearStr || !Number.isInteger(year))
    return NextResponse.json({ error: '?year= is required' }, { status: 400 })
  const establishmentId = url.searchParams.get('establishment') ?? ''
  if (!UUID_RE.test(establishmentId))
    return NextResponse.json({ error: '?establishment= is required' }, { status: 400 })
  const format = url.searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'pdf')
    return NextResponse.json({ error: '?format= must be json or pdf' }, { status: 400 })

  try {
    const [estRes, logRes, certRes] = await Promise.all([
      gate.authedClient
        .from('osha_establishments')
        .select('id, establishment_name, street, city, state, zip, naics_code, hours_employees_by_year, certifying_executive_name, certifying_executive_title, is_partial_year')
        .eq('id', establishmentId)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle(),
      gate.authedClient
        .from('osha_300_log_entries')
        .select('case_number, employee_name, job_title, date_of_injury, location_text, injury_description, classification, days_away, days_restricted, injury_type, is_privacy_case')
        .eq('tenant_id', gate.tenantId)
        .eq('establishment_id', establishmentId)
        .eq('year', year),
      gate.authedClient
        .from('osha_annual_summaries')
        .select('totals_json, total_hours_worked, annual_avg_employees, certified_by, certified_at, certified_typed_name, posted_at, submitted_to_ita_at, ita_submission_id')
        .eq('tenant_id', gate.tenantId)
        .eq('establishment_id', establishmentId)
        .eq('year', year)
        .maybeSingle(),
    ])

    if (estRes.error) throw new Error(estRes.error.message)
    if (logRes.error) throw new Error(logRes.error.message)
    if (certRes.error) throw new Error(certRes.error.message)

    const est = estRes.data as EstablishmentRow | null
    if (!est) return NextResponse.json({ error: 'Establishment not found' }, { status: 404 })

    const cert = certRes.data as {
      totals_json:           Osha300ASummary
      total_hours_worked:    number
      annual_avg_employees:  number
      certified_by:          string | null
      certified_at:          string | null
      certified_typed_name:  string | null
      posted_at:             string | null
      submitted_to_ita_at:   string | null
      ita_submission_id:     string | null
    } | null

    const yearKey = String(year)
    const yearInputs = est.hours_employees_by_year?.[yearKey] ?? { employees: 0, hours: 0 }
    const hours     = cert?.total_hours_worked    ?? yearInputs.hours    ?? 0
    const employees = cert?.annual_avg_employees  ?? yearInputs.employees ?? 0

    const summary: Osha300ASummary = cert?.totals_json ?? build300ASummary({
      rows: (logRes.data ?? []) as Osha300Row[],
      year,
      total_hours_worked:   hours,
      annual_avg_employees: employees,
    })

    if (format === 'pdf') {
      const bytes = await renderOsha300APdf({
        summary,
        establishment: {
          name:                       est.establishment_name,
          street:                     est.street,
          city:                       est.city,
          state:                      est.state,
          zip:                        est.zip,
          naics_code:                 est.naics_code,
          certifying_executive_name:  est.certifying_executive_name,
          certifying_executive_title: est.certifying_executive_title,
          is_partial_year:            est.is_partial_year,
        },
        certified_by_name: cert?.certified_typed_name ?? null,
        certified_at:      cert?.certified_at ?? null,
      })
      return new NextResponse(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'content-type':        'application/pdf',
          'content-disposition': `inline; filename="OSHA-300A-${year}-${est.establishment_name.replace(/[^a-z0-9]+/gi, '_')}.pdf"`,
        },
      })
    }

    return NextResponse.json({
      year,
      establishment: est,
      summary,
      certification: cert,
      log_rows:      logRes.data ?? [],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'osha/300a/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — certify ───────────────────────────────────────────────────────

interface PostBody {
  year:                  number
  establishment_id:      string
  certified_typed_name?: string
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!Number.isInteger(body.year))
    return NextResponse.json({ error: 'year is required' }, { status: 400 })
  if (!UUID_RE.test(body.establishment_id))
    return NextResponse.json({ error: 'establishment_id is required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const [estRes, logRes] = await Promise.all([
      admin
        .from('osha_establishments')
        .select('id, hours_employees_by_year')
        .eq('id', body.establishment_id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle(),
      admin
        .from('osha_300_log_entries')
        .select('case_number, employee_name, job_title, date_of_injury, location_text, injury_description, classification, days_away, days_restricted, injury_type, is_privacy_case')
        .eq('tenant_id', gate.tenantId)
        .eq('establishment_id', body.establishment_id)
        .eq('year', body.year),
    ])
    if (estRes.error) throw new Error(estRes.error.message)
    if (logRes.error) throw new Error(logRes.error.message)
    const est = estRes.data as { hours_employees_by_year: Record<string, { employees?: number; hours?: number }> | null } | null
    if (!est) return NextResponse.json({ error: 'Establishment not found' }, { status: 404 })

    // Existing certification — reject if already locked. The
    // 300A is a regulatory document; once certified + posted, edits
    // are unsafe. The owner can DELETE the row to re-open if needed.
    const { data: existing } = await admin
      .from('osha_annual_summaries')
      .select('id, certified_at')
      .eq('tenant_id', gate.tenantId)
      .eq('establishment_id', body.establishment_id)
      .eq('year', body.year)
      .maybeSingle()
    if (existing && (existing as { certified_at: string | null }).certified_at) {
      return NextResponse.json({
        error: 'This 300A is already certified and locked. Owner DELETE to re-open.',
      }, { status: 409 })
    }

    const yearKey = String(body.year)
    const inputs = est.hours_employees_by_year?.[yearKey] ?? { employees: 0, hours: 0 }
    const summary = build300ASummary({
      rows: (logRes.data ?? []) as Osha300Row[],
      year: body.year,
      total_hours_worked:   inputs.hours ?? 0,
      annual_avg_employees: inputs.employees ?? 0,
    })

    const upsert = {
      tenant_id:             gate.tenantId,
      establishment_id:      body.establishment_id,
      year:                  body.year,
      totals_json:           summary,
      total_hours_worked:    summary.total_hours_worked,
      annual_avg_employees:  summary.annual_avg_employees,
      certified_by:          body.certified_typed_name ? gate.userId : null,
      certified_at:          body.certified_typed_name ? new Date().toISOString() : null,
      certified_typed_name:  body.certified_typed_name?.trim() || null,
    }

    const { data, error } = await admin
      .from('osha_annual_summaries')
      .upsert(upsert, { onConflict: 'tenant_id,establishment_id,year' })
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'osha/300a/POST', stage: 'upsert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ summary: data, totals: summary }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'osha/300a/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
