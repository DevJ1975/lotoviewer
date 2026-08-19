import { describe, it, expect } from 'vitest'
import {
  isKeyWithinTenant,
  parsePublicObjectUrl,
  parseStoragePath,
  requireTenantScope,
} from '@/lib/ai/vision/storageRef'

// This module is the sweep's security boundary. `bbs_observations_v2.photo_url`
// is an unconstrained text column written by a direct browser insert, so its
// value is attacker-controlled by any authenticated member. If the sweep ever
// fetched it, a nightly service-role job would be a scheduled SSRF.
//
// The contract these tests hold: a stored URL is only ever a container for a
// storage key. The host is never used, so a hostile host is irrelevant rather
// than merely blocked.

const TENANT = '11111111-1111-1111-1111-111111111111'
const publicUrl = (bucket: string, key: string, host = 'https://proj.supabase.co') =>
  `${host}/storage/v1/object/public/${bucket}/${key}`

const reasonOf = (r: ReturnType<typeof parsePublicObjectUrl>) => (r.ok ? null : r.reason)

describe('parsePublicObjectUrl — the happy path', () => {
  it('extracts bucket and key from a Supabase public object URL', () => {
    const result = parsePublicObjectUrl(publicUrl('loto-photos', `${TENANT}/hot-work/P-1/123.jpg`))
    expect(result).toEqual({ ok: true, ref: { bucket: 'loto-photos', key: `${TENANT}/hot-work/P-1/123.jpg` } })
  })

  it('drops the cache-busting query string', () => {
    // Stored URLs are routinely suffixed with ?v=… ; that is not part of the key.
    const result = parsePublicObjectUrl(publicUrl('loto-photos', `${TENANT}/a.jpg`) + '?v=1699999')
    expect(result.ok && result.ref.key).toBe(`${TENANT}/a.jpg`)
  })

  it('decodes percent-escaped key segments', () => {
    const result = parsePublicObjectUrl(publicUrl('loto-photos', `${TENANT}/hot%20work/a.jpg`))
    expect(result.ok && result.ref.key).toBe(`${TENANT}/hot work/a.jpg`)
  })
})

describe('parsePublicObjectUrl — the host is never used', () => {
  it('accepts the key regardless of which host the URL names', () => {
    // The point of the design: the sweep downloads by key through the Supabase
    // client, so the host in the stored string never reaches a network call.
    // Whatever host an attacker writes is simply discarded.
    const evil = parsePublicObjectUrl(
      publicUrl('loto-photos', `${TENANT}/a.jpg`, 'http://169.254.169.254'),
    )
    expect(evil).toEqual({ ok: true, ref: { bucket: 'loto-photos', key: `${TENANT}/a.jpg` } })
  })

  it('rejects a metadata URL that carries no storage path', () => {
    expect(reasonOf(parsePublicObjectUrl('http://169.254.169.254/latest/meta-data/iam/'))).toBe('not_a_storage_url')
  })

  it('rejects other schemes that carry no storage path', () => {
    expect(reasonOf(parsePublicObjectUrl('file:///etc/passwd'))).toBe('not_a_storage_url')
    expect(reasonOf(parsePublicObjectUrl('gopher://internal:70/'))).toBe('not_a_storage_url')
    expect(reasonOf(parsePublicObjectUrl('http://localhost:6379/'))).toBe('not_a_storage_url')
  })
})

