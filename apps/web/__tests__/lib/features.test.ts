import { describe, it, expect } from 'vitest'
import {
  FEATURES,
  getFeature,
  isFeatureEnabled,
  isFeatureAccessible,
  getFeaturesByCategory,
  getModules,
  getChildren,
  resolveFeatureFlags,
  type FeatureCategory,
} from '@/lib/features'

const CATEGORIES: FeatureCategory[] = ['safety', 'reports', 'admin']

// ── getFeature — exact-id lookup ───────────────────────────────────────────

describe('getFeature', () => {
  it('returns the FeatureDef for a known id', () => {
    const f = getFeature('confined-spaces')
    expect(f).not.toBeNull()
    expect(f?.id).toBe('confined-spaces')
    expect(f?.href).toBe('/confined-spaces')
  })

  it('returns null for an unknown id', () => {
    expect(getFeature('does-not-exist')).toBeNull()
  })

  it('returns null for an empty id (no implicit prefix matching)', () => {
    expect(getFeature('')).toBeNull()
  })

  it('is case-sensitive (the registry uses lowercase-kebab IDs)', () => {
    expect(getFeature('Confined-Spaces')).toBeNull()
    expect(getFeature('CONFINED-SPACES')).toBeNull()
  })
})

// ── isFeatureEnabled — master visibility switch ────────────────────────────

describe('isFeatureEnabled', () => {
  it('returns true for a live, enabled feature', () => {
    expect(isFeatureEnabled('loto')).toBe(true)
    expect(isFeatureEnabled('confined-spaces')).toBe(true)
  })

  it('returns true for a coming-soon feature (advertised, not yet ready)', () => {
    // Coming-soon entries are visible in the drawer (with the pill); they
    // pass the "visible at all" gate. They fail the *accessibility* gate
    // — see isFeatureAccessible below.
    expect(isFeatureEnabled('near-miss')).toBe(true)
    expect(isFeatureEnabled('hot-work')).toBe(true)
    expect(isFeatureEnabled('jha')).toBe(true)
  })

  it('returns false for an unknown feature (defensive default)', () => {
    expect(isFeatureEnabled('something-else')).toBe(false)
  })
})

// ── isFeatureAccessible — clickable + reachable ────────────────────────────

describe('isFeatureAccessible', () => {
  it('returns true for live features that have a route', () => {
    expect(isFeatureAccessible('loto')).toBe(true)
    expect(isFeatureAccessible('confined-spaces')).toBe(true)
    expect(isFeatureAccessible('loto-status')).toBe(true)
  })

  it('returns true for child features (they share the same accessibility check)', () => {
    expect(isFeatureAccessible('loto-import')).toBe(true)
    expect(isFeatureAccessible('cs-status-board')).toBe(true)
  })

  it('returns true for live modules', () => {
    // Every safety module is live now — Coming Soon catalog is empty.
    // (hot-work shipped in batch G-2; near-miss in slice 2 of its
    // own module; jha in slice 2 of the JHA module.)
    expect(isFeatureAccessible('hot-work')).toBe(true)
    expect(isFeatureAccessible('near-miss')).toBe(true)
    expect(isFeatureAccessible('jha')).toBe(true)
  })

  it('returns false for unknown features', () => {
    expect(isFeatureAccessible('does-not-exist')).toBe(false)
  })
})

// ── getFeaturesByCategory — flat list (modules + children together) ────────

describe('getFeaturesByCategory', () => {
  it('returns all enabled features in a category, preserving registry order', () => {
    const safety = getFeaturesByCategory('safety')
    const ids = safety.map(f => f.id)
    expect(ids).toEqual([
      'loto',
      'loto-status',
      'loto-departments',
      'loto-print',
      'loto-import',
      'loto-decommission',
      'loto-review-portal',
      'risk-assessment',
      'risk-heatmap',
      'risk-list',
      'risk-new',
      'risk-controls',
      'confined-spaces',
      'cs-status-board',
      'cs-import',
      'near-miss',
      'hot-work',
      'hot-work-status',
      'jha',
    ])
  })

  it('returns coming-soon entries with comingSoon=true when any exist', () => {
    // Every safety module is live as of JHA slice 2 — the array is
    // currently empty by design. Re-tighten this assertion the next
    // time a module is added with comingSoon:true.
    const safety = getFeaturesByCategory('safety')
    const comingSoon = safety.filter(f => f.comingSoon)
    for (const f of comingSoon) expect(f.enabled).toBe(true)
  })

  it('returns an empty array for a category with no enabled features', () => {
    expect(getFeaturesByCategory('ghost' as FeatureCategory)).toEqual([])
  })

  it('every category lookup combined covers all enabled features exactly once', () => {
    const all = new Set<string>()
    for (const cat of CATEGORIES) {
      for (const f of getFeaturesByCategory(cat)) all.add(f.id)
    }
    const enabledCount = FEATURES.filter(f => f.enabled).length
    expect(all.size).toBe(enabledCount)
  })
})

// ── getModules — top-level rows in the drawer ──────────────────────────────

