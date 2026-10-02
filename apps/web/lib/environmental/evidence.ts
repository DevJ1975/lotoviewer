import { createHash } from 'node:crypto'
import { verifyJPEG, verifyPDF, verifyPNG, verifyWebP } from '@/lib/security/magicBytes'

// The evidence store (migration 299, plan D7): files that prove a
// compliance result. The server decides a file's type from its bytes,
// hashes it, and keeps it in a private bucket only the server can reach.

export const EVIDENCE_BUCKET = 'ms-evidence'

/**
 * The largest file the multipart upload route accepts. Vercel caps a request
 * body at 4.5 MB, so a file must fit under that with the multipart wrapping
 * around it. Anything larger goes straight to storage (MAX_DIRECT_EVIDENCE_BYTES).
 */
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024

/**
 * The largest file a direct-to-storage upload accepts: the bucket's own
 * limit (migration 299). Scanned permits run to tens of megabytes (Phase 2 Q2).
 */
export const MAX_DIRECT_EVIDENCE_BYTES = 25 * 1024 * 1024

/** Checked from content-length before the body is read, so an oversized request is never buffered. */
export const MAX_EVIDENCE_REQUEST_BYTES = 4_500_000

export const EVIDENCE_KINDS = ['photo', 'document', 'sample_result', 'signature'] as const
export type EvidenceKind = typeof EVIDENCE_KINDS[number]

/** What evidence can prove, today. The list grows one phase at a time, as the ms_evidence check does (299, then 306). */
export const EVIDENCE_SUBJECT_TYPES = [
  'compliance_evaluation',
  'environmental_permit',
  'ms_change_impact',
  'compliance_calendar_event',
  'compliance_obligation',
] as const
export type EvidenceSubjectType = typeof EVIDENCE_SUBJECT_TYPES[number]

/** Every ms_evidence column a client may see. The storage path stays on the server. */
export const EVIDENCE_PUBLIC_COLUMNS =
  'id, tenant_id, facility_id, subject_type, subject_id, kind, file_name, mime_type, file_size_bytes, sha256, '
  + 'uploaded_by, uploaded_at, superseded_by, superseded_at, superseded_reason, export_controlled'

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

/**
 * A name fit to show and to offer as a download: no path, no control
 * characters, at most 200 characters, and the extension of the type the
 * server detected, never the uploader's. A saved download is opened by its
 * extension, so a file that is really a PDF must not arrive as "report.hta".
 */
export function safeFileName(name: string, extension: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const stem = base.replace(UNSAFE_FILE_NAME_CHARACTERS, '_').replace(/\.[A-Za-z0-9]{1,10}$/, '').replace(/\.+$/, '').trim()
  const usable = stem.length > 0 && stem !== '.' && stem !== '..' ? stem : 'evidence'
  return `${usable.slice(-(199 - extension.length))}.${extension}`
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

// ── Direct-to-storage uploads (Phase 2 Q2) ────────────────────────────────
// The browser uploads a large file straight into the private bucket with a
// one-time signed URL, under a pending path that names its tenant and its
// uploader. The finalize route then reads it back, checks its type, hashes
// it and files it like any other evidence. Unfinalized uploads are swept
// nightly. The hash is still computed only by the server.

/** Where pending uploads wait. Outside every tenant's evidence prefix, so nothing filed ever lives here. */
export const PENDING_EVIDENCE_PREFIX = 'pending'

/** A pending upload's path: its tenant, then its uploader and a random id, so only they can finalize it. */
export function pendingEvidencePath(tenantId: string, userId: string, uploadId: string): string {
  return `${PENDING_EVIDENCE_PREFIX}/${tenantId}/${userId}--${uploadId}`
}

const UUID_PART = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** True when `path` is a pending upload this user started for this tenant. */
export function isOwnPendingPath(path: string, tenantId: string, userId: string): boolean {
  const pattern = new RegExp(`^${PENDING_EVIDENCE_PREFIX}/${tenantId}/${userId}--${UUID_PART}$`, 'i')
  return pattern.test(path)
}

/** How long an upload may wait unfinalized before the nightly sweep removes it. */
export const PENDING_EVIDENCE_TTL_HOURS = 24
