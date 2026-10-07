import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { ENVIRONMENTAL_DOCS_BUCKET, environmentalDocumentPath } from '@soteria/core/documentExtraction'
import { ENVIRONMENTAL_MODULE, forbidViewer } from '@/lib/environmental/documentApi'

// POST /api/environmental/documents/upload-url
//
// Mints a one-shot signed upload URL so the browser can send a PDF straight to
// storage (Vercel caps request bodies at 4.5 MB; scanned permits are bigger).
// The bucket grants browsers no access of their own: THIS route picks the
// object path (<tenant>/<new uuid>.pdf), so the client never chooses where a
// file lands and cannot write under another tenant's prefix.
//
// Returns { document_id, path, token } → the browser calls
//   supabase.storage.from('environmental-docs').uploadToSignedUrl(path, token, file)
// and then POSTs /api/environmental/documents to register the upload.

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const g = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })
  const denied = forbidViewer(g)
  if (denied) return denied
  if (!g.facilityId) {
    return NextResponse.json({ error: 'Choose a facility first: documents belong to one facility.' }, { status: 400 })
  }

  const documentId = crypto.randomUUID()
  const path = environmentalDocumentPath(g.tenantId, documentId)

  const { data, error } = await supabaseAdmin().storage.from(ENVIRONMENTAL_DOCS_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return sanitizeError(error ?? new Error('no signed upload URL'), 'environmental/documents/upload-url')

  return NextResponse.json({ document_id: documentId, path: data.path, token: data.token })
}
