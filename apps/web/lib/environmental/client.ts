import { readActiveFacility, supabase } from '@/lib/supabase'
import type { RegisterHealth } from '@soteria/core/managementSystem'
import type { AspectOperatingCondition } from '@soteria/core/environmentalAspect'
import type { EvaluationResult } from '@soteria/core/complianceEvaluation'
import type { ResponsibilityCoverage, ResponsibilityKey } from '@soteria/core/emsProcesses'
import type { Escalation, PermitInstrument, PermitProgram, PermitStanding } from '@soteria/core/environmentalPermit'
import type { ChangeKind, ImpactTargetType } from '@soteria/core/managementOfChange'

// Browser client for /api/environmental/*. Same shape as lib/fleet/client.ts
// (bearer token, x-active-tenant, a readJson that surfaces the API's message),
// plus x-active-facility, because aspects belong to a site, and the field
// errors the register routes return, so forms can mark the right input.

export interface FieldError { field: string; message: string }

export class EmsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: FieldError[] = [],
    /** The whole error body, for the routes that say more (a 422's gaps, a policy's missing commitments). */
    readonly details: Record<string, unknown> = {},
  ) {
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
  if (!res.ok) throw new EmsApiError(json.error ?? `HTTP ${res.status}`, res.status, json.fieldErrors ?? [], json)
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
  scopeAndPolicy: {
    health: RegisterHealth; scopeVersion: number | null; policyVersion: number | null; policyComplete: boolean; signatoryStale: boolean
    scopeStatesControlAndInfluence: boolean; policyCommunicatedInternally: boolean
  }
  aspects:        { health: RegisterHealth; active: number; reviewOverdue: number; unscored: number }
  obligations:    {
    health: RegisterHealth; active: number; reviewOverdue: number; evaluationsOverdue: number; unscheduled: number; deadlinesMissed: number
  }
  responsibilities: { health: RegisterHealth } & ResponsibilityCoverage
  permits: {
    health: RegisterHealth; active: number; deadlineMissed: number; holderMismatch: number
    renewalSoon: number; conditionsOverdue: number; reviewOverdue: number
  }
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
  life_cycle_stage: string; flow: 'input' | 'output' | null; control_level: 'control' | 'influence' | null; status: string
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
  'activity' | 'aspect' | 'impact' | 'process_area' | 'life_cycle_stage' | 'flow' | 'control_level' | 'status' | 'controls'
  | 'notes' | 'source_reference'>>

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
  /** Set when this obligation is a condition of a permit. */
  permit_id: string | null
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
  export_controlled: boolean
}

export interface ObligationFilters {
  status?: 'active' | 'dismissed' | 'all'; last_result?: EvaluationResult | 'none'; review_due?: 'overdue'; offset?: number
}

export const listObligations = (tenantId: string, filters: ObligationFilters = {}) =>
  call<{ obligations: ObligationRow[]; nextOffset: number | null }>(tenantId, `/api/environmental/obligations${query({ ...filters })}`)

export interface LinkedAspect { id: string; activity: string; aspect: string; obsolete_at: string | null }

export const getObligation = (tenantId: string, id: string) =>
  call<{ obligation: ObligationRow; evaluations: EvaluationRow[]; evidence: EvidenceRow[]; linkedAspects: LinkedAspect[] }>(
    tenantId, `/api/environmental/obligations/${id}`)

