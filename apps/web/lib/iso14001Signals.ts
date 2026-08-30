import { supabase } from '@/lib/supabase'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { reviewHasOutputs } from '@soteria/core/managementReview'
import {
  READINESS_WINDOWS,
  type ReadinessSignals,
} from '@soteria/core/iso14001Readiness'

// Thin reader for the ISO 14001 report card. Everything here is I/O:
// the judgement lives in @soteria/core/iso14001Readiness, which takes
// the plain bag this module produces. Same split as scorecardMetrics.
//
// Reads go through the browser client under RLS, so every query is
// already tenant-scoped by policy; the explicit .eq('tenant_id', …)
// keeps the intent readable and holds if a superadmin's header scope
// widens the view.
//
// Tables that do not exist yet (controlled documents, internal audits —
// phases 3 and 4) are represented by the `*Live` booleans rather than
// by querying and swallowing a 42P01. Guessing from a caught error
// would make a network blip look like a missing feature.

const DOCUMENTS_REGISTER_LIVE = false  // flip when controlled_documents ships
const AUDIT_PROGRAMME_LIVE    = false  // flip when internal_audits ships

/** Modules whose absence makes a clause not-applicable rather than a gap. */
const CLAUSE_MODULE_DEPENDENCIES = ['loto'] as const

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

/** Newest `column` value across rows, as an age in days. */
function newestAgeDays(rows: Array<Record<string, unknown>>, column: string): number | null {
  let newest: number | null = null
  for (const row of rows) {
    const age = daysSince(row[column] as string | null)
    if (age === null) continue
    if (newest === null || age < newest) newest = age
  }
  return newest
}

function countRows(res: { count: number | null }): number {
  return res.count ?? 0
}