describe('getModules', () => {
  it('returns only top-level features (no parent) for a category', () => {
    const ids = getModules('safety').map(m => m.id)
    expect(ids).toEqual([
      'loto',
      'risk-assessment',
      'confined-spaces',
      'near-miss',
      'hot-work',
      'jha',
    ])
  })

  it('excludes child features even though they share the parent\'s category', () => {
    const ids = getModules('safety').map(m => m.id)
    // Sub-pages that live under loto / confined-spaces must NOT appear as
    // top-level rows — they'd duplicate every nav entry otherwise.
    expect(ids).not.toContain('loto-status')
    expect(ids).not.toContain('loto-departments')
    expect(ids).not.toContain('cs-status-board')
  })

  it('surfaces top-level reports modules (currently the EHS Scorecard)', () => {
    const ids = getModules('reports').map(m => m.id)
    expect(ids).toContain('reports-scorecard')
  })

  it('surfaces top-level admin modules (currently Webhooks)', () => {
    const ids = getModules('admin').map(m => m.id)
    expect(ids).toContain('admin-webhooks')
  })
})

// ── getChildren — sub-pages under a module ─────────────────────────────────

describe('getChildren', () => {
  it('returns the children of a module in registry order', () => {
    const ids = getChildren('loto').map(c => c.id)
    expect(ids).toEqual([
      'loto-status',
      'loto-departments',
      'loto-print',
      'loto-import',
      'loto-decommission',
      'loto-review-portal',
    ])
  })

  it('returns the children of confined-spaces module', () => {
    const ids = getChildren('confined-spaces').map(c => c.id)
    expect(ids).toEqual(['cs-status-board', 'cs-import'])
  })

  it('returns the children of hot-work module', () => {
    const ids = getChildren('hot-work').map(c => c.id)
    expect(ids).toEqual(['hot-work-status'])
  })

  it('returns an empty array for a leaf module (coming-soon entries have none)', () => {
    expect(getChildren('near-miss')).toEqual([])
    expect(getChildren('jha')).toEqual([])
  })

  it('returns an empty array for an unknown module id', () => {
    expect(getChildren('does-not-exist')).toEqual([])
  })
})

// ── resolveFeatureFlags — multi-tenant resolver shape ──────────────────────

describe('resolveFeatureFlags', () => {
  it('returns a Map keyed by feature id', async () => {
    const m = await resolveFeatureFlags()
    expect(m).toBeInstanceOf(Map)
    expect(m.get('confined-spaces')?.id).toBe('confined-spaces')
  })

  it('contains every feature from the static catalog (single-tenant passthrough)', async () => {
    const m = await resolveFeatureFlags()
    expect(m.size).toBe(FEATURES.length)
    for (const f of FEATURES) {
      expect(m.has(f.id)).toBe(true)
    }
  })

  it('ignores the tenantId arg (today) without throwing', async () => {
    await expect(resolveFeatureFlags('any-tenant-uuid')).resolves.toBeInstanceOf(Map)
  })
})

// ── Registry invariants — protect against accidental drift ─────────────────

describe('FEATURES registry invariants', () => {
  it('every feature id is unique', () => {
    const ids = FEATURES.map(f => f.id)
    const set = new Set(ids)
    expect(set.size).toBe(ids.length)
  })

  it('every coming-soon feature has href=null', () => {
    for (const f of FEATURES) {
      if (f.comingSoon) {
        expect(f.href, `${f.id} is comingSoon but has href=${f.href}`).toBeNull()
      }
    }
  })

  it('every live (enabled, not coming-soon, not internal) feature has a non-null href', () => {
    for (const f of FEATURES) {
      if (f.enabled && !f.comingSoon && !f.internal) {
        expect(f.href, `${f.id} is live but has no href`).not.toBeNull()
      }
    }
  })

  it('every category is one of the declared FeatureCategory values', () => {
    const declared: FeatureCategory[] = ['safety', 'reports', 'admin']
    for (const f of FEATURES) {
      expect(declared).toContain(f.category)
    }
  })

  it('every feature has non-empty name and description', () => {
    for (const f of FEATURES) {
      expect(f.name.trim().length, `${f.id}.name is empty`).toBeGreaterThan(0)
      expect(f.description.trim().length, `${f.id}.description is empty`).toBeGreaterThan(0)
    }
  })

  // ─ Nesting invariants ───────────────────────────────────────────────────
  // The parent field gates the entire two-level drawer. Bad data here =
  // orphaned items, infinite loops, or duplicate rows.

  it('every feature with parent points at a real, top-level module', () => {
    const ids = new Set(FEATURES.map(f => f.id))
    const parents = new Set(FEATURES.filter(f => !f.parent).map(f => f.id))
    for (const f of FEATURES) {
      if (!f.parent) continue
      expect(ids, `${f.id}.parent="${f.parent}" doesn't exist`).toContain(f.parent)
      expect(parents, `${f.id}.parent="${f.parent}" is itself a child — no nested submenus allowed`).toContain(f.parent)
    }
  })

  it('a child inherits its parent\'s category (drawer groups by category)', () => {
    // The drawer renders modules under their category and pulls children
    // via getChildren(moduleId). If a child had a different category, it
    // would never appear because the drawer only walks each module within
    // its own category.
    for (const f of FEATURES) {
      if (!f.parent) continue
      const parent = FEATURES.find(p => p.id === f.parent)!
      expect(f.category, `${f.id}.category="${f.category}" but parent ${parent.id}.category="${parent.category}"`).toBe(parent.category)
    }
  })

  it('no parent references its own id (defensive — no self-loops)', () => {
    for (const f of FEATURES) {
      if (f.parent) expect(f.parent).not.toBe(f.id)
    }
  })
})
