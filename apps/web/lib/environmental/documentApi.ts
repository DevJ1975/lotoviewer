import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { TenantModuleGate } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import type { DocumentStatus } from '@soteria/core/documentExtraction'

// Shared pieces of the /api/environmental/documents routes (the document reader,
// migration 296): who may do what, and how a document is found.

export const ENVIRONMENTAL_MODULE = 'environmental'
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DocumentGate = Extract<TenantModuleGate, { ok: true }>

export interface DocumentRow {
  id:                  string
  tenant_id:           string
  facility_id:         string
  storage_path:        string
  file_name:           string
  status:              DocumentStatus
  doc_type:            string | null
  doc_type_confidence: string | null
  overall_confidence:  string | null
  via_ocr:             boolean
  extraction:          unknown
  error:               string | null
  reviewed_fields:     unknown
  obligation_ids:      string[]
  reviewed_by:         string | null
  reviewed_at:         string | null
  created_at:          string
}

/** Everything the list needs; the (large) extraction is fetched per document. */
export const LIST_COLUMNS =
  'id, file_name, status, doc_type, doc_type_confidence, overall_confidence, via_ocr, error, reviewed_at, created_at'

export const DOCUMENT_COLUMNS =
  'id, tenant_id, facility_id, storage_path, file_name, status, doc_type, doc_type_confidence, overall_confidence, ' +
  'via_ocr, extraction, error, reviewed_fields, obligation_ids, reviewed_by, reviewed_at, created_at'

/** Uploading starts a (CPU-heavy) read, so a read-only viewer may not. */
export function forbidViewer(g: DocumentGate): NextResponse | null {
  return g.role === 'viewer'
    ? NextResponse.json({ error: 'Viewers cannot upload documents.' }, { status: 403 })
    : null
}

/** Approving files data into the compliance calendar, so it is an admin act. */
export function forbidNonReviewer(g: DocumentGate): NextResponse | null {
  return ['owner', 'admin', 'superadmin'].includes(g.role)
    ? null
    : NextResponse.json({ error: 'Only a tenant admin can approve or reject extracted documents.' }, { status: 403 })
}

/**
 * Find a document the caller may see. The read goes through the caller's own
 * RLS-scoped client (migration 296's policy), so tenant AND facility scoping
 * come from the database rather than being re-implemented here.
 */
export async function findDocument(
  g: DocumentGate, id: string, route: string,
): Promise<{ document: DocumentRow } | { response: NextResponse }> {
  if (!UUID_RE.test(id)) return { response: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) }

  const { data, error } = await g.authedClient
    .from('document_extractions').select(DOCUMENT_COLUMNS).eq('id', id).maybeSingle()
  if (error) return { response: sanitizeError(error, route) }
  if (!data) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { document: data as unknown as DocumentRow }
}

/** Best-effort cleanup that must never mask the error being reported. */
export async function bestEffort(label: string, work: PromiseLike<unknown>): Promise<void> {
  try {
    await work
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'environmental/documents', cleanup: label } })
  }
}
