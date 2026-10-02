import { supabase } from '@/lib/supabase'
import { reviewHasOutputs } from '@soteria/core/managementReview'
import { policyIsComplete, policySignatoryStale, registerDisciplines } from '@soteria/core/managementSystem'
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
//
// The context, scope and policy, aspect and obligation clauses read the
// Phase 1 registers (migrations 295-299); environmental registers count
// environmental and integrated rows, never OH&S-only ones. Clauses 7.2 to
// 8.2 read nothing: the readiness module grades them not assessed until an
// environmental source exists, rather than from safety records.

const DOCUMENTS_REGISTER_LIVE = false  // flip when controlled_documents ships
const AUDIT_PROGRAMME_LIVE    = false  // flip when internal_audits ships

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

export async function fetchIso14001Signals(tenantId: string): Promise<ReadinessSignals> {
  const t = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  const ems = registerDisciplines('ems')
  const activeIssues = () => t('ms_context_issues').in('discipline', ems).is('retired_at', null)
  const activeParties = () => t('ms_interested_parties').in('discipline', ems).is('retired_at', null)
  const registerObligations = () => t('compliance_calendar_obligations').in('discipline', ems).neq('status', 'dismissed')
  const today = new Date().toISOString().slice(0, 10)
  const readingCutoff = new Date(Date.now() - READINESS_WINDOWS.objectiveReadingDays * 86_400_000)
    .toISOString().slice(0, 10)

  const [
    contextIssues, contextIssuesOverdue, climateIssues,
    parties, partiesOverdue,
    scopes, policies,
    risks, riskReviews, riskControls,
    aspects, objectives, objectiveReadings,
    obligations, obligationsOverdue, obligationsReviewOverdue,
    lastEvaluation, evaluationsOverdue, obligationsUnscheduled, evaluationsUndetermined,
    reviews,
    nonconformities, ncActions,
  ] = await Promise.all([
    activeIssues(),
    activeIssues().lt('next_review_due', today),
    activeIssues().eq('kind', 'climate'),
    activeParties(),
    activeParties().lt('next_review_due', today),
    supabase.from('ms_scope_statements').select('version, legal_entity, effective_from, next_review_due')
      .eq('tenant_id', tenantId).eq('discipline', 'ems').order('version', { ascending: false }),
    supabase.from('ms_policies').select('commitments, signatory_name, signed_at, next_review_due')
      .eq('tenant_id', tenantId).eq('discipline', 'ems').order('version', { ascending: false }).limit(1),
    supabase.from('risks').select('id, updated_at').eq('tenant_id', tenantId).limit(5000),
    supabase.from('risk_reviews').select('created_at').eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(1),
    supabase.from('risk_controls').select('risk_id').eq('tenant_id', tenantId).limit(10_000),
    supabase.from('environmental_aspect_register')
      .select('id, significant, max_score, controls, related_risk_id, next_review_due')
      .eq('tenant_id', tenantId).is('obsolete_at', null).limit(5000),
    supabase.from('environmental_objectives')
      .select('id, status, target_value, target_date, related_aspect_id')
      .eq('tenant_id', tenantId).limit(2000),
    supabase.from('environmental_objective_readings')
      .select('objective_id, reading_date').eq('tenant_id', tenantId)
      .gte('reading_date', readingCutoff).limit(10_000),
    registerObligations(),
    registerObligations().eq('status', 'open').lt('next_due_at', today),
    registerObligations().lt('next_review_due', today),
    // An undetermined result leaves the status unknown, so it is not an evaluation of compliance here.
    supabase.from('ms_compliance_evaluations').select('completed_at')
      .eq('tenant_id', tenantId).in('discipline', ems).not('completed_at', 'is', null).neq('result', 'undetermined')
      .order('completed_at', { ascending: false }).limit(1),
    t('ms_compliance_evaluations').in('discipline', ems).is('completed_at', null).lt('scheduled_for', today),
    registerObligations().is('evaluation_cadence_days', null),
    t('ms_obligation_register').in('discipline', ems).neq('status', 'dismissed').eq('last_result', 'undetermined'),
    supabase.from('management_reviews')
      .select('review_date, conclusions, decisions, status')
      .eq('tenant_id', tenantId).eq('status', 'completed')
      .order('review_date', { ascending: false }).limit(1),
    supabase.from('nonconformities')
      .select('id, classification, status').eq('tenant_id', tenantId).limit(5000),
    supabase.from('nonconformity_actions')
      .select('id, nonconformity_id, status, due_at, verified_effective_at')
      .eq('tenant_id', tenantId).limit(10_000),
  ])

  const aspectRows    = aspects.data ?? []
  const objectiveRows = objectives.data ?? []
  const readingRows   = objectiveReadings.data ?? []
  const ncRows        = nonconformities.data ?? []
  const actionRows    = ncActions.data ?? []
  const riskRows      = risks.data ?? []

  const significant = aspectRows.filter(a => a.significant)

  // The policy in force, judged by the same rules the policy route applies.
  const scopeRows = scopes.data ?? []
  const policy = (policies.data ?? [])[0] ?? null
  const policyApproved = policy !== null && policyIsComplete({
    commitments:   policy.commitments as Record<string, boolean>,
    signatoryName: policy.signatory_name,
    signedAt:      policy.signed_at,
  }, 'ems')
  const signatoryStale = policy !== null && policySignatoryStale(
    { signedAt: policy.signed_at },
    scopeRows.map(sv => ({ version: sv.version, legalEntity: sv.legal_entity, effectiveFrom: sv.effective_from })),
  )
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

  return {
    contextIssuesActive:            countRows(contextIssues),
    contextIssuesReviewOverdue:     countRows(contextIssuesOverdue),
    climateIssueRecorded:           countRows(climateIssues) > 0,
    interestedPartiesActive:        countRows(parties),
    interestedPartiesReviewOverdue: countRows(partiesOverdue),
    scopeOnFile:        scopeRows.length > 0,
    scopeReviewOverdue: scopeRows.length > 0 && scopeRows[0].next_review_due < today,

    policyApproved,
    policyReviewOverdue: policy !== null && policy.next_review_due < today,
    policySignatoryStale: signatoryStale,

    risks: {
      count:   riskRows.length,
      ageDays: newestAgeDays(riskReviews.data ?? [], 'created_at')
        ?? newestAgeDays(riskRows, 'updated_at'),
    },

    documentsRegisterLive: DOCUMENTS_REGISTER_LIVE,
    requiredDocsMissing:   0,
    docsReviewOverdue:     0,

    risksWithoutControls: riskRows.filter(r => !controlledRiskIds.has(r.id)).length,

    aspectsTotal:            aspectRows.length,
    aspectsSignificant:      significant.length,
    significantUncontrolled: significant.filter(a => !a.controls?.trim() && !a.related_risk_id).length,
    aspectsUnscored:         aspectRows.filter(a => a.max_score === null).length,
    aspectsReviewOverdue:    aspectRows.filter(a => a.next_review_due < today).length,

    obligationsTotal:         countRows(obligations),
    obligationsOverdue:       countRows(obligationsOverdue),
    obligationsReviewOverdue: countRows(obligationsReviewOverdue),
    // 9.1.2 reads the evaluation record itself: compliant and noncompliant
    // results are backed by evidence (migration 299 enforces it), and a
    // not-applicable one by notes; an undetermined one establishes nothing.
    complianceEvalAgeDays:   newestAgeDays(lastEvaluation.data ?? [], 'completed_at'),
    evaluationsOverdue:      countRows(evaluationsOverdue),
    obligationsUnscheduled:  countRows(obligationsUnscheduled),
    evaluationsUndetermined: countRows(evaluationsUndetermined),

    significantUnaddressed: significant.filter(a =>
      !aspectIdsWithObjective.has(a.id) && !a.controls?.trim() && !a.related_risk_id,
    ).length,

    objectivesActive:      objectivesActive.length,
    objectivesLinked:      objectivesActive.filter(o => o.related_aspect_id).length,
    objectivesWithTargets: objectivesActive.filter(o => o.target_value !== null && o.target_date).length,
    objectivesAchieved:    objectiveRows.filter(o => o.status === 'achieved').length,

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
