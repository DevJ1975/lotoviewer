import { describe, it, expect } from 'vitest'
import {
  FEATURES,
  getFeature,
  isFeatureEnabled,
  isFeatureAccessible,
  getFeaturesByCategory,
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
    expect(isFeatureAccessible('status')).toBe(true)
  })

  it('returns false for coming-soon features even though they are enabled', () => {
    // The whole point of the helper — distinguishes "visible" from
    // "clickable" so route guards fail closed against advertised-only
    // features.
    expect(isFeatureAccessible('near-miss')).toBe(false)
    expect(isFeatureAccessible('hot-work')).toBe(false)
    expect(isFeatureAccessible('jha')).toBe(false)
  })

  it('returns false for unknown features', () => {
    expect(isFeatureAccessible('does-not-exist')).toBe(false)
  })
})

// ── getFeaturesByCategory — drawer's grouping data source ──────────────────

describe('getFeaturesByCategory', () => {
  it('returns all enabled features in a category, preserving registry order', () => {
    const safety = getFeaturesByCategory('safety')
    // Order from FEATURES: loto, confined-spaces, near-miss, hot-work, jha
    const ids = safety.map(f => f.id)
    expect(ids).toEqual(['loto', 'confined-spaces', 'near-miss', 'hot-work', 'jha'])
  })

  it('includes coming-soon entries (they have enabled=true)', () => {
    const safety = getFeaturesByCategory('safety')
    const comingSoon = safety.filter(f => f.comingSoon)
    expect(comingSoon.length).toBeGreaterThan(0)
  })

  it('returns an empty array for a category with no enabled features', () => {
    // No feature is in a hypothetical "ghost" category — type-narrow with
    // a cast so the test still type-checks against the union.
    expect(getFeaturesByCategory('ghost' as FeatureCategory)).toEqual([])
  })

  it('every category lookup is a strict subset of FEATURES', () => {
    const all = new Set<string>()
    for (const cat of CATEGORIES) {
      for (const f of getFeaturesByCategory(cat)) all.add(f.id)
    }
    // Should be at most the size of the enabled subset.
    const enabledCount = FEATURES.filter(f => f.enabled).length
    expect(all.size).toBe(enabledCount)
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
    // Future implementation will look up tenant_features rows; today the
    // arg is accepted and ignored. Guarantees the call signature is
    // already in place so callers can be wired before the multi-tenant
    // backend lands.
    await expect(resolveFeatureFlags('any-tenant-uuid')).resolves.toBeInstanceOf(Map)
  })
})

// ── Registry invariants — protect against accidental drift ─────────────────
// These don't test a function; they test the static FEATURES catalog. If
// someone edits lib/features.ts in a way that breaks the model, the test
// fails immediately rather than the bug surfacing as a confusing UX.

describe('FEATURES registry invariants', () => {
  it('every feature id is unique', () => {
    const ids = FEATURES.map(f => f.id)
    const set = new Set(ids)
    expect(set.size).toBe(ids.length)
  })

  it('every coming-soon feature has href=null', () => {
    // The contract: coming-soon features can't have a route yet, otherwise
    // the drawer's disabled-styling lies (the user could just URL-bar to
    // it). Catch this at test time.
    for (const f of FEATURES) {
      if (f.comingSoon) {
        expect(f.href, `${f.id} is comingSoon but has href=${f.href}`).toBeNull()
      }
    }
  })

  it('every live (enabled, not coming-soon) feature has a non-null href', () => {
    // Inverse invariant: a "live" feature without a route would render in
    // the drawer as a non-clickable item with no Coming-Soon explanation.
    for (const f of FEATURES) {
      if (f.enabled && !f.comingSoon) {
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
    // Drawer renders both — empty strings would just look like a bug.
    for (const f of FEATURES) {
      expect(f.name.trim().length, `${f.id}.name is empty`).toBeGreaterThan(0)
      expect(f.description.trim().length, `${f.id}.description is empty`).toBeGreaterThan(0)
    }
  })
})
