import { supabase } from '@/lib/supabase'
import type { ApplyPlan } from './applyLibrary'
import type { siteDetail, siteSummary } from './siteView'

// Browser client for the /api/environmental/* family: a bearer token from the
// session plus the active tenant and site on every call (the same headers the
// route gate reads), and one error type that keeps the API's list of problems so
// a form can show all of them.

export interface Scope {
  tenantId:   string
  /** The active site, or null in the all-sites roll-up. */
  facilityId: string | null
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly details: string[]) {
    super(message)
  }
}

const MESSAGES: Record<string, string> = {
  facility_required:  'Choose a site first.',
  stale:              'That changed while you were looking at it. Refresh and try again.',
  not_found:          'That record no longer exists.',
  already_submitted:  'This checklist was already submitted.',
  missing_required:   'Some required questions are still unanswered.',
}

export async function api<T>(scope: Scope, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'x-active-tenant': scope.tenantId }
  if (scope.facilityId) headers['x-active-facility'] = scope.facilityId
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'

  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const json = await res.json().catch(() => ({})) as { error?: string; details?: unknown }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : null
    const details = Array.isArray(json.details) ? json.details.filter((d): d is string => typeof d === 'string') : []
    throw new ApiError(details[0] ?? (code && MESSAGES[code]) ?? code ?? `Request failed (${res.status})`, res.status, code, details)
  }
  return json as T
}

export const errorMessage = (e: unknown, fallback = 'Something went wrong.') => (e instanceof Error ? e.message : fallback)

/** Every problem the API reported, or the single message when it gave none. */
export const errorList = (e: unknown): string[] => (e instanceof ApiError && e.details.length > 0 ? e.details : [errorMessage(e)])

// ── sites ───────────────────────────────────────────────────────────────────
export type SiteSummary = ReturnType<typeof siteSummary>
export type SiteDetail = ReturnType<typeof siteDetail>
export type SiteSaveResult = SiteDetail & { state_changed: boolean }

export const listSites = (scope: Scope) => api<{ sites: SiteSummary[] }>(scope, '/api/environmental/sites')
export const getSite = (scope: Scope, facilityId: string) => api<SiteDetail>(scope, `/api/environmental/sites/${facilityId}/profile`)
export const saveSite = (scope: Scope, facilityId: string, body: Record<string, unknown>) =>
  api<SiteSaveResult>(scope, `/api/environmental/sites/${facilityId}/profile`, { method: 'PUT', body })

export interface PackStatus { jurisdiction: string; version: string; status: 'draft' | 'csp_approved'; last_verified: string | null }
export type PlanSummary = ReturnType<typeof import('./applyLibrary').summarizePlan>
export interface ApplyResponse {
  dry_run: boolean
  plan:    PlanSummary
  packs:   PackStatus[]
  result?: { legal: { created: number; alreadyThere: number }; templates: { created: number; alreadyThere: number }; obligations: { created: number; alreadyThere: number } }
}
export const previewLibrary = (scope: Scope, facilityId: string) =>
  api<ApplyResponse>(scope, `/api/environmental/sites/${facilityId}/apply-library`, { method: 'POST', body: { dry_run: true } })
export const applyLibraryToSite = (scope: Scope, facilityId: string) =>
  api<ApplyResponse>(scope, `/api/environmental/sites/${facilityId}/apply-library`, { method: 'POST', body: { dry_run: false } })
export type { ApplyPlan }

// ── calendar ────────────────────────────────────────────────────────────────
export type Urgency = 'overdue' | 'due_soon' | 'upcoming'
export interface Deadline {
  id: string; title: string; description: string | null; regulatory_ref: string | null
  program: string | null; cadence: string; cadence_days: number | null; next_due_at: string
  status: 'open' | 'completed' | 'dismissed'; lead_days: number; due_anchor: 'fixed' | 'period_end'
  owner_user_id: string | null; facility_id: string | null; source: string; checklist_template_id: string | null
  library_key: string | null; urgency: Urgency | null; days_until: number | null; last_completed_at: string | null
}
export const listDeadlines = (scope: Scope, query: { status?: string; program?: string; facilityId?: string } = {}) => {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.program) params.set('program', query.program)
  if (query.facilityId) params.set('facility_id', query.facilityId)
  return api<{ obligations: Deadline[] }>(scope, `/api/environmental/calendar${params.size ? `?${params}` : ''}`)
}
export const createDeadline = (scope: Scope, body: Record<string, unknown>) =>
  api<{ obligation: Deadline }>(scope, '/api/environmental/calendar', { method: 'POST', body })