export interface ObligationBody {
  discipline?: 'ems' | 'integrated'; title?: string; description?: string | null; source_kind?: string
  /** A permit this obligation is a condition of; null unlinks it. */
  permit_id?: string | null
  regulatory_ref?: string | null; jurisdiction?: string | null; applicability_rationale?: string | null
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

export type EvidenceKindOption = 'photo' | 'document' | 'sample_result' | 'signature'
export type EvidenceSubjectType =
  | 'compliance_evaluation' | 'environmental_permit' | 'ms_change_impact' | 'compliance_calendar_event' | 'compliance_obligation'

/** What a file of evidence is attached to, and what kind of file it is. */
export interface EvidenceUploadInput {
  subjectType: EvidenceSubjectType
  subjectId: string
  kind: EvidenceKindOption
  file: File
  /** An export-controlled file is downloaded by owners and admins only. */
  exportControlled?: boolean
  supersedes?: { id: string; reason: string }
}

/** Files up to this size go in the request body; larger ones go straight to storage. */
export const MAX_BODY_EVIDENCE_BYTES = 4 * 1024 * 1024
export const MAX_DIRECT_EVIDENCE_BYTES = 25 * 1024 * 1024

const evidenceFields = (input: EvidenceUploadInput) => ({
  subject_type: input.subjectType,
  subject_id: input.subjectId,
  kind: input.kind,
  ...(input.exportControlled ? { export_controlled: true } : {}),
  ...(input.supersedes ? { supersedes_id: input.supersedes.id, superseded_reason: input.supersedes.reason } : {}),
})

/** A small file, sent in the request. */
function uploadEvidenceInBody(tenantId: string, input: EvidenceUploadInput) {
  const form = new FormData()
  for (const [name, value] of Object.entries(evidenceFields(input))) form.set(name, String(value))
  form.set('file', input.file)
  return call<{ evidence: EvidenceRow }>(tenantId, '/api/environmental/evidence', { method: 'POST', body: form })
}

/**
 * A larger file: the API signs a one-time upload into a pending folder, the
 * browser sends the bytes straight to storage, and the API then re-reads,
 * hashes and files them. A request body would be refused at about 4.5 MB.
 */
async function uploadEvidenceDirect(tenantId: string, input: EvidenceUploadInput) {
  const fields = evidenceFields(input)
  const started = await call<{ path: string; token: string }>(tenantId, '/api/environmental/evidence/uploads', {
    method: 'POST', body: { ...fields, file_size: input.file.size },
  })
  const { error } = await supabase.storage.from('ms-evidence').uploadToSignedUrl(started.path, started.token, input.file)
  if (error) throw new EmsApiError(`The file could not be uploaded: ${error.message}`, 502)
  return call<{ evidence: EvidenceRow }>(tenantId, '/api/environmental/evidence/uploads/finalize', {
    method: 'POST', body: { ...fields, path: started.path, file_name: input.file.name },
  })
}

export function uploadEvidence(tenantId: string, input: EvidenceUploadInput) {
  return input.file.size > MAX_BODY_EVIDENCE_BYTES ? uploadEvidenceDirect(tenantId, input) : uploadEvidenceInBody(tenantId, input)
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
  products_services: string; control_and_influence: string | null; exclusions: string | null
  effective_from: string; next_review_due: string; created_at: string
}

export interface PolicyRow {
  id: string; version: number; body: string; commitments: Record<string, boolean>
  signatory_name: string; signatory_title: string | null; signed_at: string; next_review_due: string; created_at: string
}

export interface PolicyCommitmentOption { key: string; label: string }

export interface PolicyCommunicationRow {
  id: string; policy_id: string; audience: 'internal' | 'external'; method: string; communicated_on: string
  recorded_by: string | null; created_at: string
}

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
    communications: PolicyCommunicationRow[]; communicatedInternally: boolean
  }>(tenantId, '/api/environmental/policy')

export const savePolicy = (tenantId: string, body: Omit<PolicyRow, 'id' | 'version' | 'next_review_due' | 'created_at'>) =>
  call<{ policy: PolicyRow }>(tenantId, '/api/environmental/policy', { method: 'POST', body })

export const recordPolicyCommunication = (tenantId: string, body: Pick<PolicyCommunicationRow, 'policy_id' | 'audience' | 'method' | 'communicated_on'>) =>
  call<{ communication: PolicyCommunicationRow }>(tenantId, '/api/environmental/policy/communications', { method: 'POST', body })

// ── Processes and responsibilities (clauses 4.4, 5.3) ───────────────────
export interface ResponsibilityRow {
  responsibility_key: ResponsibilityKey; owner_user_id: string | null; assigned_by: string | null; updated_at: string
}

export const getResponsibilities = (tenantId: string) =>
  call<{ responsibilities: ResponsibilityRow[]; coverage: ResponsibilityCoverage; health: RegisterHealth }>(
    tenantId, '/api/environmental/responsibilities')

