import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ENVIRONMENTAL_MODULE, gateFailure, invalidInput, invalidJson, readJsonObject } from '@/lib/environmental/registerApi'
import { EVIDENCE_BUCKET, MAX_DIRECT_EVIDENCE_BYTES, pendingEvidencePath } from '@/lib/environmental/evidence'
import { evidenceFieldsFrom, evidenceSubjectFor } from '@/lib/environmental/evidenceSubjects'

// POST /api/environmental/evidence/uploads   Start a direct-to-storage upload of a file too
//   large for a request body (Phase 2 Q2): { subject_type, subject_id, kind, file_size,
//   export_controlled? }. Answers { path, token } for a one-time signed upload into a pending
//   folder of the private bucket that names this tenant and this uploader; the browser then
//   calls supabase.storage.from('ms-evidence').uploadToSignedUrl(path, token, file), and
//   finishes with POST /api/environmental/evidence/uploads/finalize.
//
// The same people may start one as may attach to the record, and the record is checked
// again at finalize. Nothing is filed until then; an upload never finalized is swept nightly.

export const runtime = 'nodejs'

const ROUTE = 'environmental/evidence/uploads/POST'

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const fields = evidenceFieldsFrom(name => body[name])
  const size = body.file_size
  const sizeValid = typeof size === 'number' && Number.isInteger(size) && size > 0 && size <= MAX_DIRECT_EVIDENCE_BYTES
  if (!fields.ok || !sizeValid) {
    return invalidInput([
      ...(fields.ok ? [] : fields.errors),
      ...(sizeValid ? [] : [{ field: 'fileSize', message: 'must be the file\'s size in bytes, at most 25 MB' }]),
    ])
  }

  const target = await evidenceSubjectFor(gate, fields.input, ROUTE)
  if (!target.ok) return target.response

  const path = pendingEvidencePath(gate.tenantId, gate.userId, crypto.randomUUID())
  const { data, error } = await supabaseAdmin().storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return sanitizeError(error ?? new Error('no signed upload URL'), `${ROUTE} sign`)
  return NextResponse.json({ path: data.path, token: data.token }, { status: 201 })
}
