import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ENVIRONMENTAL_MODULE, gateFailure, invalidInput, invalidJson, readJsonObject, text } from '@/lib/environmental/registerApi'
import { EVIDENCE_BUCKET, MAX_DIRECT_EVIDENCE_BYTES, isOwnPendingPath } from '@/lib/environmental/evidence'
import { evidenceFieldsFrom, evidenceSubjectFor } from '@/lib/environmental/evidenceSubjects'
import { fileEvidence } from '@/lib/environmental/fileEvidence'

// POST /api/environmental/evidence/uploads/finalize   File a direct upload:
//   { path, file_name, subject_type, subject_id, kind, export_controlled?,
//     supersedes_id?, superseded_reason? }
//
// The server reads the pending object back, decides its type from its bytes, hashes it and
// files it exactly as the multipart route does (fileEvidence). Only the uploader can
// finalize their own pending path, and the record is checked again here, because it may
// have been sealed while the file was uploading. The pending object is removed either way.

export const runtime = 'nodejs'
export const maxDuration = 60

const ROUTE = 'environmental/evidence/uploads/finalize/POST'

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const fields = evidenceFieldsFrom(name => body[name])
  const path = text(body.path)
  const fileName = text(body.file_name)
  const pathValid = isOwnPendingPath(path, gate.tenantId, gate.userId)
  if (!fields.ok || !pathValid || fileName.length === 0) {
    return invalidInput([
      ...(fields.ok ? [] : fields.errors),
      ...(pathValid ? [] : [{ field: 'path', message: 'must be the path of an upload you started' }]),
      ...(fileName.length > 0 ? [] : [{ field: 'fileName', message: 'is required' }]),
    ])
  }

  const admin = supabaseAdmin()
  const discardPending = async () => {
    const removed = await admin.storage.from(EVIDENCE_BUCKET).remove([path])
    if (removed.error) Sentry.captureException(removed.error, { level: 'warning', tags: { route: ROUTE, step: 'discard-pending' } })
  }

  const target = await evidenceSubjectFor(gate, fields.input, ROUTE)
  if (!target.ok) {
    await discardPending()
    return target.response
  }

  const pending = await admin.storage.from(EVIDENCE_BUCKET).download(path)
  if (pending.error || !pending.data) {
    return NextResponse.json({ error: 'The upload was not found. It may have expired; upload the file again.' }, { status: 404 })
  }
  const bytes = new Uint8Array(await pending.data.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DIRECT_EVIDENCE_BYTES) {
    await discardPending()
    return NextResponse.json({ error: 'Evidence files are limited to 25 MB.' }, { status: 413 })
  }

  try {
    return await fileEvidence({
      tenantId: gate.tenantId,
      userId:   gate.userId,
      ...fields.input,
      subject:  target.subject,
      fileName,
      bytes,
    }, ROUTE)
  } catch (error) {
    return sanitizeError(error, ROUTE)
  } finally {
    await discardPending()
  }
}