export const updateDeadline = (scope: Scope, id: string, body: Record<string, unknown>) =>
  api<{ obligation: Deadline }>(scope, `/api/environmental/calendar/${id}`, { method: 'PATCH', body })
export const completeDeadline = (scope: Scope, id: string, body: { occurrence_at: string; note?: string }) =>
  api<{ obligation: Deadline }>(scope, `/api/environmental/calendar/${id}/complete`, { method: 'POST', body })

// ── permits ─────────────────────────────────────────────────────────────────
export type PermitHealthState = 'active' | 'expiring' | 'expired' | 'not_tracked'
export interface Permit {
  id: string; facility_id: string; program: string; permit_type: string; permit_number: string | null; issuing_agency: string | null
  jurisdiction: string | null; status: string; effective_date: string | null; expiration_date: string | null; renewal_lead_days: number
  identifiers: Record<string, string>; conditions: Array<{ id: string; text: string; frequency?: string; ref?: string }>
  document_path: string | null; notes: string | null; health: PermitHealthState
}
export const listPermits = (scope: Scope) => api<{ permits: Permit[] }>(scope, '/api/environmental/permits')
export const createPermit = (scope: Scope, body: Record<string, unknown>) =>
  api<{ permit: Omit<Permit, 'health'> }>(scope, '/api/environmental/permits', { method: 'POST', body })
export const updatePermit = (scope: Scope, id: string, body: Record<string, unknown>) =>
  api<{ permit: Omit<Permit, 'health'> }>(scope, `/api/environmental/permits/${id}`, { method: 'PATCH', body })
export const deletePermit = (scope: Scope, id: string) =>
  api<{ ok: true }>(scope, `/api/environmental/permits/${id}`, { method: 'DELETE' })

// ── checklists ──────────────────────────────────────────────────────────────
export type DueStatus = 'never' | 'ok' | 'due_soon' | 'overdue'
export interface ChecklistTemplateRow {
  library_key: string; name: string; description: string; program: string; subject_type: 'facility' | 'outfall' | 'permit' | 'hw_area'
  cadence: string; item_count: number; source: string; template_id: string | null; last_completed_on: string | null
  due_status: DueStatus; due_on: string | null
}
export interface ChecklistRunRow {
  id: string; title: string; status: 'in_progress' | 'submitted'; result: 'pass' | 'fail' | null
  score: number | null; max_score: number | null; started_at: string; submitted_at: string | null
}
export const listChecklists = (scope: Scope) => api<{ templates: ChecklistTemplateRow[]; runs: ChecklistRunRow[] }>(scope, '/api/environmental/checklists')
export const startChecklist = (scope: Scope, body: { library_key: string; subject_id?: string; obligation_id?: string; occurrence_at?: string }) =>
  api<{ inspection_id: string; resumed: boolean }>(scope, '/api/environmental/checklists', { method: 'POST', body })

export interface RunItemView {
  id: string; section: string; prompt: string; item_type: 'pass_fail_na' | 'multiple_choice' | 'numeric' | 'text' | 'photo' | 'signature'
  required: boolean; critical: boolean; guidance: string | null; citations: Array<{ ref: string; title?: string; verify?: string }>
  clause_ref: string | null; unit: string | null; min: number | null; max: number | null
}
export interface RunView {
  inspection: { id: string; title: string; status: 'in_progress' | 'submitted'; result: 'pass' | 'fail' | null; score: number | null; max_score: number | null; facility_id: string | null }
  run: { obligation_id: string | null; occurrence_at: string | null; attested: boolean; signature: { name?: string; signed_at?: string } | null }
  template_name: string; subject_label: string | null; items: RunItemView[]
  responses: Array<{ item_id: string; value: unknown; result: 'pass' | 'fail' | 'na' | null; evidence_id: string | null; note: string | null }>
}
export const getRun = (scope: Scope, id: string) => api<RunView>(scope, `/api/environmental/checklists/${id}`)
export interface SubmitBody {
  attested: true; signature_name: string; signature_image_path?: string
  answers: Array<{ item_id: string; result?: 'pass' | 'fail' | 'na' | null; value?: unknown; evidence_id?: string | null; note?: string | null }>
}
export const submitRun = (scope: Scope, id: string, body: SubmitBody) =>
  api<{ result: 'pass' | 'fail'; score: number; maxScore: number; pct: number; findingsRaised: number; completedObligation: boolean }>(
    scope, `/api/environmental/checklists/${id}/submit`, { method: 'POST', body })

