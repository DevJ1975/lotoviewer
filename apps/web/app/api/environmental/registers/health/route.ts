import { NextResponse } from 'next/server'
import {
  policyIsComplete,
  policySignatoryStale,
  registerHealthFromCounts,
  scopeAndPolicyHealth,
} from '@soteria/core/managementSystem'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  EMS_DISCIPLINES,
  ENVIRONMENTAL_MODULE,
  emsDisciplineParam,
  gateFailure,
  todayUtc,
} from '@/lib/environmental/registerApi'

// GET /api/environmental/registers/health?discipline=ems   One traffic light per register,
//   with the counts behind it, for the hub and the report card:
//     context          red: no issues;   amber: a review is overdue, or no climate issue (Amd 1:2024)
//     scopeAndPolicy   red: either missing; amber: incomplete policy, prior owner's signature, or overdue review
//     aspects          red: no aspects;  amber: a review is overdue, or an active aspect has no score
//     obligations      red: none;        amber: a review is overdue, a deadline has passed with the
//                                         obligation still open, an evaluation is past due, or an
//                                         obligation has no evaluation frequency (clause 9.1.2 a)
//
// Counts come from the database (count=exact, no rows), so the answer is right however
// large the register, with no row cap to truncate it.

interface PolicyRow { commitments: Record<string, boolean>; signatory_name: string; signed_at: string; next_review_due: string; version: number }
interface ScopeRow { version: number; legal_entity: string; effective_from: string; next_review_due: string }

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const discipline = emsDisciplineParam(new URL(req.url).searchParams.get('discipline'))
  if (!discipline) return NextResponse.json({ error: 'discipline must be ems or integrated' }, { status: 400 })

  const today = todayUtc()
  const db = gate.authedClient
  const count = (table: string) => db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', gate.tenantId)
  const activeIssues = () => count('ms_context_issues').in('discipline', EMS_DISCIPLINES).is('retired_at', null)
  const activeAspects = () => count('environmental_aspects').is('obsolete_at', null)
  const activeObligations = () => count('compliance_calendar_obligations').in('discipline', EMS_DISCIPLINES).neq('status', 'dismissed')

  const results = await Promise.all([
    activeIssues(),
    activeIssues().lt('next_review_due', today),
    activeIssues().eq('kind', 'climate'),
    activeAspects(),
    activeAspects().lt('next_review_due', today),
    count('environmental_aspect_register').is('obsolete_at', null).is('max_score', null),
    activeObligations(),
    activeObligations().lt('next_review_due', today),
    activeObligations().is('evaluation_cadence_days', null),
    // A missed deadline is a compliance failure the site lead must see, not just the report card.
    activeObligations().eq('status', 'open').lt('next_due_at', today),
    count('ms_compliance_evaluations').in('discipline', EMS_DISCIPLINES).is('completed_at', null).lt('scheduled_for', today),
    db.from('ms_scope_statements').select('version, legal_entity, effective_from, next_review_due')
      .eq('tenant_id', gate.tenantId).eq('discipline', discipline).order('version', { ascending: false }),
    db.from('ms_policies').select('version, commitments, signatory_name, signed_at, next_review_due')
      .eq('tenant_id', gate.tenantId).eq('discipline', discipline).order('version', { ascending: false }).limit(1).maybeSingle(),
  ] as const)
  const failed = results.find(r => r.error)?.error
  if (failed) return sanitizeError(failed, 'environmental/registers/health/GET')

  const [issues, issuesOverdue, climate, aspects, aspectsOverdue, unscored, obligations, obligationsOverdue,
    unscheduled, deadlinesMissed, evaluationsOverdue, scopeVersions, policyResult] = results
  const n = (r: { count?: number | null }) => r.count ?? 0

  const scopes = (scopeVersions.data ?? []) as ScopeRow[]
  const scope = scopes[0] ?? null
  const policy = (policyResult.data ?? null) as PolicyRow | null
  const policyComplete = policy !== null && policyIsComplete({
    commitments: policy.commitments, signatoryName: policy.signatory_name, signedAt: policy.signed_at,
  }, discipline)
  const signatoryStale = policy !== null && policySignatoryStale(
    { signedAt: policy.signed_at },
    scopes.map(s => ({ version: s.version, legalEntity: s.legal_entity, effectiveFrom: s.effective_from })),
  )

  return NextResponse.json({
    asOf: today,
    context: {
      health:          registerHealthFromCounts({ active: n(issues), reviewOverdue: n(issuesOverdue), gaps: n(climate) > 0 ? 0 : 1 }),
      active:          n(issues),
      reviewOverdue:   n(issuesOverdue),
      climateRecorded: n(climate) > 0,
    },
    scopeAndPolicy: {
      health: scopeAndPolicyHealth({
        scopeNextReviewDue:  scope?.next_review_due ?? null,
        policyNextReviewDue: policy?.next_review_due ?? null,
        policyComplete,
        signatoryStale,
      }, today),
      scopeVersion:  scope?.version ?? null,
      policyVersion: policy?.version ?? null,
      policyComplete,
      signatoryStale,
    },
    aspects: {
      health:        registerHealthFromCounts({ active: n(aspects), reviewOverdue: n(aspectsOverdue), gaps: n(unscored) }),
      active:        n(aspects),
      reviewOverdue: n(aspectsOverdue),
      unscored:      n(unscored),
    },
    obligations: {
      health:             registerHealthFromCounts({
        active: n(obligations), reviewOverdue: n(obligationsOverdue),
        gaps: n(deadlinesMissed) + n(evaluationsOverdue) + n(unscheduled),
      }),
      active:             n(obligations),
      reviewOverdue:      n(obligationsOverdue),
      evaluationsOverdue: n(evaluationsOverdue),
      unscheduled:        n(unscheduled),
      deadlinesMissed:    n(deadlinesMissed),
    },
  })
}
