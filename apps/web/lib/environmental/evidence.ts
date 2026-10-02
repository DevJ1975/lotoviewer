import { createHash } from 'node:crypto'
import { verifyJPEG, verifyPDF, verifyPNG, verifyWebP } from '@/lib/security/magicBytes'

// The evidence store (migration 299, plan D7): files that prove a
// compliance result. The server decides a file's type from its bytes,
// hashes it, and keeps it in a private bucket only the server can reach.

export const EVIDENCE_BUCKET = 'ms-evidence'

/** The bucket's own limit (migration 299): 25 MiB. */
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024

export const EVIDENCE_KINDS = ['photo', 'document', 'sample_result', 'signature'] as const
export type EvidenceKind = typeof EVIDENCE_KINDS[number]

/** What evidence can prove, today. The list grows one phase at a time, as migration 299's check does. */
export const EVIDENCE_SUBJECT_TYPES = ['compliance_evaluation'] as const

/** Every ms_evidence column a client may see. The storage path stays on the server. */
export const EVIDENCE_PUBLIC_COLUMNS =
  'id, tenant_id, facility_id, subject_type, subject_id, kind, file_name, mime_type, file_size_bytes, sha256, '
  + 'uploaded_by, uploaded_at, superseded_by, superseded_at, superseded_reason'

interface EvidenceType { mimeType: string; extension: string }

// Open question Q2: PDF, JPEG, PNG and WebP, each recognisable by its magic bytes.
const RECOGNISED: { verify: (bytes: Uint8Array) => boolean; type: EvidenceType }[] = [
  { verify: verifyPDF,  type: { mimeType: 'application/pdf', extension: 'pdf' } },
  { verify: verifyJPEG, type: { mimeType: 'image/jpeg',      extension: 'jpg' } },
  { verify: verifyPNG,  type: { mimeType: 'image/png',       extension: 'png' } },
  { verify: verifyWebP, type: { mimeType: 'image/webp',      extension: 'webp' } },
]

/** The file's real type from its leading bytes, or null when it is not an accepted kind of file. The declared type is never trusted. */
export function detectEvidenceType(bytes: Uint8Array): EvidenceType | null {
  return RECOGNISED.find(candidate => candidate.verify(bytes))?.type ?? null
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const UNSAFE_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g

/** A name fit to show and to offer as a download: no path, no control characters, at most 200 characters. */
export function safeFileName(name: string, fallbackExtension: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const cleaned = base.replace(UNSAFE_FILE_NAME_CHARACTERS, '_').trim().slice(-200)
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : `evidence.${fallbackExtension}`
}

/**
 * Where a file lives in the bucket: under its tenant's prefix (migration
 * 299 checks this), then its subject, then its own hash. Addressing by
 * hash means a retried upload rewrites identical bytes, never different ones.
 */
export function evidenceStoragePath(
  tenantId: string, subjectType: string, subjectId: string, sha256: string, extension: string,
): string {
  return `${tenantId}/${subjectType}/${subjectId}/${sha256}.${extension}`
}
