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

  // This used to assert the opposite — that an uncatalogued path under a
  // catalogued module resolved to null, "so we don't render a broken link."
  // That rule is what emptied Recents: the catalogs name no `[id]` segment,
  // and the app has 128 of them, so every incident, chemical and piece of
  // equipment a user visited was dropped from the one surface meant to
  // remember them.
  //
  // The old test also mis-stated its own premise. Its comment called
  // /loto/equipment/abc "a real route"; there is no app/loto/equipment —
  // equipment lives at /equipment/[id]. The case it defended was a path that
  // does not exist.
  //
  // The trade-off is accepted deliberately: a path that 404s can now carry a
  // label instead of being dropped. Recents only ever holds paths the user
  // actually navigated to (AppChrome calls pushRecent with the live
  // pathname), so the cost is one stale row they can see and ignore — against
  // the benefit of every real detail page being remembered at all.
  it('resolves an uncatalogued path against its nearest catalogued ancestor', () => {
    const r = resolveHref('/loto/equipment/abc')
    expect(r).not.toBeNull()
    expect(r!.label).toContain('LOTO')
    expect(r!.href).toBe('/loto/equipment/abc')
  })

  it('still returns null when no ancestor is catalogued at all', () => {
    expect(resolveHref('/loto-not-a-module/abc')).toBeNull()
  })
})
