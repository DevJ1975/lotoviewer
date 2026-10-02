import { readActiveFacility, supabase } from '@/lib/supabase'
import type { RegisterHealth } from '@soteria/core/managementSystem'
import type { AspectOperatingCondition } from '@soteria/core/environmentalAspect'
import type { EvaluationResult } from '@soteria/core/complianceEvaluation'

// Browser client for /api/environmental/*. Same shape as lib/fleet/client.ts
// (bearer token, x-active-tenant, a readJson that surfaces the API's message),
// plus x-active-facility, because aspects belong to a site, and the field
// errors the register routes return, so forms can mark the right input.

export interface FieldError { field: string; message: string }

export class EmsApiError extends Error {
  constructor(message: string, readonly status: number, readonly fieldErrors: FieldError[] = []) {
    super(message)
  }
}

async function headers(tenantId: string, json: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const facilityId = readActiveFacility()
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-active-tenant': tenantId,
    ...(facilityId ? { 'x-active-facility': facilityId } : {}),
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

async function call<T>(tenantId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const isForm = init.body instanceof FormData
  const res = await fetch(path, {
    method:  init.method ?? 'GET',
    headers: await headers(tenantId, init.body !== undefined && !isForm),
    body:    init.body === undefined ? undefined : isForm ? init.body as FormData : JSON.stringify(init.body),
  })
  const json = await res.json().catch(() => ({})) as { error?: string; fieldErrors?: FieldError[] }
  if (!res.ok) throw new EmsApiError(json.error ?? `HTTP ${res.status}`, res.status, json.fieldErrors ?? [])
  return json as T
}

const query = (params: Record<string, string | number | boolean | null | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

// ── Register health ──────────────────────────────────────────────────────
export interface RegistersHealth {
  asOf: string
  context:        { health: RegisterHealth; active: number; reviewOverdue: number; climateRecorded: boolean }
  scopeAndPolicy: { health: RegisterHealth; scopeVersion: number | null; policyVersion: number | null; policyComplete: boolean; signatoryStale: boolean }
  aspects:        { health: RegisterHealth; active: number; reviewOverdue: number; unscored: number }
  obligations:    { health: RegisterHealth; active: number; reviewOverdue: number; evaluationsOverdue: number }
}

export const getRegistersHealth = (tenantId: string) =>
  call<RegistersHealth>(tenantId, '/api/environmental/registers/health')

// ── Aspects (clause 6.1.2) ───────────────────────────────────────────────
export interface CurrentScore {
  operating_condition: AspectOperatingCondition
  severity: number; likelihood: number; score: number; significant: boolean; method_id: string; scored_at: string
}

export interface AspectRow {
  id: string; facility_id: string | null
  activity: string; aspect: string; impact: string; process_area: string | null
  life_cycle_stage: string; flow: 'input' | 'output' | null; status: string
  controls: string | null; notes: string | null; source_reference: string | null
  obsolete_at: string | null; obsolete_reason: string | null
  last_reviewed_at: string | null; next_review_due: string
  significant: boolean; max_score: number | null; current_scores: CurrentScore[]
}

export interface ScoreHistoryRow {
  id: string; operating_condition: AspectOperatingCondition; severity: number; likelihood: number
  score: number; significant: boolean; rationale: string; scored_at: string; scored_by: string | null
  method_name: string; significance_threshold: number
}

export interface AspectFilters {
  status?: 'active' | 'obsolete' | 'all'; process_area?: string; significant?: boolean; review_due?: 'overdue'; offset?: number
}

export const listAspects = (tenantId: string, filters: AspectFilters = {}) =>
  call<{ aspects: AspectRow[]; nextOffset: number | null }>(tenantId, `/api/environmental/aspects${query({ ...filters })}`)

export const getAspect = (tenantId: string, id: string) =>
  call<{ aspect: AspectRow; history: ScoreHistoryRow[]; obligationIds: string[] }>(tenantId, `/api/environmental/aspects/${id}`)

export type AspectBody = Partial<Pick<AspectRow,
  'activity' | 'aspect' | 'impact' | 'process_area' | 'life_cycle_stage' | 'flow' | 'status' | 'controls' | 'notes' | 'source_reference'>>

export const createAspect = (tenantId: string, body: AspectBody) =>
  call<{ aspect: AspectRow }>(tenantId, '/api/environmental/aspects', { method: 'POST', body })

export const updateAspect = (tenantId: string, id: string, body: AspectBody) =>
  call<{ aspect: AspectRow }>(tenantId, `/api/environmental/aspects/${id}`, { method: 'PATCH', body })

export const scoreAspect = (tenantId: string, id: string, body: {
  operating_condition: AspectOperatingCondition; severity: number; likelihood: number; rationale: string
}) => call<{ score: ScoreHistoryRow }>(tenantId, `/api/environmental/aspects/${id}/scores`, { method: 'POST', body })

export const obsoleteAspect = (tenantId: string, id: string, reason: string) =>
  call<{ aspect: AspectRow }>(tenantId, `/api/environmental/aspects/${id}/obsolete`, { method: 'POST', body: { reason } })

export const reviewAspect = (tenantId: string, id: string) =>
  call<{ row: AspectRow }>(tenantId, `/api/environmental/aspects/${id}/review`, { method: 'POST', body: {} })

export const setAspectObligations = (tenantId: string, id: string, obligationIds: string[]) =>
  call<{ obligationIds: string[] }>(tenantId, `/api/environmental/aspects/${id}/obligations`, {
    method: 'PUT', body: { obligation_ids: obligationIds },
  })

// ── Obligations and evaluations (clauses 6.1.3, 9.1.2) ──────────────────
export interface ObligationRow {
  id: string; facility_id: string | null; discipline: string; title: string; description: string | null
  regulatory_ref: string | null; cadence: string; next_due_at: string; status: string; source: string
  source_kind: string | null; jurisdiction: string | null; applicability_rationale: string | null
  evaluation_cadence_days: number | null; last_reviewed_at: string | null; next_review_due: string
  last_evaluation_id: string | null; last_evaluated_at: string | null; last_result: EvaluationResult | null
  last_nonconformity_id: string | null
  open_evaluation_id: string | null; open_evaluation_due: string | null; open_evaluation_assignee: string | null
}

export interface EvaluationRow {
  id: string; obligation_id: string; scheduled_for: string; assigned_to: string | null
  completed_at: string | null; evaluator_id: string | null; result: EvaluationResult | null
  notes: string | null; nonconformity_id: string | null; created_at: string
}

export interface EvidenceRow {
  id: string; subject_id: string; kind: string; file_name: string; mime_type: string; file_size_bytes: number
  sha256: string; uploaded_by: string; uploaded_at: string
  superseded_by: string | null; superseded_at: string | null; superseded_reason: string | null
}

export interface ObligationFilters {
  status?: 'active' | 'dismissed' | 'all'; last_result?: EvaluationResult | 'none'; review_due?: 'overdue'; offset?: number
}

export const listObligations = (tenantId: string, filters: ObligationFilters = {}) =>
  call<{ obligations: ObligationRow[]; nextOffset: number | null }>(tenantId, `/api/environmental/obligations${query({ ...filters })}`)

export const getObligation = (tenantId: string, id: string) =>
  call<{ obligation: ObligationRow; evaluations: EvaluationRow[]; evidence: EvidenceRow[] }>(tenantId, `/api/environmental/obligations/${id}`)

export interface ObligationBody {
  discipline?: 'ems' | 'integrated'; title?: string; description?: string | null; source_kind?: string
  regulatory_ref?: string | null; jurisdiction?: string; applicability_rationale?: string | null
  evaluation_cadence_days?: number | null; next_due_at?: string; cadence?: string; cadence_days?: number | null
}

export const createObligation = (tenantId: string, body: ObligationBody) =>
  call<{ obligation: ObligationRow }>(tenantId, '/api/environmental/obligations', { method: 'POST', body })

export const updateObligation = (tenantId: string, id: string, body: ObligationBody) =>
  call<{ obligation: ObligationRow }>(tenantId, `/api/environmental/obligations/${id}`, { method: 'PATCH', body })

export const reviewObligation = (tenantId: string, id: string) =>
  call<{ row: ObligationRow }>(tenantId, `/api/environmental/obligations/${id}/review`, { method: 'POST', body: {} })

export const openEvaluation = (tenantId: string, obligationId: string, assignedTo?: string) =>
  call<{ evaluation: EvaluationRow }>(tenantId, `/api/environmental/obligations/${obligationId}/evaluations`, {
    method: 'POST', body: assignedTo ? { assigned_to: assignedTo } : {},
  })

export const completeEvaluation = (tenantId: string, evaluationId: string, body: {
  result: EvaluationResult; notes?: string | null
  nonconformity?: { title: string; description?: string | null; classification?: 'observation' | 'minor' | 'major' }
}) => call<{ evaluation: EvaluationRow; nonconformity: { id: string } | null }>(
  tenantId, `/api/environmental/evaluations/${evaluationId}/complete`, { method: 'POST', body })

export function uploadEvidence(tenantId: string, input: {
  evaluationId: string; kind: 'photo' | 'document' | 'sample_result' | 'signature'; file: File
  supersedes?: { id: string; reason: string }
}) {
  const form = new FormData()
  form.set('subject_type', 'compliance_evaluation')
  form.set('subject_id', input.evaluationId)
  form.set('kind', input.kind)
  form.set('file', input.file)
  if (input.supersedes) {
    form.set('supersedes_id', input.supersedes.id)
    form.set('superseded_reason', input.supersedes.reason)
  }
  return call<{ evidence: EvidenceRow }>(tenantId, '/api/environmental/evidence', { method: 'POST', body: form })
}

/**
 * Download a verified evidence file and hand it to the browser. The route
 * re-hashes the bytes first; a file that no longer matches is refused (409)
 * and surfaces here as an EmsApiError.
 */
export async function downloadEvidence(tenantId: string, evidence: Pick<EvidenceRow, 'id' | 'file_name'>): Promise<void> {
  const res = await fetch(`/api/environmental/evidence/${evidence.id}/download`, { headers: await headers(tenantId, false) })
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string }
    throw new EmsApiError(json.error ?? `HTTP ${res.status}`, res.status)
  }
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = evidence.file_name
  link.click()
  URL.revokeObjectURL(url)
}

