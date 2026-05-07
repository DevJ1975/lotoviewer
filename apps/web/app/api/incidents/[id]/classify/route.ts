import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  decideRecordability,
  type RecordabilityAnswers,
} from '@soteria/core/incidentClassification'
import {
  INJURY_TYPES,
  build300Row,
  type InjuryType,
} from '@soteria/core/oshaForms'

// GET   /api/incidents/[id]/classify   Read the existing
//                                      classification snapshot (or 204).
// POST  /api/incidents/[id]/classify   Run the 1904.7 decision tree
//                                      on the supplied answers, persist
//                                      the snapshot, and refresh the
//                                      incident's row in
//                                      osha_300_log_entries. Admin only.
//
// Side-effects:
//   - Writes/updates incident_classifications (1:1 on incident_id)
//   - When meets_recording_criteria=true: upserts the matching row
//     in osha_300_log_entries (year derived from incidents.occurred_at)
//   - When meets_recording_criteria=false: deletes the matching row
//     from osha_300_log_entries (toggling a case off the log)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

const CLASS_COLS = [
  'id', 'tenant_id', 'incident_id',
  'is_work_related', 'is_new_case', 'meets_recording_criteria',
  'classification', 'is_privacy_case', 'decision_path',
  'ai_suggested_classification', 'ai_confidence',
  'classified_by', 'classified_at', 'override_reason',
  'human_overrode_ai',
  'updated_at',
].join(', ')

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incident_classifications')
      .select(CLASS_COLS)
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return NextResponse.json({ classification: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'classify/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — run the decision tree ─────────────────────────────────────────

interface PostBody {
  answers:                RecordabilityAnswers
  is_privacy_case?:       boolean
  injury_type?:           InjuryType
  override_reason?:       string
  establishment_id?:      string | null
  ai_suggested_classification?: 'death' | 'days_away' | 'restricted' | 'other_recordable' | null
  ai_confidence?:         number | null
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.answers || typeof body.answers !== 'object') {
    return NextResponse.json({ error: 'answers object is required' }, { status: 400 })
  }
  if (body.injury_type && !(INJURY_TYPES as readonly string[]).includes(body.injury_type)) {
    return NextResponse.json({ error: `Invalid injury_type: ${body.injury_type}` }, { status: 400 })
  }
  if (body.establishment_id && !UUID_RE.test(body.establishment_id)) {
    return NextResponse.json({ error: 'establishment_id must be a uuid' }, { status: 400 })
  }

  const decision = decideRecordability(body.answers)

  const humanOverrodeAi = body.ai_suggested_classification != null
    && body.ai_suggested_classification !== decision.classification

  const classification = {
    tenant_id:                gate.tenantId,
    incident_id:              incidentId,
    is_work_related:          !!body.answers.is_work_related,
    is_new_case:              !!body.answers.is_new_case,
    meets_recording_criteria: decision.recordable,
    classification:           decision.classification,
    is_privacy_case:          !!body.is_privacy_case,
    decision_path:            decision.path,
    ai_suggested_classification: body.ai_suggested_classification ?? null,
    ai_confidence:               body.ai_confidence ?? null,
    classified_by:            gate.userId,
    classified_at:            new Date().toISOString(),
    override_reason:          body.override_reason?.trim() || null,
    human_overrode_ai:        humanOverrodeAi,
  }

  try {
    const admin = supabaseAdmin()

    const { data: incident } = await admin
      .from('incidents')
      .select('id, tenant_id, report_number, occurred_at, description, location_text')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident)
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    // Upsert the classification.
    const { data: classRow, error: classErr } = await admin
      .from('incident_classifications')
      .upsert(classification, { onConflict: 'incident_id', ignoreDuplicates: false })
      .select(CLASS_COLS)
      .single()
    if (classErr) {
      Sentry.captureException(classErr, { tags: { route: 'classify/POST', stage: 'class-upsert' } })
      return NextResponse.json({ error: classErr.message }, { status: 500 })
    }

    // ── Refresh the 300 log row ────────────────────────────────────
    const occurred = new Date(
      (incident as { occurred_at: string }).occurred_at,
    )
    const year = occurred.getFullYear()

    if (decision.recordable && decision.classification) {
      // Resolve primary injured person + their care case (for days_away
      // / days_restricted counters).
      const { data: person } = await admin
        .from('incident_people')
        .select('full_name, job_title')
        .eq('incident_id', incidentId)
        .eq('person_role', 'injured')
        .eq('is_primary', true)
        .maybeSingle()
      const { data: care } = await admin
        .from('incident_care_cases')
        .select('days_away_from_work, days_restricted')
        .eq('incident_id', incidentId)
        .maybeSingle()

      const row = build300Row({
        incident:       incident as unknown as Parameters<typeof build300Row>[0]['incident'],
        classification: classRow as unknown as Parameters<typeof build300Row>[0]['classification'],
        person:         (person as unknown as Parameters<typeof build300Row>[0]['person']) ?? null,
        care:           (care as unknown as Parameters<typeof build300Row>[0]['care']) ?? null,
        injury_type:    body.injury_type,
      })

      if (row) {
        const logInsert = {
          tenant_id:          gate.tenantId,
          establishment_id:   body.establishment_id ?? null,
          incident_id:        incidentId,
          year,
          case_number:        row.case_number,
          employee_name:      row.employee_name,
          job_title:          row.job_title,
          date_of_injury:     row.date_of_injury,
          location_text:      row.location_text,
          injury_description: row.injury_description,
          classification:     row.classification,
          days_away:          row.days_away,
          days_restricted:    row.days_restricted,
          injury_type:        row.injury_type,
          is_privacy_case:    row.is_privacy_case,
          refreshed_at:       new Date().toISOString(),
        }
        const { error: logErr } = await admin
          .from('osha_300_log_entries')
          .upsert(logInsert, { onConflict: 'incident_id,year' })
        if (logErr) {
          Sentry.captureException(logErr, { tags: { route: 'classify/POST', stage: '300-upsert' } })
        }
      }
    } else {
      // Not recordable — pull any prior cached row off the log so a
      // tenant that flips an incident from "recordable" to "not
      // recordable" doesn't carry an orphan row forever.
      const { error: delErr } = await admin
        .from('osha_300_log_entries')
        .delete()
        .eq('incident_id', incidentId)
        .eq('tenant_id', gate.tenantId)
      if (delErr) {
        Sentry.captureException(delErr, { tags: { route: 'classify/POST', stage: '300-delete' } })
      }
    }

    return NextResponse.json({
      classification: classRow,
      decision,
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'classify/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