// ── outfalls ────────────────────────────────────────────────────────────────
export interface Outfall {
  id: string; facility_id: string; permit_id: string | null; code: string; name: string | null
  receiving_water: string | null; drainage_area: string | null; latitude: number | null; longitude: number | null
  outfall_type: 'stormwater' | 'authorized_nsw' | 'combined'; substantially_identical_to: string | null
  is_sampling_point: boolean; status: 'active' | 'inactive' | 'removed'; photo_path: string | null; notes: string | null
}
export const listOutfalls = (scope: Scope) => api<{ outfalls: Outfall[] }>(scope, '/api/environmental/outfalls')
export const createOutfall = (scope: Scope, body: Record<string, unknown>) =>
  api<{ outfall: Outfall }>(scope, '/api/environmental/outfalls', { method: 'POST', body })
export const updateOutfall = (scope: Scope, id: string, body: Record<string, unknown>) =>
  api<{ outfall: Outfall }>(scope, `/api/environmental/outfalls/${id}`, { method: 'PATCH', body })
export const deleteOutfall = (scope: Scope, id: string) =>
  api<{ ok: true }>(scope, `/api/environmental/outfalls/${id}`, { method: 'DELETE' })

// ── legal register ──────────────────────────────────────────────────────────
export type Applicability = 'applicable' | 'not_applicable' | 'under_review'
export type ComplianceStatus = 'not_evaluated' | 'compliant' | 'attention' | 'non_compliant'
export type ReviewState = 'never_reviewed' | 'ok' | 'due_soon' | 'overdue'
export interface LegalEntry {
  id: string; facility_id: string | null; title: string; citation: string; jurisdiction: string; authority: string | null
  summary: string | null; applicability_note: string | null; source_url: string | null; effective_date: string | null
  review_frequency: string | null; last_reviewed_at: string | null; next_review_due: string | null; program: string | null
  library_key: string | null; applicability: Applicability; compliance_status: ComplianceStatus
  last_evaluated_at: string | null; evaluation_note: string | null; evidence_path: string | null; owner_user_id: string | null
  source: 'library' | 'tenant' | 'ai'; review: ReviewState
}
export const listLegal = (scope: Scope, filters: { program?: string; compliance_status?: string; applicability?: string } = {}) => {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
  return api<{ entries: LegalEntry[] }>(scope, `/api/environmental/legal${params.size ? `?${params}` : ''}`)
}
export const createLegal = (scope: Scope, body: Record<string, unknown>) =>
  api<{ entry: Omit<LegalEntry, 'review'> }>(scope, '/api/environmental/legal', { method: 'POST', body })
export const updateLegal = (scope: Scope, id: string, body: Record<string, unknown>) =>
  api<{ entry: Omit<LegalEntry, 'review'> }>(scope, `/api/environmental/legal/${id}`, { method: 'PATCH', body })
export const deleteLegal = (scope: Scope, id: string) =>
  api<{ ok: true; warning?: string }>(scope, `/api/environmental/legal/${id}`, { method: 'DELETE' })
export const evaluateLegal = (scope: Scope, id: string, body: { applicability: Applicability; compliance_status: ComplianceStatus; note?: string | null; evidence_path?: string | null }) =>
  api<{ entry: Omit<LegalEntry, 'review'> }>(scope, `/api/environmental/legal/${id}/evaluate`, { method: 'POST', body })
export const reviewLegal = (scope: Scope, id: string) =>
  api<{ entry: Omit<LegalEntry, 'review'> }>(scope, `/api/environmental/legal/${id}/review`, { method: 'POST', body: {} })

// ── members (owner pickers) ─────────────────────────────────────────────────
export interface MemberOption { user_id: string; display_name: string; email: string | null }
export async function searchOwners(scope: Scope, q: string): Promise<MemberOption[]> {
  const { members } = await api<{ members: Array<{ user_id: string | null; display_name: string; email: string | null }> }>(
    scope, `/api/members/search?q=${encodeURIComponent(q)}&limit=20`)
  // Only people with a login can own a record: the owner is a reference to a user.
  return members.filter((m): m is MemberOption => !!m.user_id)
}