describe('parsePublicObjectUrl — rejections', () => {
  it('rejects a bucket outside the allowlist', () => {
    // tenant-logos and profile-pictures are real buckets the sweep must not read.
    expect(reasonOf(parsePublicObjectUrl(publicUrl('profile-pictures', `${TENANT}/me.jpg`)))).toBe('bucket_not_allowed')
    expect(reasonOf(parsePublicObjectUrl(publicUrl('tenant-logos', `${TENANT}/logo.png`)))).toBe('bucket_not_allowed')
  })

  it('rejects a signed or authenticated object route', () => {
    // Only the public-object shape is recognized; anything else is not a key
    // this code knows how to validate.
    expect(reasonOf(parsePublicObjectUrl(
      `https://proj.supabase.co/storage/v1/object/sign/loto-photos/${TENANT}/a.jpg`,
    ))).toBe('not_a_storage_url')
  })

  it('rejects a bucket with no key after it', () => {
    expect(reasonOf(parsePublicObjectUrl('https://proj.supabase.co/storage/v1/object/public/loto-photos/'))).toBe('empty_key')
    expect(reasonOf(parsePublicObjectUrl('https://proj.supabase.co/storage/v1/object/public/loto-photos'))).toBe('empty_key')
  })

  // Traversal reaches the two entry points differently, and the two defence
  // layers are not interchangeable. The URL parser resolves `..` — in literal,
  // percent-encoded, and upper-case-encoded form — before this module sees the
  // path, so a traversing URL never trips the segment check; it silently walks
  // the key OUT of the tenant prefix, which is what the tenant check catches.
  // parseStoragePath does no URL parsing, so there the segment check is the
  // only thing standing there. Both are pinned so neither can be removed on the
  // assumption that the other covers it.
  it.each([
    ['literal',        `${TENANT}/../other-tenant/a.jpg`, 'other-tenant/a.jpg'],
    ['percent-encoded', `${TENANT}/%2e%2e/x/a.jpg`,       'x/a.jpg'],
    ['upper-case-encoded', `${TENANT}/%2E%2E/x/a.jpg`,    'x/a.jpg'],
  ])('normalizes %s traversal out of the tenant prefix, where the tenant check rejects it', (_form, key, normalized) => {
    const escaped = parsePublicObjectUrl(publicUrl('loto-photos', key))
    expect(escaped.ok && escaped.ref.key).toBe(normalized)
    expect(reasonOf(requireTenantScope(escaped, TENANT))).toBe('outside_tenant')
  })

  it('rejects non-string and empty values', () => {
    expect(reasonOf(parsePublicObjectUrl(null))).toBe('not_a_string')
    expect(reasonOf(parsePublicObjectUrl(''))).toBe('not_a_string')
    expect(reasonOf(parsePublicObjectUrl(42))).toBe('not_a_string')
  })
})

describe('parseStoragePath', () => {
  it('accepts a stored path, which incident_attachments already provides', () => {
    const result = parseStoragePath('incident-evidence', `${TENANT}/inc-1/photo.jpg`)
    expect(result).toEqual({ ok: true, ref: { bucket: 'incident-evidence', key: `${TENANT}/inc-1/photo.jpg` } })
  })

  it('normalizes a leading slash', () => {
    const result = parseStoragePath('incident-evidence', `/${TENANT}/a.jpg`)
    expect(result.ok && result.ref.key).toBe(`${TENANT}/a.jpg`)
  })

  it('applies the same bucket allowlist and traversal rules', () => {
    expect(reasonOf(parseStoragePath('tenant-logos', `${TENANT}/a.png`))).toBe('bucket_not_allowed')
    expect(reasonOf(parseStoragePath('incident-evidence', `${TENANT}/../a.jpg`))).toBe('traversal')
  })
})

describe('tenant scoping', () => {
  const OTHER = '22222222-2222-2222-2222-222222222222'

  it('accepts a key under the owning tenant prefix', () => {
    expect(isKeyWithinTenant(`${TENANT}/a.jpg`, TENANT)).toBe(true)
  })

  it('rejects a key belonging to another tenant', () => {
    // loto-photos is a public bucket: RLS protects the rows, not the objects.
    // A row whose URL was edited to point at another tenant's object must be
    // skipped, not read.
    expect(isKeyWithinTenant(`${OTHER}/a.jpg`, TENANT)).toBe(false)
  })

  it('rejects a prefix-collision attempt', () => {
    expect(isKeyWithinTenant(`${TENANT}-evil/a.jpg`, TENANT)).toBe(false)
  })

  it('rejects an unprefixed legacy key rather than reading it', () => {
    // A visible gap in coverage beats a silent cross-tenant read.
    expect(isKeyWithinTenant('legacy/a.jpg', TENANT)).toBe(false)
  })

  it('requireTenantScope turns a cross-tenant key into a rejection', () => {
    const crossTenant = parsePublicObjectUrl(publicUrl('loto-photos', `${OTHER}/a.jpg`))
    expect(reasonOf(requireTenantScope(crossTenant, TENANT))).toBe('outside_tenant')
  })

  it('requireTenantScope passes through an existing rejection unchanged', () => {
    const bad = parsePublicObjectUrl('http://169.254.169.254/latest/')
    expect(reasonOf(requireTenantScope(bad, TENANT))).toBe('not_a_storage_url')
  })

  it('requireTenantScope keeps a valid in-tenant ref', () => {
    const good = parsePublicObjectUrl(publicUrl('loto-photos', `${TENANT}/a.jpg`))
    expect(requireTenantScope(good, TENANT).ok).toBe(true)
  })
})
