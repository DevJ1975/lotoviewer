import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { ENVIRONMENTAL_MODULE, gateFailure, invalidInput } from '@/lib/environmental/registerApi'
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_REQUEST_BYTES } from '@/lib/environmental/evidence'
import { evidenceFieldsFrom, evidenceSubjectFor } from '@/lib/environmental/evidenceSubjects'
import { fileEvidence } from '@/lib/environmental/fileEvidence'

// POST /api/environmental/evidence   Attach a file of up to 4 MB to a record.
//   multipart/form-data: subject_type, subject_id, kind, file; optionally
//   export_controlled=true, and supersedes_id + superseded_reason to replace an earlier
//   file on the same record (evidence is never deleted, only superseded).
//   Larger files go straight to storage: /api/environmental/evidence/uploads.
//
// Subjects (Phase 2 plan D15): a compliance evaluation, a permit's documents, a change
// impact's evidence, proof a condition was done (an occurrence), or an obligation's rule
// text. Admins may attach to any of them; an evaluation's assignee and a condition's owner
// may attach to theirs. A sealed record (a completed evaluation, a retired permit, a
// resolved impact) takes no more.

export const runtime = 'nodejs'

const ROUTE = 'environmental/evidence/POST'
const TOO_LARGE = 'Files sent this way are limited to 4 MB. Larger files upload straight to storage; try again.'

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const declaredLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EVIDENCE_REQUEST_BYTES) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 })
  }

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Send the file as multipart/form-data' }, { status: 400 }) }

  const fields = evidenceFieldsFrom(name => form.get(name))
  const file = form.get('file')
  const fileMissing = !(file instanceof File) || file.size === 0
  if (!fields.ok || fileMissing) {
    return invalidInput([
      ...(fields.ok ? [] : fields.errors),
      ...(fileMissing ? [{ field: 'file', message: 'is required' }] : []),
    ])
  }
  const upload = file as File
  if (upload.size > MAX_EVIDENCE_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 413 })

  const target = await evidenceSubjectFor(gate, fields.input, ROUTE)
  if (!target.ok) return target.response

  return fileEvidence({
    tenantId:         gate.tenantId,
    userId:           gate.userId,
    ...fields.input,
    subject:          target.subject,
    fileName:         upload.name,
    bytes:            new Uint8Array(await upload.arrayBuffer()),
  }, ROUTE)
}
