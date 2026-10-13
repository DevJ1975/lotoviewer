import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { FieldError } from '@soteria/core/hazardousWaste'
import { validateRetirementReason } from '@soteria/core/managementSystem'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ENVIRONMENTAL_MODULE, UUID_RE, gateFailure, invalidInput, text } from '@/lib/environmental/registerApi'
import {
  EVIDENCE_BUCKET,
  EVIDENCE_KINDS,
  EVIDENCE_PUBLIC_COLUMNS,
  EVIDENCE_SUBJECT_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_REQUEST_BYTES,
  detectEvidenceType,
  evidenceStoragePath,
  safeFileName,
  sha256Hex,
} from '@/lib/environmental/evidence'

// POST /api/environmental/evidence   Attach a file to an open compliance evaluation.
//   multipart/form-data: subject_type=compliance_evaluation, subject_id, kind, file;
//   optionally supersedes_id + superseded_reason to replace an earlier file on the same
//   evaluation (evidence is never deleted, only superseded).
//
// Tenant admins and the evaluation's assignee may attach. The server decides the file's
// type from its bytes, hashes it, stores it in the private ms-evidence bucket, and writes
// the ms_evidence row with the service role: no client can write that table (migration 299).

export const runtime = 'nodejs'

const ADMIN_ROLES = new Set(['owner', 'admin', 'superadmin'])

interface EvaluationRow { id: string; facility_id: string | null; assigned_to: string | null; completed_at: string | null }

const TOO_LARGE = 'Evidence files are limited to 4 MB. Compress the scan or photo and try again.'
const SEALED = 'This evaluation is complete; its evidence is sealed with it.'

/** Migration 299's trigger: the evaluation was completed while this upload was in flight. */
const isSealed = (error: { code?: string } | null) => error?.code === '23000'

/**
 * Remove a stored object only when no evidence row points at it. The path is
 * the content's hash, so the object may already back a filed row (a retry, or
 * an insert that committed before its reply was lost); evidence is never deleted.
 */
