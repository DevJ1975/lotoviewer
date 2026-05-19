import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRecents, loadRecents, pushRecent, RECENTS_EVENT, RECENTS_LIMIT } from '@/lib/recentRoutes'

describe('recentRoutes', () => {
  const tenant = 'tenant-123'

  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('starts empty for an unseen tenant', () => {
    expect(loadRecents(tenant)).toEqual([])
  })

  it('pushes the most recent visit to the head of the list', () => {
    pushRecent(tenant, '/loto')
    pushRecent(tenant, '/incidents')
    expect(loadRecents(tenant)).toEqual(['/incidents', '/loto'])
  })

  it('dedupes — revisiting moves the entry to the head, not duplicates it', () => {
    pushRecent(tenant, '/loto')
    pushRecent(tenant, '/incidents')
    pushRecent(tenant, '/loto')
    expect(loadRecents(tenant)).toEqual(['/loto', '/incidents'])
  })

  it(`caps at ${RECENTS_LIMIT} entries`, () => {
    for (let i = 0; i < RECENTS_LIMIT + 5; i++) {
      pushRecent(tenant, `/route-${i}`)
    }
    const recents = loadRecents(tenant)
    expect(recents).toHaveLength(RECENTS_LIMIT)
    // Most recent visit first.
    expect(recents[0]).toBe(`/route-${RECENTS_LIMIT + 4}`)
  })

  it('excludes the dashboard, login, and welcome paths', () => {
    pushRecent(tenant, '/')
    pushRecent(tenant, '/login')
    pushRecent(tenant, '/welcome')
    expect(loadRecents(tenant)).toEqual([])
  })

  it('excludes the bare /admin and /superadmin landings (covered by drawer footer)', () => {
    pushRecent(tenant, '/admin')
    pushRecent(tenant, '/superadmin')
    expect(loadRecents(tenant)).toEqual([])
  })

  it('keeps deeper admin paths', () => {
    pushRecent(tenant, '/admin/members')
    pushRecent(tenant, '/superadmin/identity-drift')
    expect(loadRecents(tenant)).toEqual(['/superadmin/identity-drift', '/admin/members'])
  })

  it('strips query strings and fragments and dedupes', () => {
    pushRecent(tenant, '/loto?from=qr')
    pushRecent(tenant, '/loto#detail')
    pushRecent(tenant, '/loto')
    expect(loadRecents(tenant)).toEqual(['/loto'])
  })

  it('strips trailing slashes on non-root paths', () => {
    pushRecent(tenant, '/loto/')
    expect(loadRecents(tenant)).toEqual(['/loto'])
  })

  it('rejects non-absolute hrefs', () => {
    pushRecent(tenant, 'loto')
    pushRecent(tenant, 'https://elsewhere.example/loto')
    expect(loadRecents(tenant)).toEqual([])
  })

  it('is per-tenant — recents do not bleed across tenants', () => {
    pushRecent(tenant, '/loto')
    pushRecent('tenant-other', '/incidents')
    expect(loadRecents(tenant)).toEqual(['/loto'])
    expect(loadRecents('tenant-other')).toEqual(['/incidents'])
  })

  it('dispatches an updated event so consumers can re-read', () => {
    const handler = vi.fn()
    window.addEventListener(RECENTS_EVENT, handler)
    pushRecent(tenant, '/loto')
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener(RECENTS_EVENT, handler)
  })

  it('clearRecents empties the list and fires the update event', () => {
    pushRecent(tenant, '/loto')
    const handler = vi.fn()
    window.addEventListener(RECENTS_EVENT, handler)
    clearRecents(tenant)
    expect(loadRecents(tenant)).toEqual([])
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener(RECENTS_EVENT, handler)
  })

  it('is a no-op when tenantId is null/undefined/empty', () => {
    pushRecent(null, '/loto')
    pushRecent(undefined, '/loto')
    pushRecent('', '/loto')
    expect(loadRecents(null)).toEqual([])
    expect(loadRecents(undefined)).toEqual([])
  })
})
