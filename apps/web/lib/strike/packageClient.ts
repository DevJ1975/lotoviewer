// Browser side of a STRIKE package import: turning whatever the operator
// dropped (a zip, a folder, or loose files) into named blobs, and pushing the
// media into strike-media. Runs only in the browser; the API routes never see
// the media bytes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { STRIKE_MEDIA_BUCKET } from '@/lib/strike/assets'
import {
  isStrikePackageDocument,
  readStrikePackage,
  type StrikePackageDocument,
  type StrikePackageInput,
  type StrikePackageReadResult,
  type StrikePackageUpload,
} from '@/lib/strike/package'

export interface PackageEntry {
  /** Basename; the folder it sat in is irrelevant once the package is read. */
  name: string
  blob: Blob
}

export interface LoadedPackage {
  /** What the import routes receive. */
  input: StrikePackageInput
  read: StrikePackageReadResult
  /** Bytes by basename, for the uploads the plan lists. */
  blobs: Map<string, Blob>
}

const ZIP_RE = /\.zip$/i
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db'])

/** Everything from one drop or picker selection, flattened to basenames. */
export async function collectDroppedEntries(items: DataTransferItemList | null, files: FileList | null): Promise<PackageEntry[]> {
  const entries: PackageEntry[] = []
  const fileSystemEntries = items ? [...items].map(item => item.webkitGetAsEntry?.() ?? null).filter((e): e is FileSystemEntry => e !== null) : []
  if (fileSystemEntries.length > 0) {
    for (const entry of fileSystemEntries) entries.push(...await readFileSystemEntry(entry))
  } else if (files) {
    for (const file of files) entries.push({ name: baseName(file.name), blob: file })
  }
  return expandZips(entries.filter(e => !IGNORED_NAMES.has(e.name)))
}

/** Parse the module documents and plan the import; nothing leaves the browser. */
export async function loadPackage(entries: PackageEntry[]): Promise<LoadedPackage> {
  const documents: StrikePackageDocument[] = []
  const blobs = new Map<string, Blob>()
  const files: StrikePackageInput['files'] = []
  for (const entry of entries) {
    if (isStrikePackageDocument(entry.name)) {
      documents.push({ name: entry.name, json: await readJson(entry) })
    } else {
      blobs.set(entry.name, entry.blob)
      files.push({ name: entry.name, size: entry.blob.size })
    }
  }
  const input: StrikePackageInput = { documents, files }
  return { input, read: readStrikePackage(input), blobs }
}

export interface UploadProgress {
  done: number
  total: number
  current: string
}

/**
 * Upload the plan's media as the signed-in superadmin. The strike-media write
 * policy allows superadmins under `global/`, so no server round trip is
 * needed per file. Upserts, so a re-import after a fix replaces the file.
 */
export async function uploadPackageMedia(
  client: SupabaseClient,
  uploads: StrikePackageUpload[],
  blobs: Map<string, Blob>,
  onProgress: (progress: UploadProgress) => void,
): Promise<void> {
  const bucket = client.storage.from(STRIKE_MEDIA_BUCKET)
  let done = 0
  for (const upload of uploads) {
    onProgress({ done, total: uploads.length, current: upload.name })
    const blob = blobs.get(upload.name)
    if (!blob) throw new Error(`${upload.name} vanished from the package before upload.`)
    const { error } = await bucket.upload(upload.bucketPath, blob, { contentType: upload.contentType, upsert: true })
    if (error) throw new Error(`${upload.name}: ${error.message}`)
    done += 1
  }
  onProgress({ done, total: uploads.length, current: '' })
}

async function readFileSystemEntry(entry: FileSystemEntry): Promise<PackageEntry[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    return [{ name: baseName(file.name), blob: file }]
  }
  if (!entry.isDirectory) return []
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const children: FileSystemEntry[] = []
  // readEntries returns in batches and signals the end with an empty batch.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    children.push(...batch)
  }
  const nested = await Promise.all(children.map(readFileSystemEntry))
  return nested.flat()
}

async function expandZips(entries: PackageEntry[]): Promise<PackageEntry[]> {
  const expanded: PackageEntry[] = []
  for (const entry of entries) {
    if (!ZIP_RE.test(entry.name)) {
      expanded.push(entry)
      continue
    }
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(entry.blob)
    for (const file of Object.values(zip.files)) {
      if (file.dir) continue
      const name = baseName(file.name)
      if (name.startsWith('.') || name.startsWith('__MACOSX') || IGNORED_NAMES.has(name)) continue
      expanded.push({ name, blob: await file.async('blob') })
    }
  }
  return expanded
}

async function readJson(entry: PackageEntry): Promise<unknown> {
  const text = await entry.blob.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${entry.name} is not valid JSON.`)
  }
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
