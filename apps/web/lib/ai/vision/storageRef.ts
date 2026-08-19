// Turns a stored photo reference into a storage bucket + key the service role
// can download. This is the sweep's security boundary.
//
// THE ATTACK THIS CLOSES
// Three of the four photo sources store a public URL in an unconstrained `text`
// column, and at least one of them (`bbs_observations_v2`) is written by a
// direct browser PostgREST insert — so the value is attacker-controlled by any
// authenticated member. A nightly service-role job doing `fetch(photo_url)` on
// that value is server-side request forgery with cloud-metadata reach:
// `http://169.254.169.254/…` in a `photo_url` column becomes a credential leak
// on a schedule. `lib/loto/audit/imageFetch.ts` does exactly that plain fetch
// today, with no host allowlist, size cap, or redirect limit, which is why the
// sweep does not reuse it.
//
// THE FIX
// The URL's HOST IS NEVER USED. It is treated purely as a container for a
// storage key: parse the path, require the Supabase public-object shape,
// require a bucket on a fixed allowlist, and require the key to sit under the
// owning tenant's prefix. The engine then downloads by key through the
// Supabase client, so the only host ever contacted is the project's own.
// Anything that does not fit is skipped and counted — never fetched.

/** Buckets the sweep is allowed to read. Nothing else is downloadable. */
const ALLOWED_BUCKETS = new Set(['loto-photos', 'incident-evidence'])

/** Supabase's public object route. The key is everything after the bucket. */
const PUBLIC_OBJECT_SEGMENT = '/storage/v1/object/public/'

export interface StorageRef {
  bucket: string
  key:    string
}

export type StorageRefRejection =
  | 'not_a_string'
  | 'unparseable'
  | 'not_a_storage_url'
  | 'bucket_not_allowed'
  | 'empty_key'
  | 'traversal'
  | 'outside_tenant'

export type StorageRefResult =
  | { ok: true;  ref: StorageRef }
  | { ok: false; reason: StorageRefRejection }

/**
 * Extracts a bucket + key from a stored public object URL.
 *
 * Deliberately ignores the URL's scheme, host, and port: only the path shape
 * matters, so a hostile host is not merely blocked but irrelevant. The query
 * string is dropped too — stored URLs are routinely cache-busted with `?v=…`
 * and that suffix is not part of the key.
 */
export function parsePublicObjectUrl(value: unknown): StorageRefResult {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'not_a_string' }

  let pathname: string
  try {
    // A base is supplied so a relative stored value still parses; the resulting
    // host is discarded either way.
    pathname = new URL(value, 'https://placeholder.invalid').pathname
  } catch {
    return { ok: false, reason: 'unparseable' }
  }

  const at = pathname.indexOf(PUBLIC_OBJECT_SEGMENT)
  if (at === -1) return { ok: false, reason: 'not_a_storage_url' }

  const remainder = pathname.slice(at + PUBLIC_OBJECT_SEGMENT.length)
  const slash = remainder.indexOf('/')
  if (slash <= 0) return { ok: false, reason: 'empty_key' }

  const bucket = decodeSegment(remainder.slice(0, slash))
  if (!ALLOWED_BUCKETS.has(bucket)) return { ok: false, reason: 'bucket_not_allowed' }

  const key = decodeSegment(remainder.slice(slash + 1))
  return validateKey(bucket, key)
}

/**
 * Wraps a key that is already stored as a path (`incident_attachments`), so
 * every source reaches the downloader through the same validation.
 */
export function parseStoragePath(bucket: string, value: unknown): StorageRefResult {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'not_a_string' }
  if (!ALLOWED_BUCKETS.has(bucket)) return { ok: false, reason: 'bucket_not_allowed' }
  return validateKey(bucket, value.replace(/^\/+/, ''))
}

function validateKey(bucket: string, key: string): StorageRefResult {
  if (key.length === 0) return { ok: false, reason: 'empty_key' }
  // `..` cannot escape a bucket through the Storage API, but a key containing
  // it is malformed and nothing legitimate produces one — rejecting keeps the
  // downloader's input to shapes the app actually writes.
  if (key.split('/').some(segment => segment === '..' || segment === '.')) {
    return { ok: false, reason: 'traversal' }
  }
  return { ok: true, ref: { bucket, key } }
}

/**
 * Confirms a key belongs to the tenant that owns the row referencing it.
 *
 * Every writer in the app prefixes storage keys with the tenant uuid
 * (`storagePaths.ts`; `incident_attachments` documents
 * `{tenant_id}/{incident_id}/{uuid}.{ext}`). Checking it here means a row whose
 * URL was edited to point at another tenant's object is skipped rather than
 * read — RLS protects the rows, not the bucket, and `loto-photos` is public.
 *
 * A key that predates tenant-prefixing fails this and is counted as skipped,
 * which is the correct trade: a visible gap in coverage beats a silent
 * cross-tenant read.
 */
export function isKeyWithinTenant(key: string, tenantId: string): boolean {
  return key.startsWith(`${tenantId}/`)
}

/** Applies the tenant check to a parsed ref. */
export function requireTenantScope(result: StorageRefResult, tenantId: string): StorageRefResult {
  if (!result.ok) return result
  return isKeyWithinTenant(result.ref.key, tenantId)
    ? result
    : { ok: false, reason: 'outside_tenant' }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    // A malformed escape is not a key the app wrote; leaving it undecoded lets
    // the checks below reject it rather than throwing here.
    return segment
  }
}
