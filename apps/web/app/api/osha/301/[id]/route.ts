import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { renderOsha301Pdf } from '@/lib/pdfOsha301'
import {
  build301Form,
  type Build301Inputs,
} from '@soteria/core/oshaForms'

// GET /api/osha/301/[id]?format=
//
// id is the incident UUID. Returns the 301 form for the primary
// injured person. Format defaults to PDF (it's the only output the
// regulator wants); ?format=json returns the shaped form object.
//
// PII gate: 301 carries DOB + home address. We require admin /
// owner / superadmin / assigned investigator. Plain members get
// 403.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'pdf'
  if (format !== 'pdf' && format !== 'json')
    return NextResponse.json({ error: '?format= must be pdf or json' }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    // PII gate.
    const { data: incident } = await admin
      .from('incidents')
      .select('id, tenant_id, report_number, occurred_at, description, assigned_investigator')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const isPriv =
      gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
      || (incident as { assigned_investigator: string | null }).assigned_investigator === gate.userId
    if (!isPriv) {
      return NextResponse.json({
        error: 'OSHA 301 contains PII. Restricted to admins, owners, and the assigned investigator.',
      }, { status: 403 })
    }

    const [personRes, careRes, classRes, preparerRes, estRes] = await Promise.all([
      admin
        .from('incident_people')
        .select('full_name, email, phone, job_title, date_of_birth, gender, home_address, hire_date, body_part, injury_nature, injury_source, treatment_facility')
        .eq('incident_id', incidentId)
        .eq('person_role', 'injured')
        .eq('is_primary', true)
        .maybeSingle(),
      admin
        .from('incident_care_cases')
        .select('treating_physician, clinic_name')
        .eq('incident_id', incidentId)
        .maybeSingle(),
      admin
        .from('incident_classifications')
        .select('classification, meets_recording_criteria, is_privacy_case')
        .eq('incident_id', incidentId)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', gate.userId)
        .maybeSingle(),
      admin
        .from('osha_300_log_entries')
        .select('establishment_id, osha_establishments:osha_establishments(establishment_name)')
        .eq('incident_id', incidentId)
        .limit(1)
        .maybeSingle(),
    ])

    const inc = incident as { report_number: string; occurred_at: string; description: string }
    const person = personRes.data as Build301Inputs['person']
    const care   = careRes.data as Build301Inputs['care']
    const klass  = (classRes.data ?? { classification: null }) as { classification: 'death' | 'days_away' | 'restricted' | 'other_recordable' | null }
    const preparer = preparerRes.data
      ? { name: (preparerRes.data as { full_name: string | null }).full_name, title: null, phone: null }
      : null

    const form = build301Form({
      incident:       { report_number: inc.report_number, occurred_at: inc.occurred_at, description: inc.description },
      person,
      care,
      preparer,
      classification: { classification: klass.classification },
    })

    let establishmentName: string | null = null
    if (estRes.data) {
      type R = { osha_establishments: { establishment_name: string | null } | { establishment_name: string | null }[] | null }
      const r = estRes.data as R
      const e = Array.isArray(r.osha_establishments) ? r.osha_establishments[0] : r.osha_establishments
      establishmentName = e?.establishment_name ?? null
    }

    if (format === 'json') {
      return NextResponse.json({ form, establishment_name: establishmentName })
    }
    const bytes = await renderOsha301Pdf({ form, establishmentName })
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type':        'application/pdf',
        'content-disposition': `inline; filename="OSHA-301-${form.report_number}.pdf"`,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'osha/301/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
