import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { renderOsha300Pdf } from '@/lib/pdfOsha300'
import {
  type Osha300Row,
  type InjuryType,
} from '@soteria/core/oshaForms'

// GET /api/osha/300?year=&establishment=&format=
//
// Query params:
//   year          required, 4-digit
//   establishment optional (omit to roll up all establishments)
//   format        'json' (default) | 'pdf'
//
// Reads osha_300_log_entries for the requested scope and either
// returns the rows as JSON or streams a generated PDF.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LogRow {
  case_number:        string
  employee_name:      string
  job_title:          string | null
  date_of_injury:     string
  location_text:      string | null
  injury_description: string | null
  classification:     'death' | 'days_away' | 'restricted' | 'other_recordable'
  days_away:          number
  days_restricted:    number
  injury_type:        InjuryType
  is_privacy_case:    boolean
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const yearStr = url.searchParams.get('year') ?? ''
  const year = parseInt(yearStr, 10)
  if (!yearStr || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: '?year= is required (2000-2100)' }, { status: 400 })
  }
  const establishmentId = url.searchParams.get('establishment') ?? ''
  if (establishmentId && !UUID_RE.test(establishmentId)) {
    return NextResponse.json({ error: '?establishment= must be a uuid' }, { status: 400 })
  }
  const format = url.searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'pdf') {
    return NextResponse.json({ error: '?format= must be json or pdf' }, { status: 400 })
  }

  try {
    let q = gate.authedClient
      .from('osha_300_log_entries')
      .select('case_number, employee_name, job_title, date_of_injury, location_text, injury_description, classification, days_away, days_restricted, injury_type, is_privacy_case')
      .eq('tenant_id', gate.tenantId)
      .eq('year', year)
      .order('date_of_injury')
    if (establishmentId) {
      q = q.eq('establishment_id', establishmentId)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rows: Osha300Row[] = ((data ?? []) as LogRow[])

    // Resolve the establishment label for the PDF header.
    let establishmentName = 'All establishments'
    let city: string | null = null
    let state: string | null = null
    if (establishmentId) {
      const { data: est } = await gate.authedClient
        .from('osha_establishments')
        .select('establishment_name, city, state')
        .eq('id', establishmentId)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      if (est) {
        const e = est as { establishment_name: string; city: string | null; state: string | null }
        establishmentName = e.establishment_name
        city  = e.city
        state = e.state
      }
    }

    if (format === 'pdf') {
      const bytes = await renderOsha300Pdf({
        rows,
        establishmentName,
        city,
        state,
        year,
      })
      // Cast through unknown to satisfy NextResponse's BodyInit typing,
      // which doesn't include Uint8Array directly.
      return new NextResponse(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'content-type':        'application/pdf',
          'content-disposition': `inline; filename="OSHA-300-${year}.pdf"`,
        },
      })
    }
    return NextResponse.json({ year, rows, total: rows.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'osha/300/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
