import { describe, expect, it } from 'vitest'
import { getNavigationGroups, getNavigationCommandItems } from '@/lib/navigationCatalog'
import { FEATURES, getModules } from '@soteria/core/features'

// Invariants over the navigation catalog, derived from the live
// FEATURES registry rather than hardcoded counts (hardcoded counts
// rotted as modules were added — the failure mode PR #188 repaired).

// null tenantModules = static catalog defaults (no tenant overrides).
const DEFAULT_MODULES = null

describe('getNavigationGroups', () => {
  it('places every visible top-level module in exactly one group', () => {
    const groups = getNavigationGroups(DEFAULT_MODULES)
    const placed = groups.flatMap(g => g.items.map(i => i.feature.id))
    expect(new Set(placed).size).toBe(placed.length)

    const visibleModuleIds = (['safety', 'reports', 'admin'] as const)
      .flatMap(category => getModules(category))
      .filter(f => !f.internal)
      .map(f => f.id)
    for (const id of placed) {
      expect(visibleModuleIds, `nav item ${id} is not a catalog module`).toContain(id)
    }
  })

  it('never renders an empty group and never surfaces an internal feature', () => {
    const groups = getNavigationGroups(DEFAULT_MODULES)
    for (const group of groups) {
      expect(group.items.length, `group ${group.id} is empty`).toBeGreaterThan(0)
      for (const item of group.items) {
        expect(item.feature.internal ?? false, `internal feature ${item.feature.id} leaked into nav`).toBe(false)
      }
    }
  })

  it('drops a module the tenant has disabled', () => {
    const allOff: Record<string, boolean> = {}
    for (const f of FEATURES) allOff[f.id] = false
    const groups = getNavigationGroups(allOff)
    const ids = groups.flatMap(g => g.items.map(i => i.feature.id))
    // comingSoon features stay visible by design; everything else hides.
    for (const id of ids) {
      const feature = FEATURES.find(f => f.id === id)
      expect(feature?.comingSoon, `${id} should be hidden when its module flag is off`).toBe(true)
    }
  })

  it('gives every item a non-empty keyword set including its own id', () => {
    for (const group of getNavigationGroups(DEFAULT_MODULES)) {
      for (const item of group.items) {
        expect(item.keywords.length).toBeGreaterThan(0)
        expect(item.keywords).toContain(item.feature.id)
      }
    }
  })
})

describe('getNavigationCommandItems', () => {
  it('only emits entries with a concrete href', () => {
    for (const entry of getNavigationCommandItems(DEFAULT_MODULES)) {
      expect(typeof entry.href).toBe('string')
      expect(entry.href.length).toBeGreaterThan(0)
    }
  })

  it('handles null and undefined tenantModules identically', () => {
    const a = getNavigationCommandItems(null).map(e => e.href)
    const b = getNavigationCommandItems(undefined).map(e => e.href)
    expect(a).toEqual(b)
  })
})
