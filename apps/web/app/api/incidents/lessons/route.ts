import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/incidents/lessons?search=
//
// Returns the tenant's published lessons-learned. A lesson exists
// when the lead investigator flips publish_lesson=true on the
// investigation row + types a lesson_summary. The list is RLS-
// scoped via the user's authedClient so cross-tenant lessons are
// invisible.
//
// Lessons from privacy-case incidents render with redacted
// description + location to honour 1904.29(b)(7).

// Shape of a lesson row in the API response. The Supabase return
// shape differs (PostgREST may return the joined incident as an
// array); we flatten in the handler before serialising.
interface LessonRow {
  investigation_id:    string
  incident_id:         string
  lesson_summary:      string
  lesson_published_at: string
  rca_method:          string
  scope_summary:       string | null
  root_causes:         string | null
  incident: {
    report_number:   string
    occurred_at:     string
    description:     string
    location_text:   string | null
    incident_type:   string
    severity_actual: string
  }
  is_privacy_case: boolean | null
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase()

  try {
    // Joined fetch — investigation + parent incident + (optional)
    // privacy-case flag from the classification row.
    const { data, error } = await gate.authedClient
      .from('incident_investigations')
      .select(`
        id,
        incident_id,
        lesson_summary,
        lesson_published_at,
        rca_method,
        scope_summary,
        root_causes,
        incident:incidents!inner(
          report_number, occurred_at, description, location_text,
          incident_type, severity_actual,
          classification:incident_classifications(is_privacy_case)
        )
      `)
      .eq('tenant_id', gate.tenantId)
      .eq('publish_lesson', true)
      .not('lesson_published_at', 'is', null)
      .order('lesson_published_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)

    type IncidentRow = {
      report_number: string; occurred_at: string;
      description: string; location_text: string | null;
      incident_type: string; severity_actual: string;
      classification: Array<{ is_privacy_case: boolean | null }> | { is_privacy_case: boolean | null } | null
    }
    type Row = {
      id: string; incident_id: string;
      lesson_summary: string | null;
      lesson_published_at: string;
      rca_method: string;
      scope_summary: string | null;
      root_causes: string | null;
      incident: IncidentRow | IncidentRow[] | null
    }

    const lessons: LessonRow[] = []
    for (const r of (data ?? []) as Row[]) {
      const inc = Array.isArray(r.incident) ? r.incident[0] : r.incident
      if (!inc) continue
      const cls = Array.isArray(inc.classification) ? inc.classification[0] : inc.classification
      const isPrivacy = !!cls?.is_privacy_case

      const description = isPrivacy ? '(Privacy case — description redacted)' : inc.description
      const location    = isPrivacy ? null : inc.location_text

      // Search filter — Phase 6 keeps it client-server-side simple
      // (case-insensitive substring across summary + description +
      // root_causes). A future Phase upgrades to FTS or embeddings.
      if (search) {
        const haystack = [
          r.lesson_summary, r.scope_summary, r.root_causes,
          description, inc.report_number,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(search)) continue
      }

      lessons.push({
        investigation_id:    r.id,
        incident_id:         r.incident_id,
        lesson_summary:      r.lesson_summary ?? '',
        lesson_published_at: r.lesson_published_at,
        rca_method:          r.rca_method,
        scope_summary:       r.scope_summary,
        root_causes:         r.root_causes,
        incident: {
          report_number:   inc.report_number,
          occurred_at:     inc.occurred_at,
          description,
          location_text:   location,
          incident_type:   inc.incident_type,
          severity_actual: inc.severity_actual,
        },
        is_privacy_case: isPrivacy,
      })
    }

    return NextResponse.json({ lessons })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/lessons/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
