import AsyncStorage from '@react-native-async-storage/async-storage'

import { apiBase, authHeaders } from '@/lib/api'
import type { InspectionItemType, ResponseResult } from '@soteria/core/inspectionScoring'

// Mobile client for the inspection engine. Starting and submitting go through
// the web API because submit scores the run server-side, raises Hazard Hunt
// findings for failed items and drafts the AI write-up.

export interface InspectionSummary {
  id:           string
  title:        string
  template_id:  string
  status:       'in_progress' | 'submitted'
  result:       'pass' | 'fail' | null
  score:        number | null
  max_score:    number | null
  due_at:       string | null
  started_at:   string
  submitted_at: string | null
}

export interface InspectionTemplateSummary {
  id:       string
  name:     string
  category: string | null
}

export interface InspectionItem {
  id:        string
  section:   string | null
  item_type: InspectionItemType
  prompt:    string
  required:  boolean
}

export interface InspectionDetail {
  inspection: InspectionSummary
  items:      InspectionItem[]
}

export interface ItemDraft {
  result?: ResponseResult
  value?:  string
  note?:   string
}

export type DraftMap = Record<string, ItemDraft>

// Item types the phone can answer. Photo and signature items need the web
// run screen; they block submission when required (see submitBlockers).
const ANSWERABLE: ReadonlySet<InspectionItemType> = new Set(['pass_fail_na', 'multiple_choice', 'numeric', 'text'])

export function isAnswerable(type: InspectionItemType): boolean {
  return ANSWERABLE.has(type)
}

function isAnswered(item: InspectionItem, draft: ItemDraft | undefined): boolean {
  if (!draft) return false
  switch (item.item_type) {
    case 'pass_fail_na':
    case 'multiple_choice':
      return draft.result !== undefined
    case 'numeric':
      return draft.value !== undefined && draft.value.trim() !== '' && Number.isFinite(Number(draft.value))
    case 'text':
      return !!draft.value?.trim()
    default:
      return false
  }
}

// Reasons the run cannot be submitted yet. Empty means ready.
export function submitBlockers(items: readonly InspectionItem[], drafts: DraftMap): string[] {
  const blockers: string[] = []
  const unsupported = items.filter(i => i.required && !isAnswerable(i.item_type))
  if (unsupported.length > 0) {
    blockers.push(`${unsupported.length} required photo/signature item(s) must be completed in the web app.`)
  }
  const unanswered = items.filter(i => i.required && isAnswerable(i.item_type) && !isAnswered(i, drafts[i.id]))
  if (unanswered.length > 0) {
    blockers.push(`${unanswered.length} required item(s) still need an answer.`)
  }
  return blockers
}

async function call<T>(tenantId: string, path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method:  init?.method ?? 'GET',
    headers: await authHeaders(tenantId),
    body:    init ? JSON.stringify(init.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(res.status === 409 ? 'This inspection was already submitted.' : (body.error ?? `Request failed (${res.status})`))
  }
  return body as T
}

export function listInspections(tenantId: string) {
  return call<{ inspections: InspectionSummary[]; templates: InspectionTemplateSummary[] }>(tenantId, '/api/inspections')
}

export async function startInspection(tenantId: string, templateId: string): Promise<string> {
  const { id } = await call<{ id: string }>(tenantId, '/api/inspections', {
    method: 'POST',
    body:   { template_id: templateId },
  })
  return id
}

export async function loadInspection(tenantId: string, id: string): Promise<InspectionDetail> {
  const detail = await call<InspectionDetail>(tenantId, `/api/inspections/${id}`)
  return { inspection: detail.inspection, items: detail.items }
}

export function submitInspection(tenantId: string, id: string, items: readonly InspectionItem[], drafts: DraftMap) {
  const responses = items.map(item => {
    const draft = drafts[item.id] ?? {}
    const numeric = item.item_type === 'numeric' && draft.value?.trim() ? Number(draft.value) : null
    return {
      item_id: item.id,
      result:  draft.result ?? null,
      value:   numeric ?? draft.value ?? null,
      note:    draft.note ?? null,
    }
  })
  return call<{ score: { pct: number; result: 'pass' | 'fail' } }>(tenantId, `/api/inspections/${id}/submit`, {
    method: 'POST',
    body:   { responses },
  })
}

// Answers are kept on the device while a run is in progress so a dropped
// connection or a backgrounded app doesn't lose a walk-through.
function draftKey(tenantId: string, inspectionId: string): string {
  return `soteria.inspection.draft.v1.${tenantId}.${inspectionId}`
}

export async function loadDrafts(tenantId: string, inspectionId: string): Promise<DraftMap> {
  const raw = await AsyncStorage.getItem(draftKey(tenantId, inspectionId)).catch(() => null)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as DraftMap : {}
  } catch {
    return {}
  }
}

export function saveDrafts(tenantId: string, inspectionId: string, drafts: DraftMap): Promise<void> {
  return AsyncStorage.setItem(draftKey(tenantId, inspectionId), JSON.stringify(drafts))
}

export function clearDrafts(tenantId: string, inspectionId: string): Promise<void> {
  return AsyncStorage.removeItem(draftKey(tenantId, inspectionId))
}
