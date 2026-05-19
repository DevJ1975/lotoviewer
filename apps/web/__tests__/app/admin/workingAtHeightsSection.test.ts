import { describe, expect, it } from 'vitest'
import { ADMIN_SECTIONS, getAdminTile } from '@/lib/adminCatalog'

// The Working at Heights admin section ships with eight inventory
// tiles. Each one maps to a `/admin/working-at-heights/<slug>/page.tsx`
// the nav-sync gate is already covering. These assertions pin the
// section's shape so a future edit that drops a tile or moves the URL
// segment fails here loudly.

describe('Working at Heights admin section', () => {
  const section = ADMIN_SECTIONS.find(s => s.id === 'working-at-heights')

  it('exists in ADMIN_SECTIONS', () => {
    expect(section).toBeDefined()
  })

  it('uses the working-at-heights URL segment', () => {
    expect(section?.urlSegment).toBe('working-at-heights')
  })

  it('ships eight inventory tiles', () => {
    expect(section?.tiles.length).toBe(8)
  })

  it('every tile resolves to /admin/working-at-heights/<slug>', () => {
    for (const t of section?.tiles ?? []) {
      expect(t.href).toBe(`/admin/working-at-heights/${t.slug}`)
    }
  })

  it('every tile is reachable via getAdminTile', () => {
    for (const t of section?.tiles ?? []) {
      const found = getAdminTile(t.slug)
      expect(found?.href, `getAdminTile(${t.slug})`).toBe(t.href)
    }
  })

  it('carries the expected tile slugs', () => {
    const slugs = (section?.tiles ?? []).map(t => t.slug).sort()
    expect(slugs).toEqual([
      'anchors',
      'authorizations',
      'fall-protection',
      'inspections',
      'ladders-fixed',
      'ladders-portable',
      'permits',
      'rescue-plans',
    ])
  })

  it('all WAH tiles are net-new (no legacy href for the 301 generator)', () => {
    // Phase B URL renames only applied to pre-existing routes. The
    // Working at Heights pages were authored under the new URL shape
    // from day one, so legacyHref should be null on every tile.
    for (const t of section?.tiles ?? []) {
      expect(t.legacyHref, `${t.slug} legacyHref`).toBeNull()
    }
  })

  it('every tile has a substantive description (≥40 chars)', () => {
    for (const t of section?.tiles ?? []) {
      expect(t.desc.length, `${t.slug} desc length`).toBeGreaterThanOrEqual(40)
    }
  })
})
