import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { enqueueServiceJob } from '@/lib/serviceJobs'
import { ENVIRONMENTAL_DOCS_BUCKET, environmentalDocumentPath } from '@soteria/core/documentExtraction'
import {
  ENVIRONMENTAL_MODULE, LIST_COLUMNS, UUID_RE, bestEffort, forbidViewer,
} from '@/lib/environmental/documentApi'

// /api/environmental/documents
//
// GET  → the documents the caller can see (their RLS-scoped view: tenant, and
//        the active facility when one is selected), newest first.
// POST → register a PDF the browser has just uploaded (see ./upload-url), record
//        it as 'processing' and queue the service to read it. Nothing is filed:
//        the service stages a proposal that an admin approves.

export const runtime = 'nodejs'

const LIST_LIMIT = 100
// The service reads one scan at a time; a pile-up here only delays everyone's
// documents (and costs OCR time), so cap what one tenant can have waiting.
const MAX_PROCESSING_PER_TENANT = 20
const MAX_FILE_NAME_LENGTH = 255

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })

  const { data, error } = await g.authedClient
    .from('document_extractions').select(LIST_COLUMNS)
    .order('created_at', { ascending: false }).limit(LIST_LIMIT)
  if (error) return sanitizeError(error, 'environmental/documents/GET')
  return NextResponse.json({ documents: data ?? [] })
}

export async function POST(req: Request) {
  const g = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })
  const denied = forbidViewer(g)
  if (denied) return denied
  if (!g.facilityId) {
    return NextResponse.json({ error: 'Choose a facility first: documents belong to one facility.' }, { status: 400 })
  }

  let body: { document_id?: unknown; file_name?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 }) }

  const documentId = typeof body.document_id === 'string' ? body.document_id.toLowerCase() : ''
  const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : ''
  if (!UUID_RE.test(documentId)) return NextResponse.json({ error: 'Invalid document_id.' }, { status: 400 })
  if (!fileName || fileName.length > MAX_FILE_NAME_LENGTH) {
    return NextResponse.json({ error: `file_name must be 1–${MAX_FILE_NAME_LENGTH} characters.` }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const path = environmentalDocumentPath(g.tenantId, documentId)

  // The path is rebuilt here from the tenant and id, never taken from the client,
  // and the file must actually be there: registering a row for an upload that
  // never happened would leave a document that can never be read.
  const { data: listed, error: listErr } = await admin.storage
    .from(ENVIRONMENTAL_DOCS_BUCKET).list(g.tenantId, { search: `${documentId}.pdf`, limit: 1 })
  if (listErr) return sanitizeError(listErr, 'environmental/documents/POST')
  if (!listed?.some(o => o.name === `${documentId}.pdf`)) {
    return NextResponse.json({ error: 'The uploaded file was not found. Upload it again.' }, { status: 400 })
  }

  const { count, error: countErr } = await admin
    .from('document_extractions').select('id', { count: 'exact', head: true })
    .eq('tenant_id', g.tenantId).eq('status', 'processing')
  if (countErr) return sanitizeError(countErr, 'environmental/documents/POST')
  if ((count ?? 0) >= MAX_PROCESSING_PER_TENANT) {
    return NextResponse.json({ error: 'Too many documents are still being read. Try again in a few minutes.' }, { status: 429 })
  }

  const { error: insertErr } = await admin.from('document_extractions').insert({
    id: documentId, tenant_id: g.tenantId, facility_id: g.facilityId,
    storage_path: path, file_name: fileName, created_by: g.userId,
  })
  if (insertErr) return sanitizeError(insertErr, 'environmental/documents/POST')

  const job = await enqueueServiceJob({
    kind: 'document_extract', tenantId: g.tenantId, payload: { document_id: documentId },
    requestedBy: g.userId, dedupeKey: documentId,
  })
  if (!job) {
    // Nothing will ever read this row, so do not leave it "processing" forever:
    // remove it and the file, and let the user retry once the service is back.
    await bestEffort('row', admin.from('document_extractions').delete().eq('id', documentId).eq('tenant_id', g.tenantId))
    await bestEffort('file', admin.storage.from(ENVIRONMENTAL_DOCS_BUCKET).remove([path]))
    return NextResponse.json({ error: 'Document reading is not available right now. Try again later.' }, { status: 503 })
  }

  await bestEffort(
    'job-link',
    admin.from('document_extractions').update({ job_id: job.jobId }).eq('id', documentId).eq('tenant_id', g.tenantId),
  )
  return NextResponse.json({ document: { id: documentId, status: 'processing' } }, { status: 201 })
}
