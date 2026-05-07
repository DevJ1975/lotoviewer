import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  build300ASummary,
  buildItaCsvRows,
  rowsToCsv,
  type Osha300Row,
  type Osha300ASummary,
  type ItaEstablishmentInput,
} from '@soteria/core/oshaForms'

// GET /api/osha/ita-export?year=
//
// Builds the OSHA ITA (Injury Tracking Application) annual upload
// CSV for every establishment owned by the tenant. Pulls from the
// canonical sources:
//   - osha_annual_summaries (when certified — uses the locked totals)
//   - osha_300_log_entries (when not yet certified — recomputes)
//
// Admin-only. CSV download.

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const yearStr = url.searchParams.get('year') ?? ''
  const year = parseInt(yearStr, 10)
  if (!yearStr || !Number.isInteger(year))
    return NextResponse.json({ error: '?year= is required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    const { data: establishments, error: estErr } = await admin
      .from('osha_establishments')
      .select('id, establishment_name, street, city, state, zip, naics_code, hours_employees_by_year')
      .eq('tenant_id', gate.tenantId)
      .order('establishment_name')
    if (estErr) throw new Error(estErr.message)

    if (!establishments || establishments.length === 0) {
      return NextResponse.json({ error: 'No establishments configured for this tenant' }, { status: 404 })
    }

    type Est = {
      id: string
      establishment_name: string
      street: string | null
      city:   string | null
      state:  string | null
      zip:    string | null
      naics_code: string | null
      hours_employees_by_year: Record<string, { employees?: number; hours?: number }> | null
    }

    const items: ItaEstablishmentInput[] = []
    for (const e of establishments as Est[]) {
      // Prefer the locked annual summary; fall back to recomputing.
      const { data: cert } = await admin
        .from('osha_annual_summaries')
        .select('totals_json, total_hours_worked, annual_avg_employees')
        .eq('tenant_id', gate.tenantId)
        .eq('establishment_id', e.id)
        .eq('year', year)
        .maybeSingle()

      let summary: Osha300ASummary
      if (cert) {
        summary = (cert as { totals_json: Osha300ASummary }).totals_json
      } else {
        const { data: rows } = await admin
          .from('osha_300_log_entries')
          .select('case_number, employee_name, job_title, date_of_injury, location_text, injury_description, classification, days_away, days_restricted, injury_type, is_privacy_case')
          .eq('tenant_id', gate.tenantId)
          .eq('establishment_id', e.id)
          .eq('year', year)
        const yearKey = String(year)
        const inputs = e.hours_employees_by_year?.[yearKey] ?? { employees: 0, hours: 0 }
        summary = build300ASummary({
          rows: ((rows ?? []) as Osha300Row[]),
          year,
          total_hours_worked:   inputs.hours    ?? 0,
          annual_avg_employees: inputs.employees ?? 0,
        })
      }

      items.push({
        name:                e.establishment_name,
        internal_id:         e.id,
        street:              e.street,
        city:                e.city,
        state:               e.state,
        zip:                 e.zip,
        naics_code:          e.naics_code,
        industry_description: null,
        summary,
      })
    }

    const csv = rowsToCsv(buildItaCsvRows(items))

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type':        'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="ita-${year}.csv"`,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'osha/ita-export/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