// ── Context, interested parties, scope, policy (clauses 4.1-4.3, 5.2) ───
export interface ContextIssueRow {
  id: string; discipline: string; kind: 'internal' | 'external' | 'climate'; description: string
  relevance: string | null; effect: 'risk' | 'opportunity' | 'both' | null
  retired_at: string | null; retired_reason: string | null; last_reviewed_at: string | null; next_review_due: string
}

export interface InterestedPartyRow {
  id: string; discipline: string; name: string; needs_expectations: string
  becomes_obligation: boolean; obligation_id: string | null
  retired_at: string | null; retired_reason: string | null; last_reviewed_at: string | null; next_review_due: string
}

export interface ScopeRow {
  id: string; version: number; legal_entity: string; physical_boundary: string; activities: string
  products_services: string; effective_from: string; next_review_due: string; created_at: string
}

export interface PolicyRow {
  id: string; version: number; body: string; commitments: Record<string, boolean>
  signatory_name: string; signatory_title: string | null; signed_at: string; next_review_due: string; created_at: string
}

export interface PolicyCommitmentOption { key: string; label: string }

type RegisterStatus = 'active' | 'retired' | 'all'

export const listContextIssues = (tenantId: string, status: RegisterStatus = 'active') =>
  call<{ issues: ContextIssueRow[] }>(tenantId, `/api/environmental/context-issues${query({ status })}`)