export const assignResponsibility = (tenantId: string, key: ResponsibilityKey, ownerUserId: string | null) =>
  call<{ responsibility: ResponsibilityRow }>(tenantId, `/api/environmental/responsibilities/${key}`, {
    method: 'PUT', body: { owner_user_id: ownerUserId },
  })

// ── Permits and their conditions (clause 6.1.3) ─────────────────────────
export interface PermitRow {
  id: string; facility_id: string; program: PermitProgram; instrument: PermitInstrument
  title: string; agency: string; permit_number: string | null; jurisdiction: string; holder_of_record: string
  issued_on: string | null; expires_on: string | null; renewal_application_due_on: string | null; renewal_submitted_on: string | null
  business_critical: boolean; owner_user_id: string | null; notes: string | null
  retired_at: string | null; retired_reason: string | null
  last_reviewed_at: string | null; next_review_due: string
  standing: PermitStanding
  renewal_deadline: string | null
  escalation: Escalation | null
  /** Null when no scope is in force yet, so there is nothing to compare the holder with. */
  holder_mismatch: boolean | null
  conditions_open: number; conditions_overdue: number
}

export interface PermitCondition {
  id: string; title: string; description: string | null; cadence: string; next_due_at: string
  owner_user_id: string | null; status: string; permit_id: string
  last_evaluated_at: string | null; last_result: EvaluationResult | null
}

export interface PermitChangeRef { id: string; kind: ChangeKind; title: string; status: string; opened_at: string; ended_at: string | null }

export interface PermitFilters {
  status?: 'active' | 'retired' | 'all'; program?: PermitProgram; business_critical?: boolean
  holder_mismatch?: boolean; standing?: PermitStanding
}

export const listPermits = (tenantId: string, filters: PermitFilters = {}) =>
  call<{ permits: PermitRow[]; legalEntityInForce: string | null; asOf: string }>(
    tenantId, `/api/environmental/permits${query({ ...filters })}`)

export const getPermit = (tenantId: string, id: string) =>
  call<{
    permit: PermitRow; legalEntityInForce: string | null; conditions: PermitCondition[]
    documents: EvidenceRow[]; changes: PermitChangeRef[]
  }>(tenantId, `/api/environmental/permits/${id}`)

export interface PermitBody {
  program?: PermitProgram; instrument?: PermitInstrument; title?: string; agency?: string
  permit_number?: string | null; jurisdiction?: string; holder_of_record?: string
  issued_on?: string | null; expires_on?: string | null; renewal_application_due_on?: string | null
  business_critical?: boolean; notes?: string | null
  /** A member's user id; null clears the owner. Changed from the all-facilities view only. */
  owner_user_id?: string | null
}

export const createPermit = (tenantId: string, body: PermitBody) =>
  call<{ permit: PermitRow }>(tenantId, '/api/environmental/permits', { method: 'POST', body })

export const updatePermit = (tenantId: string, id: string, body: PermitBody) =>
  call<{ permit: PermitRow }>(tenantId, `/api/environmental/permits/${id}`, { method: 'PATCH', body })

export const recordRenewalSubmitted = (tenantId: string, id: string, submittedOn: string) =>
  call<{ permit: PermitRow }>(tenantId, `/api/environmental/permits/${id}/renewal`, {
    method: 'POST', body: { action: 'submitted', submitted_on: submittedOn },
  })

export const recordRenewedTerm = (tenantId: string, id: string, term: {
  issued_on: string; expires_on: string | null; renewal_application_due_on: string | null; permit_number: string | null
}) => call<{ permit: PermitRow }>(tenantId, `/api/environmental/permits/${id}/renewal`, {
  method: 'POST', body: { action: 'renewed', ...term },
})

export const retirePermit = (tenantId: string, id: string, reason: string) =>
  call<{ permit: PermitRow }>(tenantId, `/api/environmental/permits/${id}/retire`, { method: 'POST', body: { retired_reason: reason } })

export const reviewPermit = (tenantId: string, id: string) =>
  call<{ row: PermitRow }>(tenantId, `/api/environmental/permits/${id}/review`, { method: 'POST', body: {} })