async function removeIfUnreferenced(admin: ReturnType<typeof supabaseAdmin>, storagePath: string): Promise<void> {
  const { data, error } = await admin.from('ms_evidence').select('id').eq('storage_path', storagePath).limit(1)
  if (error || (data ?? []).length > 0) {
    if (error) Sentry.captureException(error, { level: 'warning', tags: { route: 'environmental/evidence', step: 'cleanup-check' } })
    return
  }
  const removed = await admin.storage.from(EVIDENCE_BUCKET).remove([storagePath])
  if (removed.error) {
    Sentry.captureException(removed.error, { level: 'warning', tags: { route: 'environmental/evidence', step: 'cleanup' } })
  }
}

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

  const subjectType = text(form.get('subject_type'))
  const subjectId = text(form.get('subject_id'))
  const kind = text(form.get('kind'))
  const file = form.get('file')
  const supersedesId = text(form.get('supersedes_id'))
  const supersededReason = text(form.get('superseded_reason'))

  const errors: FieldError[] = []
  if (!(EVIDENCE_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    errors.push({ field: 'subjectType', message: `must be ${EVIDENCE_SUBJECT_TYPES.join(' or ')}` })
  }
  if (!UUID_RE.test(subjectId)) errors.push({ field: 'subjectId', message: 'must be an evaluation id' })
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    errors.push({ field: 'kind', message: `must be one of ${EVIDENCE_KINDS.join(', ')}` })
  }
  if (!(file instanceof File) || file.size === 0) errors.push({ field: 'file', message: 'is required' })
  if (supersedesId) {
    if (!UUID_RE.test(supersedesId)) errors.push({ field: 'supersedesId', message: 'must be an evidence id' })
    errors.push(...validateRetirementReason(supersededReason, 'supersededReason'))
  }
  if (errors.length > 0) return invalidInput(errors)
  const upload = file as File
  if (upload.size > MAX_EVIDENCE_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 413 })

  const { data: evaluation, error: evaluationError } = await gate.authedClient
    .from('ms_compliance_evaluations')
    .select('id, facility_id, assigned_to, completed_at')
    .eq('id', subjectId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (evaluationError) return sanitizeError(evaluationError, 'environmental/evidence/POST evaluation')
  if (!evaluation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const subject = evaluation as EvaluationRow
  if (subject.completed_at) return NextResponse.json({ error: SEALED }, { status: 409 })
  if (!ADMIN_ROLES.has(gate.role) && subject.assigned_to !== gate.userId) {
    return NextResponse.json({ error: 'Only an admin or the assigned evaluator can attach evidence.' }, { status: 403 })
  }

  const admin = supabaseAdmin()
  if (supersedesId) {
    const { data: earlier, error } = await admin
      .from('ms_evidence')
      .select('id, superseded_by')
      .eq('id', supersedesId)
      .eq('tenant_id', gate.tenantId)
      .eq('subject_type', subjectType)
      .eq('subject_id', subjectId)
      .maybeSingle()
    if (error) return sanitizeError(error, 'environmental/evidence/POST supersedes')
    if (!earlier) return invalidInput([{ field: 'supersedesId', message: 'is not evidence on this evaluation' }])
    if ((earlier as { superseded_by: string | null }).superseded_by) {
      return NextResponse.json({ error: 'That file has already been superseded.' }, { status: 409 })
    }
  }

  const bytes = new Uint8Array(await upload.arrayBuffer())
  const type = detectEvidenceType(bytes)
  if (!type) {
    return NextResponse.json({ error: 'Evidence must be a PDF, JPEG, PNG or WebP file.' }, { status: 415 })
  }
  const sha256 = sha256Hex(bytes)
  const storagePath = evidenceStoragePath(gate.tenantId, subjectType, subjectId, sha256, type.extension)

  const stored = await admin.storage.from(EVIDENCE_BUCKET).upload(storagePath, bytes, {
    contentType: type.mimeType,
    upsert: true,   // the path is the content's hash, so a rewrite stores identical bytes
  })
  if (stored.error) return sanitizeError(stored.error, 'environmental/evidence/POST upload')

  const { data: row, error: insertError } = await admin
    .from('ms_evidence')
    .insert({
      tenant_id:       gate.tenantId,
      facility_id:     subject.facility_id,
      subject_type:    subjectType,
      subject_id:      subjectId,
      kind,
      storage_path:    storagePath,
      file_name:       safeFileName(upload.name, type.extension),
      mime_type:       type.mimeType,
      file_size_bytes: bytes.byteLength,
      sha256,
      uploaded_by:     gate.userId,
    })
    .select(EVIDENCE_PUBLIC_COLUMNS)
    .single()
  if ((insertError as { code?: string } | null)?.code === '23505') {
    // The same bytes are already on this evaluation; the stored object is theirs, so it stays.
    return NextResponse.json({ error: 'This file is already attached to this evaluation.' }, { status: 409 })
  }
  if (insertError) {
    await removeIfUnreferenced(admin, storagePath)
    if (isSealed(insertError)) return NextResponse.json({ error: SEALED }, { status: 409 })
    return sanitizeError(insertError, 'environmental/evidence/POST insert')
  }
  const evidence = row as unknown as { id: string }

  if (supersedesId) {
    const { data: replaced, error } = await admin
      .from('ms_evidence')
      .update({ superseded_by: evidence.id, superseded_at: new Date().toISOString(), superseded_reason: supersededReason })
      .eq('id', supersedesId)
      .eq('tenant_id', gate.tenantId)
      .is('superseded_by', null)
      .select('id')
    if (isSealed(error)) return NextResponse.json({ error: SEALED, evidence: row }, { status: 409 })
    if (error) return sanitizeError(error, 'environmental/evidence/POST supersede')
    if ((replaced ?? []).length === 0) {
      // Someone else replaced it first. The new file is filed, but alongside it, not in its place.
      return NextResponse.json({
        error: 'Someone else replaced that file first. Yours is attached alongside it; replace one of them if it should go.',
        evidence: row,
      }, { status: 409 })
    }
  }

  return NextResponse.json({ evidence: row }, { status: 201 })
}
