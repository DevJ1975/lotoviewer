import { describe, expect, it } from 'vitest'
import { ADMIN_SECTIONS, SETTINGS_NOTIFICATIONS_TILE, getAdminRedirects, getAllAdminTiles, getAdminTile } from '@/lib/adminCatalog'

describe('adminCatalog', () => {
  it('has at least one section and at least one tile per section', () => {
    expect(ADMIN_SECTIONS.length).toBeGreaterThan(0)
    for (const section of ADMIN_SECTIONS) {
      expect(section.tiles.length, `section ${section.id} must have tiles`).toBeGreaterThan(0)
    }
  })

  it('uses unique slugs across every section', () => {
    const slugs = getAllAdminTiles().map(t => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('uses unique hrefs across every section', () => {
    const hrefs = getAllAdminTiles().map(t => t.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('uses unique section ids', () => {
    const ids = ADMIN_SECTIONS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points every admin tile at /admin/<section>/<slug> (Phase B URL shape)', () => {
    for (const section of ADMIN_SECTIONS) {
      for (const tile of section.tiles) {
        expect(tile.href, `tile ${tile.slug} href mismatch`).toBe(`/admin/${section.urlSegment}/${tile.slug}`)
      }
    }
  })

  it('every section uses a non-empty url segment', () => {
    for (const section of ADMIN_SECTIONS) {
      expect(section.urlSegment.length, `section ${section.id} urlSegment`).toBeGreaterThan(0)
      expect(/^[a-z0-9-]+$/.test(section.urlSegment), `section ${section.id} urlSegment shape`).toBe(true)
    }
  })

  it('generates one 301 redirect per tile that carries a legacyHref', () => {
    const redirects = getAdminRedirects()
    const tilesWithLegacy = getAllAdminTiles().filter(t => t.legacyHref)
    // tile redirects + 8 section-bare redirects (one per section).
    expect(redirects.length).toBe(tilesWithLegacy.length + ADMIN_SECTIONS.length)
    for (const r of redirects) {
      expect(r.permanent).toBe(true)
      expect(r.source.startsWith('/admin/')).toBe(true)
    }
  })

  it('produces a wildcard subpath on tile redirects so deep links survive the rename', () => {
    const redirects = getAdminRedirects()
    const tileRedirects = redirects.filter(r => r.destination !== '/admin')
    for (const r of tileRedirects) {
      expect(r.source.endsWith('/:path*'),       `source ${r.source} missing /:path*`).toBe(true)
      expect(r.destination.endsWith('/:path*'),  `destination ${r.destination} missing /:path*`).toBe(true)
    }
  })

  it('gives every tile a non-empty title and description', () => {
    for (const tile of getAllAdminTiles()) {
      expect(tile.title.length, `tile ${tile.slug} title`).toBeGreaterThan(0)
      expect(tile.desc.length,  `tile ${tile.slug} desc`).toBeGreaterThan(10)
    }
  })

  it('exposes the settings-notifications convenience tile outside admin', () => {
    // Surfaced on the admin landing for ergonomics; intentionally not
    // counted as an admin tile by the nav-sync gate.
    expect(SETTINGS_NOTIFICATIONS_TILE.slug).toBe('settings-notifications')
    expect(SETTINGS_NOTIFICATIONS_TILE.href.startsWith('/admin/')).toBe(false)
    expect(getAdminTile('settings-notifications')).toBeUndefined()
  })

  it('resolves slugs to tiles via getAdminTile', () => {
    const tile = getAdminTile('members')
    expect(tile?.title).toBe('Members')
  })
})