export interface ConditionBody {
  title: string; description?: string | null; citation?: string | null; applicability_rationale?: string | null
  next_due_at: string; cadence: string; cadence_days?: number | null
  evaluation_cadence_days?: number | null; owner_user_id?: string | null
}

export const addPermitCondition = (tenantId: string, permitId: string, body: ConditionBody) =>
  call<{ condition: PermitCondition }>(tenantId, `/api/environmental/permits/${permitId}/conditions`, { method: 'POST', body })

export interface OccurrenceRow {
  id: string; obligation_id: string; occurrence_at: string; completed_at: string; completed_by: string | null; note: string | null
}

export const listOccurrences = (tenantId: string, obligationId: string) =>
  call<{ occurrences: OccurrenceRow[]; evidence: EvidenceRow[] }>(tenantId, `/api/environmental/obligations/${obligationId}/occurrences`)

/** Record that a condition was done for the deadline `dueOn`; the next deadline follows from its cadence. */
export const recordOccurrence = (tenantId: string, obligationId: string, dueOn: string, note: string | null) =>
  call<{ occurrence: { id: string; obligation_id: string; occurrence_at: string } }>(
    tenantId, `/api/environmental/obligations/${obligationId}/occurrences`, { method: 'POST', body: { due_on: dueOn, note } })

// ── Management of change (clauses 6.1.4, 8.1) ───────────────────────────
export interface ChangeRow {
  id: string; facility_id: string | null; discipline: string; kind: ChangeKind; title: string; description: string
  process_area: string | null; new_legal_entity: string | null; effective_on: string | null
  status: 'open' | 'closed' | 'cancelled'; requested_by: string | null
  opened_at: string; ended_at: string | null; ended_by: string | null; cancelled_reason: string | null
}

export interface ChangeSummary extends ChangeRow { impacts_total: number; impacts_resolved: number }

export interface ImpactRow {
  id: string; change_id: string; target_type: ImpactTargetType; target_id: string
  /** The named step of a permit transfer; null for any other impact. */
  step: string | null; step_order: number; action_required: string
  resolved_at: string | null; resolved_by: string | null; resolution_note: string | null
  target_label: string; target_href: string | null
  /** The impact needs a note to resolve; the note is typed as it is resolved. */
  needs_note: boolean
  /** Plain-words reasons the database would refuse to resolve it now. */
  blockers: string[]
}

export interface ChangeBody {
  discipline?: 'ems'; kind: ChangeKind; title: string; description: string
  process_area?: string | null; new_legal_entity?: string | null; effective_on?: string | null
}

export const listChanges = (tenantId: string, status: 'open' | 'closed' | 'cancelled' | 'all' = 'open') =>
  call<{ changes: ChangeSummary[] }>(tenantId, `/api/environmental/changes${query({ status })}`)

export const getChange = (tenantId: string, id: string) =>
  call<{ change: ChangeRow; impacts: ImpactRow[]; evidence: EvidenceRow[]; closeBlockers: string[] }>(
    tenantId, `/api/environmental/changes/${id}`)

export const openChange = (tenantId: string, body: ChangeBody) =>
  call<{ change: ChangeRow; impacts: number }>(tenantId, '/api/environmental/changes', { method: 'POST', body })

export const closeChange = (tenantId: string, id: string) =>
  call<{ change: ChangeRow }>(tenantId, `/api/environmental/changes/${id}`, { method: 'PATCH', body: { status: 'closed' } })

export const cancelChange = (tenantId: string, id: string, reason: string) =>
  call<{ change: ChangeRow }>(tenantId, `/api/environmental/changes/${id}`, {
    method: 'PATCH', body: { status: 'cancelled', cancelled_reason: reason },
  })

export const resolveImpact = (tenantId: string, changeId: string, impactId: string, note: string | null) =>
  call<{ impact: ImpactRow }>(tenantId, `/api/environmental/changes/${changeId}/impacts/${impactId}/resolve`, {
    method: 'POST', body: { resolution_note: note },
  })

/** What opening this change would create, without opening it. */
export const previewChange = (tenantId: string, body: ChangeBody) =>
  call<{ preview: { impacts: number; byTarget: Partial<Record<ImpactTargetType, number>> } }>(
    tenantId, '/api/environmental/changes?preview=true', { method: 'POST', body })
