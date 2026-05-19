import { describe, expect, it } from 'vitest'
import { resolveHref } from '@/lib/resolveHref'

describe('resolveHref', () => {
  it('resolves a top-level feature href to its name + icon', () => {
    const r = resolveHref('/loto')
    expect(r?.label).toBe('LOTO')
    expect(r?.source).toBe('feature')
    expect(r?.Icon).toBeDefined()
  })

  it('resolves a child feature href as "Parent / Child"', () => {
    // /status is the LOTO Status Report child.
    const r = resolveHref('/status')
    expect(r?.label).toBe('LOTO / Status Report')
    expect(r?.source).toBe('feature')
  })

  it('resolves an admin landing tile by /admin/<section>/<slug> (Phase B URL shape)', () => {
    // Post-Phase-B canonical URL. The legacy /admin/members 301s here
    // server-side before the client ever sees it, so the catalog only
    // needs to recognise the new shape.
    const r = resolveHref('/admin/people/members')
    expect(r?.label).toBe('Members')
    expect(r?.source).toBe('admin')
  })

  it('returns null for a legacy pre-Phase-B admin URL (caught by 301 server-side)', () => {
    // /admin/members no longer exists as a canonical route; the
    // catalog tile lives at /admin/people/members. A legacy entry
    // sitting in someone's localStorage recents falls through cleanly
    // — the drawer filters nulls out so we don't render a broken link.
    expect(resolveHref('/admin/members')).toBeNull()
  })

  it('returns null for an unrecognized path', () => {
    expect(resolveHref('/some-random-deep-path/123')).toBeNull()
  })

  it('returns null for an exact-path mismatch (no fuzzy prefix matching)', () => {
    // /loto/equipment/abc is a real route but not in the catalog; we
    // don't fuzzy-match to /loto.
    expect(resolveHref('/loto/equipment/abc')).toBeNull()
  })
})
