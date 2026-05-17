import { describe, expect, it } from 'vitest'
import { ADMIN_SECTIONS, SETTINGS_NOTIFICATIONS_TILE, getAllAdminTiles, getAdminTile } from '@/lib/adminCatalog'

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

  it('points every admin tile at /admin/<slug>', () => {
    for (const tile of getAllAdminTiles()) {
      expect(tile.href, `tile ${tile.slug} href mismatch`).toBe(`/admin/${tile.slug}`)
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
