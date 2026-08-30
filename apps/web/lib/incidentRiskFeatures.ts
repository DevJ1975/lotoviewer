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

  // ── Cross-module leading indicators (v2.0.0), gathered BEST-EFFORT ─────────
  // A tenant without a given module (or a schema drift) must not break the
  // core score — each query degrades to an empty set, contributing 0 pressure.
  const [inspRows, bbsV2Rows, jhaRows, csRows, hwRows, matrixRows, ecfaRows] = await Promise.all([
    safeSelect(admin.from('inspections').select('result').eq('tenant_id', tenantId).gte('created_at', recentIso)),
    safeSelect(admin.from('bbs_observations_v2').select('follow_up_required, follow_up_completed_at').eq('tenant_id', tenantId).gte('created_at', recentIso)),
    safeSelect(admin.from('jhas').select('status, next_review_date').eq('tenant_id', tenantId)),
    safeSelect(admin.from('loto_confined_space_permits').select('expires_at, canceled_at').eq('tenant_id', tenantId).gte('started_at', recentIso)),
    safeSelect(admin.from('loto_hot_work_permits').select('expires_at, canceled_at, work_completed_at').eq('tenant_id', tenantId).gte('started_at', recentIso)),
    safeSelect(admin.from('v_training_matrix').select('status').eq('tenant_id', tenantId)),
    safeSelect(admin.from('incident_ecfa_nodes').select('cf_hierarchy_control').eq('tenant_id', tenantId).eq('is_causal_factor', true).gte('created_at', recentIso)),
  ])

  const graded = inspRows.filter(r => r.result === 'pass' || r.result === 'fail')
  const inspectionsTotal = graded.length
  const inspectionsFailed = graded.filter(r => r.result === 'fail').length

  const bbsFollowupsOpen = bbsV2Rows
    .filter(r => r.follow_up_required === true && r.follow_up_completed_at == null).length

  const jhaReviewsOverdue = jhaRows.filter(r =>
    r.status === 'approved' && typeof r.next_review_date === 'string' && r.next_review_date < todayYmd).length

  const permitExpiredOpen =
    csRows.filter(r => typeof r.expires_at === 'string' && r.expires_at < nowIso && r.canceled_at == null).length
    + hwRows.filter(r => typeof r.expires_at === 'string' && r.expires_at < nowIso && r.canceled_at == null && r.work_completed_at == null).length

  const trainingGaps = matrixRows.filter(r => r.status === 'missing' || r.status === 'overdue').length

  const ecfaCausalFactors = ecfaRows.length
  const ecfaWeakControls = ecfaRows.filter(r =>
    r.cf_hierarchy_control == null || r.cf_hierarchy_control === 'administrative' || r.cf_hierarchy_control === 'ppe').length
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
    inspectionsFailed, inspectionsTotal, bbsFollowupsOpen, jhaReviewsOverdue,
    permitExpiredOpen, trainingGaps, ecfaCausalFactors, ecfaWeakControls,
    hazardHuntsDue, hazardHuntsDone, hhFindingsOpened, hhFindingsResolved,
  }
}

// Best-effort read: returns the rows, or [] on any error (missing table for a
// tenant that hasn't enabled the module, schema drift, RLS). Keeps the core
// risk score resilient to optional cross-module inputs.
async function safeSelect(
  q: PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Record<string, unknown>[]> {
  try {
    const r = await q
    if (r.error) return []
    return (r.data ?? []) as Record<string, unknown>[]
  } catch {
    return []
  }
}

// Short-TTL memo of the (multi-table) gather → score, keyed by tenant. The
// scorecard page loads the risk once, then "Analyze" (scorecard-focus) recomputes
// it seconds later; on a warm serverless instance this serves the second call
// from cache instead of re-running the full gather. Best-effort by design —
// cold instances just recompute, which is correct.
const riskCache = new Map<string, { at: number; result: IncidentRiskResult }>()
const RISK_TTL_MS = 60_000

export async function computeIncidentRisk(
  admin: SupabaseClient,
  tenantId: string,
  opts: { fresh?: boolean } = {},
): Promise<IncidentRiskResult> {
  const hit = riskCache.get(tenantId)
  if (!opts.fresh && hit && Date.now() - hit.at < RISK_TTL_MS) return hit.result
  const result = summarizeIncidentRisk(await gatherIncidentRiskFeatures(admin, tenantId))
  riskCache.set(tenantId, { at: Date.now(), result })
  return result
}
