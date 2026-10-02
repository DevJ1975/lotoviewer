import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { invalidInput } from './registerApi'
import {
  EVIDENCE_BUCKET,
  EVIDENCE_PUBLIC_COLUMNS,
  detectEvidenceType,
  evidenceStoragePath,
  safeFileName,
  sha256Hex,
  type EvidenceKind,
  type EvidenceSubjectType,
} from './evidence'
import type { EvidenceSubject } from './evidenceSubjects'

// Filing one piece of evidence, the same way whichever route the bytes came
// through: the multipart upload, or a direct-to-storage upload's finalize.
// The server decides the type from the bytes, hashes them, stores them under
// the hash in the private bucket, and writes the row with the service role:
// no client can write ms_evidence (migration 299).

export interface EvidenceFiling {
  tenantId:         string
  userId:           string
  subjectType:      EvidenceSubjectType
  subjectId:        string
  subject:          EvidenceSubject
  kind:             EvidenceKind
  /** The name the uploader gave the file; only its stem is kept. */
  fileName:         string
  bytes:            Uint8Array
  /** Export-controlled files download only for owners and admins (Phase 2 Q3). */
  exportControlled: boolean
  /** An earlier file on the same subject this one replaces; evidence is never deleted. */
  supersedes:       { id: string; reason: string } | null
}

/** Migration 306's trigger: the subject was sealed while this upload was in flight. */
const isSealed = (error: { code?: string } | null) => error?.code === '23000'

/**
 * Remove a stored object only when no evidence row points at it. The path is
 * the content's hash, so the object may already back a filed row (a retry, or
 * an insert that committed before its reply was lost); evidence is never deleted.
 */
async function removeIfUnreferenced(admin: ReturnType<typeof supabaseAdmin>, storagePath: string, route: string): Promise<void> {
  const { data, error } = await admin.from('ms_evidence').select('id').eq('storage_path', storagePath).limit(1)
  if (error || (data ?? []).length > 0) {
    if (error) Sentry.captureException(error, { level: 'warning', tags: { route, step: 'cleanup-check' } })
    return
  }
  const removed = await admin.storage.from(EVIDENCE_BUCKET).remove([storagePath])
  if (removed.error) Sentry.captureException(removed.error, { level: 'warning', tags: { route, step: 'cleanup' } })
}

/** File the evidence and answer as the upload routes do: 201 with the row, or why not. */
export async function fileEvidence(filing: EvidenceFiling, route: string): Promise<NextResponse> {
  const { tenantId, subjectType, subjectId, subject } = filing
  const admin = supabaseAdmin()

  // A replacement of an export-controlled file is export-controlled too: replacing must never be a way to release it.
  let exportControlled = filing.exportControlled
  if (filing.supersedes) {
    const { data: earlier, error } = await admin
      .from('ms_evidence')
      .select('id, superseded_by, export_controlled')
      .eq('id', filing.supersedes.id)
      .eq('tenant_id', tenantId)
      .eq('subject_type', subjectType)
      .eq('subject_id', subjectId)
      .maybeSingle()
    if (error) return sanitizeError(error, `${route} supersedes`)
    if (!earlier) return invalidInput([{ field: 'supersedesId', message: 'is not evidence on this record' }])
    if ((earlier as { superseded_by: string | null }).superseded_by) {
      return NextResponse.json({ error: 'That file has already been superseded.' }, { status: 409 })
    }
    exportControlled ||= (earlier as { export_controlled: boolean }).export_controlled === true
  }

  const type = detectEvidenceType(filing.bytes)
  if (!type) return NextResponse.json({ error: 'Evidence must be a PDF, JPEG, PNG or WebP file.' }, { status: 415 })
  const sha256 = sha256Hex(filing.bytes)
  const storagePath = evidenceStoragePath(tenantId, subjectType, subjectId, sha256, type.extension)

  const stored = await admin.storage.from(EVIDENCE_BUCKET).upload(storagePath, filing.bytes, {
    contentType: type.mimeType,
    upsert: true,   // the path is the content's hash, so a rewrite stores identical bytes
  })
  if (stored.error) return sanitizeError(stored.error, `${route} upload`)

  const { data: row, error: insertError } = await admin
    .from('ms_evidence')
    .insert({
      tenant_id:         tenantId,
      facility_id:       subject.facilityId,
      subject_type:      subjectType,
      subject_id:        subjectId,
      kind:              filing.kind,
      storage_path:      storagePath,
      file_name:         safeFileName(filing.fileName, type.extension),
      mime_type:         type.mimeType,
      file_size_bytes:   filing.bytes.byteLength,
      sha256,
      uploaded_by:       filing.userId,
      export_controlled: exportControlled,
    })
    .select(EVIDENCE_PUBLIC_COLUMNS)
    .single()
  if ((insertError as { code?: string } | null)?.code === '23505') {
    // The same bytes are already on this record; the stored object is theirs, so it stays.
    return NextResponse.json({ error: 'This file is already attached here.' }, { status: 409 })
  }
  if (insertError) {
    await removeIfUnreferenced(admin, storagePath, route)
    if (isSealed(insertError)) return NextResponse.json({ error: subject.sealedReason }, { status: 409 })
    return sanitizeError(insertError, `${route} insert`)
  }
  const evidence = row as unknown as { id: string }

  if (filing.supersedes) {
    const { data: replaced, error } = await admin
      .from('ms_evidence')
      .update({ superseded_by: evidence.id, superseded_at: new Date().toISOString(), superseded_reason: filing.supersedes.reason })
      .eq('id', filing.supersedes.id)
      .eq('tenant_id', tenantId)
      .is('superseded_by', null)
      .select('id')
    if (isSealed(error)) return NextResponse.json({ error: subject.sealedReason, evidence: row }, { status: 409 })
    if (error) return sanitizeError(error, `${route} supersede`)
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