export async function fetchIso14001Signals(
  tenantId: string,
  tenantModules: Record<string, boolean> | null | undefined,
): Promise<ReadinessSignals> {
  const t = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  const today = new Date().toISOString().slice(0, 10)
  const readingCutoff = new Date(Date.now() - READINESS_WINDOWS.objectiveReadingDays * 86_400_000)
    .toISOString().slice(0, 10)

  const [
    risks, riskReviews, riskControls,
    aspects, objectives, objectiveReadings,
    obligations, obligationsOverdue,
    training,
    reviews,
    nonconformities, ncActions,
    inspections,
    complianceEvents, toolboxTalks, prop65Notifications,
  ] = await Promise.all([
    supabase.from('risks').select('id, updated_at').eq('tenant_id', tenantId).limit(5000),
    supabase.from('risk_reviews').select('created_at').eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(1),
    supabase.from('risk_controls').select('risk_id').eq('tenant_id', tenantId).limit(10_000),
    supabase.from('environmental_aspects')
      .select('id, is_significant, controls, related_risk_id, status, updated_at')
      .eq('tenant_id', tenantId).limit(5000),
    supabase.from('environmental_objectives')
      .select('id, status, target_value, target_date, related_aspect_id')
      .eq('tenant_id', tenantId).limit(2000),
    supabase.from('environmental_objective_readings')
      .select('objective_id, reading_date').eq('tenant_id', tenantId)
      .gte('reading_date', readingCutoff).limit(10_000),
    t('compliance_calendar_obligations'),
    supabase.from('compliance_calendar_obligations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('status', 'open').lt('next_due_at', today),
    supabase.from('loto_training_records').select('expires_at').eq('tenant_id', tenantId).limit(10_000),
    supabase.from('management_reviews')
      .select('review_date, conclusions, decisions, status')
      .eq('tenant_id', tenantId).eq('status', 'completed')
      .order('review_date', { ascending: false }).limit(1),
    supabase.from('nonconformities')
      .select('id, classification, status').eq('tenant_id', tenantId).limit(5000),
    supabase.from('nonconformity_actions')
      .select('id, nonconformity_id, status, due_at, verified_effective_at')
      .eq('tenant_id', tenantId).limit(10_000),
    supabase.from('inspections')
      .select('id, status, due_at, submitted_at').eq('tenant_id', tenantId).limit(5000),
    supabase.from('compliance_calendar_events')
      .select('completed_at').eq('tenant_id', tenantId)
      .order('completed_at', { ascending: false }).limit(1),
    supabase.from('toolbox_talks')
      .select('talk_date').eq('tenant_id', tenantId)
      .order('talk_date', { ascending: false }).limit(1),
    supabase.from('prop65_notifications')
      .select('notified_at').eq('tenant_id', tenantId)
      .order('notified_at', { ascending: false }).limit(1),
  ])

  const aspectRows    = aspects.data ?? []
  const objectiveRows = objectives.data ?? []
  const readingRows   = objectiveReadings.data ?? []
  const ncRows        = nonconformities.data ?? []
  const actionRows    = ncActions.data ?? []
  const inspectionRows = inspections.data ?? []
  const riskRows      = risks.data ?? []

  const significant = aspectRows.filter(a => a.is_significant)
  const controlledRiskIds = new Set((riskControls.data ?? []).map(c => c.risk_id))
  const objectivesActive = objectiveRows.filter(o => o.status !== 'cancelled')
  const objectiveIdsWithReading = new Set(readingRows.map(r => r.objective_id))
  const aspectIdsWithObjective = new Set(
    objectiveRows.map(o => o.related_aspect_id).filter(Boolean) as string[],
  )

  // §10.2 wants an effectiveness check, not just a closure. A finding
  // closed with no verified action is exactly the gap an auditor looks
  // for, so the two are tracked separately.
  const verifiedNcIds = new Set(
    actionRows.filter(a => a.verified_effective_at).map(a => a.nonconformity_id),
  )

  const lastReview = (reviews.data ?? [])[0] ?? null
  const trainingRows = training.data ?? []
  const warnCutoffMs = Date.now() + READINESS_WINDOWS.trainingExpiryWarnDays * 86_400_000

  // A clause is not-applicable when nothing feeds it — the tenant never
  // bought the module, so scoring them down would be dishonest.
  const disabledModules = CLAUSE_MODULE_DEPENDENCIES
    .filter(id => !isModuleVisible(id, tenantModules))

  return {
    disabledModules,

    risks: {
      count:   riskRows.length,
      ageDays: newestAgeDays(riskReviews.data ?? [], 'created_at')
        ?? newestAgeDays(riskRows, 'updated_at'),
    },

    documentsRegisterLive: DOCUMENTS_REGISTER_LIVE,
    policyApproved:        false,
    policyReviewOverdue:   false,
    requiredDocsMissing:   0,
    docsReviewOverdue:     0,

    risksWithoutControls: riskRows.filter(r => !controlledRiskIds.has(r.id)).length,

    aspectsTotal:            aspectRows.length,
    aspectsSignificant:      significant.length,
    significantUncontrolled: significant.filter(a => !a.controls?.trim() && !a.related_risk_id).length,
    aspectsRegisterAgeDays:  newestAgeDays(aspectRows, 'updated_at'),

    obligationsTotal:      countRows(obligations),
    obligationsOverdue:    countRows(obligationsOverdue),
    // 9.1.2 has no dedicated evaluation record. The closest true
    // artifact is the compliance-calendar completion log: signing off an
    // obligation IS an act of evaluating compliance against it. Reported
    // as-is rather than inferred from "nothing is overdue", which would
    // score an empty calendar as evaluated.
    complianceEvalAgeDays: newestAgeDays(complianceEvents.data ?? [], 'completed_at'),

    significantUnaddressed: significant.filter(a =>
      !aspectIdsWithObjective.has(a.id) && !a.controls?.trim() && !a.related_risk_id,
    ).length,

    objectivesActive:      objectivesActive.length,
    objectivesLinked:      objectivesActive.filter(o => o.related_aspect_id).length,
    objectivesWithTargets: objectivesActive.filter(o => o.target_value !== null && o.target_date).length,
    objectivesAchieved:    objectiveRows.filter(o => o.status === 'achieved').length,

    trainingRecords:      trainingRows.length,
    trainingExpired:      trainingRows.filter(r => r.expires_at && Date.parse(r.expires_at) < Date.now()).length,
    trainingExpiringSoon: trainingRows.filter(r =>
      r.expires_at
      && Date.parse(r.expires_at) >= Date.now()
      && Date.parse(r.expires_at) < warnCutoffMs,
    ).length,

    // No EMS-specific awareness or communication record exists yet, so
    // these read the nearest true artifacts: a delivered toolbox talk is
    // awareness, a worker notification is communication. Both overstate
    // slightly — neither is guaranteed to be *environmental* — which is
    // what clause pinning (phase 5) is for: an auditor confirms the tie.
    awarenessAgeDays:     newestAgeDays(toolboxTalks.data ?? [], 'talk_date'),
    communicationAgeDays: newestAgeDays(prop65Notifications.data ?? [], 'notified_at'),

    operationalInspections: inspectionRows.filter(i => i.submitted_at).length,
    operationalOverdue:     inspectionRows.filter(i =>
      !i.submitted_at && i.due_at && i.due_at < today,
    ).length,

    emergencyDrillAgeDays: null,

    objectivesStaleReadings: objectivesActive.filter(o =>
      o.status === 'in_progress' && !objectiveIdsWithReading.has(o.id),
    ).length,

    auditProgrammeLive:    AUDIT_PROGRAMME_LIVE,
    lastAuditAgeDays:      null,
    auditClausesUncovered: 0,

    lastReviewAgeDays:    daysSince(lastReview?.review_date),
    lastReviewHasOutputs: lastReview
      ? reviewHasOutputs({ conclusions: lastReview.conclusions, decisions: lastReview.decisions })
      : false,

    nonconformityRegisterLive: !nonconformities.error,
    openMajorNonconformities:  ncRows.filter(n =>
      n.classification === 'major' && (n.status === 'open' || n.status === 'in_progress'),
    ).length,
    overdueActions: actionRows.filter(a =>
      a.status !== 'verified' && a.status !== 'cancelled' && a.due_at && a.due_at < today,
    ).length,
    closedWithoutVerification: ncRows
      .filter(n => n.status === 'closed')
      .filter(n => !verifiedNcIds.has(n.id)).length,

    improvementsThisPeriod: actionRows.filter(a => a.verified_effective_at).length,
  }
}
