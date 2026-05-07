import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import {
  detectRepeatIncidents,
  type RepeatCandidate,
} from '@soteria/core/incidentRepeatDetector'

// GET /api/incidents/[id]/repeats?days=
//
// Returns past incidents that resemble this one. Window defaults to
// 90 days. Pure-logic ranking happens in
// @soteria/core/incidentRepeatDetector — the API just hydrates rows
// and feeds them in.
//
// Output is intentionally small (top 5 by score) so the
// RepeatIncidentBanner stays glanceable.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

interface IncidentBaseRow {
  id:                                string
  report_number:                     string
  occurred_at:                       string
  incident_type:                     string
  description:                       string
  location_text:                     string | null
  related_loto_permit_id:            string | null
  related_hot_work_permit_id:        string | null
  related_confined_space_permit_id:  string | null
  related_jha_id:                    string | null
}

interface PersonRow {
  incident_id: string
  body_part:   string[] | null
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id: focalId } = await ctx.params
  if (!UUID_RE.test(focalId))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const url = new URL(req.url)
  const days = Math.max(7, Math.min(365, parseInt(url.searchParams.get('days') ?? '90', 10) || 90))

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    // Pull the focal incident first.
    const { data: focalRow, error: focalErr } = await gate.authedClient
      .from('incidents')
      .select('id, report_number, occurred_at, incident_type, description, location_text, related_loto_permit_id, related_hot_work_permit_id, related_confined_space_permit_id, related_jha_id')
      .eq('id', focalId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (focalErr) throw new Error(focalErr.message)
    if (!focalRow) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    // Window: incidents that occurred in the last `days` *before* the
    // focal incident. We exclude post-focal incidents — a "repeat"
    // points backwards in time.
    const focal = focalRow as IncidentBaseRow
    const focalMs = new Date(focal.occurred_at).getTime()
    const startIso = new Date(focalMs - days * 86_400_000).toISOString()

    const [poolRes, peopleRes] = await Promise.all([
      gate.authedClient
        .from('incidents')
        .select('id, report_number, occurred_at, incident_type, description, location_text, related_loto_permit_id, related_hot_work_permit_id, related_confined_space_permit_id, related_jha_id')
        .eq('tenant_id', gate.tenantId)
        .gte('occurred_at', startIso)
        .lt('occurred_at', focal.occurred_at),
      // Body-parts joined per incident (read from the safe view so
      // PII columns don't leak through).
      gate.authedClient
        .from('incident_people_safe')
        .select('incident_id, body_part')
        .eq('person_role', 'injured'),
    ])
    if (poolRes.error)   throw new Error(poolRes.error.message)
    if (peopleRes.error) throw new Error(peopleRes.error.message)

    // Build a (incident_id → body_parts[]) lookup. A single incident
    // can have multiple injured people; we union all their body parts.
    const bodyByIncident = new Map<string, string[]>()
    for (const p of (peopleRes.data ?? []) as PersonRow[]) {
      if (!p.body_part) continue
      const existing = bodyByIncident.get(p.incident_id) ?? []
      bodyByIncident.set(p.incident_id, existing.concat(p.body_part))
    }

    const focalBody = bodyByIncident.get(focal.id) ?? null
    const focalCandidate: RepeatCandidate = { ...focal, body_parts: focalBody }
    const pool: RepeatCandidate[] = ((poolRes.data ?? []) as IncidentBaseRow[]).map(r => ({
      ...r,
      body_parts: bodyByIncident.get(r.id) ?? null,
    }))

    const matches = detectRepeatIncidents(focalCandidate, pool, { threshold: 0.20, limit: 5 })

    return NextResponse.json({
      focal_id: focalId,
      window_days: days,
      candidates_searched: pool.length,
      matches: matches.map(m => ({
        id:            m.candidate.id,
        report_number: m.candidate.report_number,
        occurred_at:   m.candidate.occurred_at,
        incident_type: m.candidate.incident_type,
        description:   m.candidate.description,
        location_text: m.candidate.location_text,
        score:         m.score,
        reasons:       m.reasons,
      })),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/[id]/repeats/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
