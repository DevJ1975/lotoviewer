const TENANT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_STORAGE_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const SUPPORTED_STORAGE_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm'])
// Thumbnail extensions. AVIF/WebP first for size, JPEG/PNG accepted for
// authoring convenience. Animated GIFs are intentionally excluded —
// thumbnails should be still frames and animated images bloat the grid.
const SUPPORTED_THUMBNAIL_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif'])

export type StrikeVideoSource =
  | { kind: 'none' }
  | { kind: 'storage'; path: string }
  | { kind: 'unsupported'; reason: string }

export function resolveStrikeVideoSource(value: string | null | undefined): StrikeVideoSource {
  const input = value?.trim()
  if (!input) return { kind: 'none' }

  if (/^https?:\/\//i.test(input)) {
    return { kind: 'unsupported', reason: 'STRIKE videos must be uploaded to Supabase Storage.' }
  }
  if (isValidStrikeStorageVideoPath(input)) return { kind: 'storage', path: input }

  return { kind: 'unsupported', reason: 'Unsupported STRIKE video path.' }
}

export function isValidStrikeStorageVideoPath(path: string): boolean {
  return isValidStrikeStoragePath(path, SUPPORTED_STORAGE_EXTENSIONS)
}

export function isValidStrikeStorageThumbnailPath(path: string): boolean {
  return isValidStrikeStoragePath(path, SUPPORTED_THUMBNAIL_EXTENSIONS)
}

function isValidStrikeStoragePath(path: string, allowedExtensions: Set<string>): boolean {
  if (!path || path.startsWith('/') || path.includes('\\')) return false

  const segments = path.split('/')
  if (segments.length < 2 || segments.some(segment => !SAFE_STORAGE_SEGMENT_RE.test(segment))) return false
  if (segments.some(segment => segment === '.' || segment === '..')) return false

  const root = segments[0]
  if (root !== 'global' && !TENANT_UUID_RE.test(root)) return false

  const filenameParts = segments[segments.length - 1]?.split('.') ?? []
  const extension = filenameParts[filenameParts.length - 1]?.toLowerCase()
  return !!extension && allowedExtensions.has(extension)
}
