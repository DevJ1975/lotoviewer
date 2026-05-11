const TENANT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_STORAGE_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const SUPPORTED_STORAGE_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm'])

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
  if (!path || path.startsWith('/') || path.includes('\\')) return false

  const segments = path.split('/')
  if (segments.length < 2 || segments.some(segment => !SAFE_STORAGE_SEGMENT_RE.test(segment))) return false
  if (segments.some(segment => segment === '.' || segment === '..')) return false

  const root = segments[0]
  if (root !== 'global' && !TENANT_UUID_RE.test(root)) return false

  const filenameParts = segments[segments.length - 1]?.split('.') ?? []
  const extension = filenameParts[filenameParts.length - 1]?.toLowerCase()
  return !!extension && SUPPORTED_STORAGE_EXTENSIONS.has(extension)
}
