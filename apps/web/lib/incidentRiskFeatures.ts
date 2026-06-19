import type { SupabaseClient } from '@supabase/supabase-js'
import {
  summarizeIncidentRisk,
  type IncidentRiskFeatures,
  type IncidentRiskResult,
} from '@soteria/core/incidentRiskModel'
import { HAZARD_HUNT_RESOLVED_STATUSES } from '@soteria/core/hazardHunt'

// Server-side orchestrator for the transparent incident-risk model.
// Gathers a tenant's leading + lagging indicators from the existing tables
// (service-role + explicit tenant filter) and feeds them to the pure
// summarizeIncidentRisk(). Used by the scorecard API route, the assistant
// tool, and the weekly cron — one gathering path, no duplication.

const DAY = 86_400_000
const RECENT_DAYS = 90

function atmosphericFailed(r: { o2_pct: number | null; lel_pct: number | null; h2s_ppm: number | null; co_ppm: number | null }): boolean {
  return (r.o2_pct != null && (r.o2_pct < 19.5 || r.o2_pct > 23.5))
    || (r.lel_pct != null && r.lel_pct >= 10)
    || (r.h2s_ppm != null && r.h2s_ppm >= 10)
    || (r.co_ppm != null && r.co_ppm >= 35)
}

export async function gatherIncidentRiskFeatures(admin: SupabaseClient, tenantId: string): Promise<IncidentRiskFeatures> {
  const now = Date.now()
  const recentMs = now - RECENT_DAYS * DAY
  const priorMs = now - 2 * RECENT_DAYS * DAY
  const recentIso = new Date(recentMs).toISOString()
  const recentYmd = new Date(recentMs).toISOString().slice(0, 10)
  const todayYmd = new Date(now).toISOString().slice(0, 10)
  const nowIso = new Date(now).toISOString()

  const [incRes, classRes, bbsRes, capaRes, riskRes, trainRes, atmRes, hhInsRes, hhFindRes] = await Promise.all([
    admin.from('incidents').select('id, incident_type, occurred_at').eq('tenant_id', tenantId),
    admin.from('incident_classifications').select('incident_id, meets_recording_criteria').eq('tenant_id', tenantId),
    admin.from('bbs_observations').select('kind, observed_at').eq('tenant_id', tenantId).gte('observed_at', recentIso),
    admin.from('incident_actions').select('status, due_at').eq('tenant_id', tenantId).in('status', ['open', 'in_progress', 'blocked']),
    admin.from('risks').select('residual_band, status, next_review_date').eq('tenant_id', tenantId),
    admin.from('loto_training_records').select('expires_at').eq('tenant_id', tenantId).not('expires_at', 'is', null),
    admin.from('loto_atmospheric_tests').select('o2_pct, lel_pct, h2s_ppm, co_ppm, tested_at').eq('tenant_id', tenantId).gte('tested_at', recentIso),
    // Hazard Hunt cadence: runs (inspections) of hazard-hunt templates due in the
    // window, and how many were actually submitted. due_at is a date column.
    admin.from('inspections').select('status, due_at, inspection_templates!inner(category)').eq('tenant_id', tenantId).eq('inspection_templates.category', 'hazard_hunt').gte('due_at', recentYmd),
    // Hazard Hunt findings opened in the window, with their resolution status.
    admin.from('hazard_hunt_findings').select('status, created_at').eq('tenant_id', tenantId).gte('created_at', recentIso),
  ])
  for (const r of [incRes, classRes, bbsRes, capaRes, riskRes, trainRes, atmRes, hhInsRes, hhFindRes]) {
    if (r.error) throw new Error(r.error.message)
  }

  const recordableIds = new Set(
    ((classRes.data ?? []) as { incident_id: string; meets_recording_criteria: boolean }[])
      .filter(c => c.meets_recording_criteria === true)
      .map(c => c.incident_id),
  )
  const incidents = (incRes.data ?? []) as { id: string; incident_type: string; occurred_at: string }[]
  const occMs = (iso: string) => new Date(iso).getTime()
  const recordablesRecent = incidents.filter(r => recordableIds.has(r.id) && occMs(r.occurred_at) >= recentMs).length
  const recordablesPrior = incidents.filter(r => recordableIds.has(r.id) && occMs(r.occurred_at) >= priorMs && occMs(r.occurred_at) < recentMs).length
  const nearMissRecent = incidents.filter(r => r.incident_type === 'near_miss' && occMs(r.occurred_at) >= recentMs).length

  let bbsSafe = 0, bbsUnsafe = 0
  for (const b of (bbsRes.data ?? []) as { kind: string | null }[]) {
    if (b.kind === 'safe_behavior') bbsSafe++
    else if (b.kind === 'unsafe_act' || b.kind === 'unsafe_condition') bbsUnsafe++
  }

  const capasOverdue = ((capaRes.data ?? []) as { due_at: string | null }[])
    .filter(a => a.due_at != null && a.due_at < nowIso).length

  const risks = (riskRes.data ?? []) as { residual_band: string | null; status: string | null; next_review_date: string | null }[]
  const riskReviewsOverdue = risks.filter(r =>
    r.next_review_date != null && r.next_review_date < todayYmd
    && r.status !== 'closed' && r.status !== 'accepted_exception').length
  const highRisksUncontrolled = risks.filter(r =>
    (r.residual_band === 'high' || r.residual_band === 'extreme') && r.status === 'open').length

  const trainingExpired = ((trainRes.data ?? []) as { expires_at: string | null }[])
    .filter(t => t.expires_at != null && t.expires_at < nowIso).length

  const atm = (atmRes.data ?? []) as { o2_pct: number | null; lel_pct: number | null; h2s_ppm: number | null; co_ppm: number | null }[]
  const atmTotal = atm.length
  const atmFailed = atm.filter(atmosphericFailed).length

  const hhIns = (hhInsRes.data ?? []) as { status: string | null }[]
  const hazardHuntsDue = hhIns.length
  const hazardHuntsDone = hhIns.filter(r => r.status === 'submitted').length

  const hhFind = (hhFindRes.data ?? []) as { status: string | null }[]
  const hhFindingsOpened = hhFind.length
  const hhFindingsResolved = hhFind.filter(
    r => r.status != null && (HAZARD_HUNT_RESOLVED_STATUSES as readonly string[]).includes(r.status),
  ).length

  return {
    recordablesRecent, recordablesPrior, nearMissRecent,
    bbsSafe, bbsUnsafe, capasOverdue, riskReviewsOverdue,
    highRisksUncontrolled, trainingExpired, atmFailed, atmTotal,
    hazardHuntsDue, hazardHuntsDone, hhFindingsOpened, hhFindingsResolved,
  }
}

export async function computeIncidentRisk(admin: SupabaseClient, tenantId: string): Promise<IncidentRiskResult> {
  return summarizeIncidentRisk(await gatherIncidentRiskFeatures(admin, tenantId))
}
