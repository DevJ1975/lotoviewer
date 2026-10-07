import { supabase } from '@/lib/supabase'
import {
  ENVIRONMENTAL_DOCS_BUCKET,
  type DocumentStatus,
  type ReviewedField,
} from '@soteria/core/documentExtraction'

// Browser client for the /api/environmental/documents family: a bearer token
// plus the active tenant and facility on every call, and a readJson that
// surfaces the API's error message (as lib/fleet/client.ts does).

export interface DocumentScope { tenantId: string; facilityId: string | null }

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export interface DocumentListRow {
  id: string; file_name: string; status: DocumentStatus
  doc_type: string | null; doc_type_confidence: string | null; overall_confidence: string | null
  via_ocr: boolean; error: string | null; reviewed_at: string | null; created_at: string
}

export interface DocumentDetail extends DocumentListRow {
  extraction: unknown
  reviewed_fields: ReviewedField[]
  obligation_ids: string[]
}

async function headers(scope: DocumentScope, json = false): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const h: Record<string, string> = { 'x-active-tenant': scope.tenantId }
  if (scope.facilityId) h['x-active-facility'] = scope.facilityId
  if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
  if (json) h['content-type'] = 'application/json'
  return h
}

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
  return json as T
}

export async function listDocuments(scope: DocumentScope): Promise<DocumentListRow[]> {
  const res = await fetch('/api/environmental/documents', { headers: await headers(scope) })
  return (await readJson<{ documents: DocumentListRow[] }>(res)).documents
}

export async function getDocument(scope: DocumentScope, id: string): Promise<DocumentDetail> {
  const res = await fetch(`/api/environmental/documents/${id}`, { headers: await headers(scope) })
  return (await readJson<{ document: DocumentDetail }>(res)).document
}

export async function getDocumentUrl(scope: DocumentScope, id: string): Promise<string> {
  const res = await fetch(`/api/environmental/documents/${id}/url`, { headers: await headers(scope) })
  return (await readJson<{ url: string }>(res)).url
}

/** Why a file cannot be a document, or null. Checked here so the user hears it before an upload. */
export async function checkPdf(file: File): Promise<string | null> {
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_UPLOAD_BYTES) return 'That file is larger than 25 MB.'
  const magic = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer())
  return magic === '%PDF-' ? null : 'Only PDF files can be read.'
}

/**
 * Upload a PDF and queue it to be read. The server picks the storage path and
 * checks the file arrived; the browser only holds a one-shot token for it.
 */
export async function uploadDocument(scope: DocumentScope, file: File): Promise<{ id: string }> {
  const minted = await readJson<{ document_id: string; path: string; token: string }>(
    await fetch('/api/environmental/documents/upload-url', { method: 'POST', headers: await headers(scope, true), body: '{}' }),
  )

  const { error } = await supabase.storage
    .from(ENVIRONMENTAL_DOCS_BUCKET)
    .uploadToSignedUrl(minted.path, minted.token, file, { contentType: 'application/pdf' })
  if (error) throw new Error(`Upload failed: ${error.message}`)

  const registered = await readJson<{ document: { id: string } }>(
    await fetch('/api/environmental/documents', {
      method: 'POST', headers: await headers(scope, true),
      body: JSON.stringify({ document_id: minted.document_id, file_name: file.name }),
    }),
  )
  return registered.document
}

export async function approveDocument(
  scope: DocumentScope, id: string,
  body: { accepted: Array<{ index: number; value: string }>; create_obligations: boolean },
): Promise<{ obligation_ids: string[] }> {
  const res = await fetch(`/api/environmental/documents/${id}/approve`, {
    method: 'POST', headers: await headers(scope, true), body: JSON.stringify(body),
  })
  return readJson<{ obligation_ids: string[] }>(res)
}

export async function rejectDocument(scope: DocumentScope, id: string): Promise<void> {
  const res = await fetch(`/api/environmental/documents/${id}/reject`, {
    method: 'POST', headers: await headers(scope, true), body: '{}',
  })
  await readJson(res)
}
