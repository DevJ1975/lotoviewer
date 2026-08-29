import { describe, it, expect } from 'vitest'
import { getNavigationGroups } from '@/lib/navigationCatalog'
import { getModules, type FeatureCategory } from '@soteria/core/features'

// The guard that was missing.
//
// MODULE_GROUPS is a hand-maintained id → group map, and CATEGORY_FALLBACKS
// quietly catches anything absent from it. Nothing failed when a module was
// forgotten — it just appeared in Daily Work (safety) or Administration
// (admin). Ten modules had drifted in that way, six of them admin-*, which is
// how the Administration group reached 16 rows: larger than Pinned, Hazards
// and Permits combined.
//
// These tests make that drift a build failure instead of a slow leak.

const CATEGORIES: FeatureCategory[] = ['safety', 'reports', 'admin']

/** Every top-level module, visible or not, across all categories. */
function allTopLevelModules() {
  return CATEGORIES.flatMap(c => getModules(c))
}

// A tenant with everything switched on, so grouping is tested at full breadth
// rather than whatever a default tenant happens to enable.
const ALL_ON = Object.fromEntries(allTopLevelModules().map(m => [m.id, true]))

describe('MODULE_GROUPS coverage', () => {
  it('places every top-level module in an explicit group, never the fallback', () => {
    const groups = getNavigationGroups(ALL_ON)
    const fallback = groups.find(g => g.id === 'administration')

    // 'administration' is retained only so an unmapped module still renders.
    // Anything reaching it means MODULE_GROUPS is missing an entry.
    const stranded = fallback?.items.map(i => i.feature.id) ?? []
    expect(stranded).toEqual([])
  })

  it('assigns every visible module to exactly one group', () => {
    const groups = getNavigationGroups(ALL_ON)
    const ids = groups.flatMap(g => g.items.map(i => i.feature.id))
    expect(ids).toHaveLength(new Set(ids).size)
  })
})

describe('group sizes stay scannable', () => {
  // Not arbitrary: the drawer is a flat list with no collapse at group level,
  // and the audit's finding was that one 16-row group is unscannable. Twelve
  // is generous headroom that still fails loudly if a group starts absorbing
  // everything again.
  it('keeps no group above 12 top-level rows', () => {
    const oversized = getNavigationGroups(ALL_ON)
      .filter(g => g.items.length > 12)
      .map(g => `${g.label} (${g.items.length})`)
    expect(oversized).toEqual([])
  })

  it('drops empty groups rather than rendering a bare heading', () => {
    for (const group of getNavigationGroups(ALL_ON)) {
      expect(group.items.length).toBeGreaterThan(0)
    }
  })
})

describe('tenant gating', () => {
  it('hides a module the tenant has switched off', () => {
    const withLoto = getNavigationGroups(ALL_ON)
      .flatMap(g => g.items.map(i => i.feature.id))
    expect(withLoto).toContain('loto')

    const withoutLoto = getNavigationGroups({ ...ALL_ON, loto: false })
      .flatMap(g => g.items.map(i => i.feature.id))
    expect(withoutLoto).not.toContain('loto')
  })
})
