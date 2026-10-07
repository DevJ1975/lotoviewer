import { supabase } from '@/lib/supabase'

// Evidence (photos, permit PDFs) lives in the private environmental-evidence
// bucket. Members may upload under their own tenant's folder; only tenant admins
// may replace or delete (migration 301). The first path segment must be the tenant
// id, which is what the storage policies and the API's path checks both read.

export const EVIDENCE_BUCKET = 'environmental-evidence'
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024
export const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

/** A file name safe to put in a storage path: no folders, no odd characters, bounded length. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-').replace(/^\.+/, '')
  return (cleaned || 'file').slice(-80)
}

/** <tenant>/<folder>/<unique>-<name>. `folder` is a slash-free label such as "permits". */
export function buildEvidencePath(tenantId: string, folder: string, uniqueId: string, fileName: string): string {
  return `${tenantId}/${folder.replace(/[^\w-]/g, '')}/${uniqueId}-${safeFileName(fileName)}`
}

/** Why a file cannot be uploaded, or null when it can. Checked first so the person is told at once. */
export function evidenceProblem(file: { size: number; type: string }): string | null {
  if (!(EVIDENCE_TYPES as readonly string[]).includes(file.type)) return 'Upload a JPEG, PNG or WebP photo, or a PDF.'
  if (file.size > EVIDENCE_MAX_BYTES) return 'That file is larger than 25 MB.'
  if (file.size === 0) return 'That file is empty.'
  return null
}

/** Upload a file and return its storage path, the value the API stores and checks. */
export async function uploadEvidence(tenantId: string, folder: string, file: File): Promise<string> {
  const problem = evidenceProblem(file)
  if (problem) throw new Error(problem)
  const path = buildEvidencePath(tenantId, folder, crypto.randomUUID(), file.name)
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(`Could not upload the file: ${error.message}`)
  return path
}

/** A time-limited link to view a stored file; null if it cannot be signed (deleted, or not yours). */
export async function evidenceUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, seconds)
  return error ? null : data.signedUrl
}

/** A canvas drawing (a data URL) as a PNG file, ready to upload. */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [header, base64 = ''] = dataUrl.split(',')
  const type = /^data:([^;]+);base64$/.exec(header ?? '')?.[1] ?? 'image/png'
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return new File([bytes], fileName, { type })
}