export const createContextIssue = (tenantId: string, body: Partial<ContextIssueRow>) =>
  call<{ issue: ContextIssueRow }>(tenantId, '/api/environmental/context-issues', { method: 'POST', body })

export const updateContextIssue = (tenantId: string, id: string, body: Partial<ContextIssueRow>) =>
  call<{ issue: ContextIssueRow }>(tenantId, `/api/environmental/context-issues/${id}`, { method: 'PATCH', body })

export const reviewContextIssue = (tenantId: string, id: string) =>
  call<{ row: ContextIssueRow }>(tenantId, `/api/environmental/context-issues/${id}/review`, { method: 'POST', body: {} })

export const listInterestedParties = (tenantId: string, status: RegisterStatus = 'active') =>
  call<{ parties: InterestedPartyRow[] }>(tenantId, `/api/environmental/interested-parties${query({ status })}`)

export const createInterestedParty = (tenantId: string, body: Partial<InterestedPartyRow>) =>
  call<{ party: InterestedPartyRow }>(tenantId, '/api/environmental/interested-parties', { method: 'POST', body })

export const updateInterestedParty = (tenantId: string, id: string, body: Partial<InterestedPartyRow>) =>
  call<{ party: InterestedPartyRow }>(tenantId, `/api/environmental/interested-parties/${id}`, { method: 'PATCH', body })

export const reviewInterestedParty = (tenantId: string, id: string) =>
  call<{ row: InterestedPartyRow }>(tenantId, `/api/environmental/interested-parties/${id}/review`, { method: 'POST', body: {} })

export const getScope = (tenantId: string) =>
  call<{ current: ScopeRow | null; versions: ScopeRow[] }>(tenantId, '/api/environmental/scope')

export const saveScope = (tenantId: string, body: Omit<ScopeRow, 'id' | 'version' | 'next_review_due' | 'created_at'>) =>
  call<{ scope: ScopeRow }>(tenantId, '/api/environmental/scope', { method: 'POST', body })

export const getPolicy = (tenantId: string) =>
  call<{
    current: PolicyRow | null; versions: PolicyRow[]; requiredCommitments: PolicyCommitmentOption[]
    complete: boolean; signatoryStale: boolean
  }>(tenantId, '/api/environmental/policy')

export const savePolicy = (tenantId: string, body: Omit<PolicyRow, 'id' | 'version' | 'next_review_due' | 'created_at'>) =>
  call<{ policy: PolicyRow }>(tenantId, '/api/environmental/policy', { method: 'POST', body })
