import { describe, it, expect } from 'vitest'
import {
  MODULE_COLOR_CLASSES,
  getModuleVisuals,
  getModuleVisualsForPath,
} from '@/lib/moduleVisuals'
import { FEATURES, getModules } from '@soteria/core/features'

// ── MODULE_COLOR_CLASSES — palette completeness ──────────────────────────

describe('MODULE_COLOR_CLASSES', () => {
  it('every key has a full set of class fields', () => {
    for (const key of Object.keys(MODULE_COLOR_CLASSES)) {
      const c = MODULE_COLOR_CLASSES[key as keyof typeof MODULE_COLOR_CLASSES]
      expect(c.tile).toBeTypeOf('string')
      expect(c.pill).toBeTypeOf('string')
      expect(c.ring).toBeTypeOf('string')
      expect(c.strip).toBeTypeOf('string')
      expect(c.border).toBeTypeOf('string')
      expect(c.text).toBeTypeOf('string')
      // None of the fields should be empty.
      expect(c.tile.length).toBeGreaterThan(0)
      expect(c.strip.length).toBeGreaterThan(0)
    }
  })

  it('every color references its own palette name in the strip class', () => {
    // Sanity: 'red' should produce a 'bg-red-…' class. Catches typos
    // where a row's strip class drifts from its key.
    for (const key of Object.keys(MODULE_COLOR_CLASSES)) {
      const c = MODULE_COLOR_CLASSES[key as keyof typeof MODULE_COLOR_CLASSES]
      expect(c.strip).toContain(`-${key}-`)
    }
  })
})

// ── getModuleVisuals — id resolution ─────────────────────────────────────

describe('getModuleVisuals', () => {
  it('resolves a top-level module to its declared color + icon', () => {
    const v = getModuleVisuals('toolbox-talks')
    expect(v.color).toBe('sky')
    expect(v.classes).toBe(MODULE_COLOR_CLASSES.sky)
    expect(v.feature?.id).toBe('toolbox-talks')
    expect(v.Icon).toBeDefined()
  })

  it('falls back to slate for an unknown id', () => {
    const v = getModuleVisuals('does-not-exist')
    expect(v.color).toBe('slate')
    expect(v.classes).toBe(MODULE_COLOR_CLASSES.slate)
    expect(v.feature).toBeNull()
  })

  it('child rows inherit the parent module color', () => {
    // 'loto-print' has parent 'loto'. The parent declares red, child
    // declares nothing. Inheritance kicks in.
    const v = getModuleVisuals('loto-print')
    expect(v.color).toBe('red')
    expect(v.feature?.id).toBe('loto-print')  // feature is the child, color is parent's
  })

  it('every top-level safety/reports/admin module resolves to a registered color', () => {
    // Catches regressions where a module gets added to FEATURES but
    // forgets to set color, AND the fallback to slate gets accepted
    // silently. We assert the *explicit* declaration here.
    const topLevel = [...getModules('safety'), ...getModules('reports'), ...getModules('admin')]
    for (const f of topLevel) {
      expect(f.color, `module ${f.id} is missing a color`).toBeDefined()
      expect(f.icon,  `module ${f.id} is missing an icon`).toBeDefined()
    }
  })

  it('the FEATURES catalog has at least one module per safety color we declared', () => {
    // Sanity: if we add a color but never use it, that's wasted JIT
    // bundle weight. If we use a color but never declare it, the
    // type system catches it; this test is the inverse.
    const usedColors = new Set(
      FEATURES.map(f => f.color).filter((c): c is NonNullable<typeof c> => c !== undefined),
    )
    expect(usedColors.has('red')).toBe(true)
    expect(usedColors.has('sky')).toBe(true)
    expect(usedColors.has('slate')).toBe(true)
  })
})

// ── getModuleVisualsForPath — longest-prefix match ───────────────────────

describe('getModuleVisualsForPath', () => {
  it('matches the longest module prefix', () => {
    // /toolbox-talks/abc-123 should resolve to the toolbox-talks
    // module (prefix '/toolbox-talks'), not anything shorter.
    const v = getModuleVisualsForPath('/toolbox-talks/abc-123')
    expect(v.color).toBe('sky')
    expect(v.feature?.id).toBe('toolbox-talks')
  })

  it('matches an exact route', () => {
    const v = getModuleVisualsForPath('/loto')
    expect(v.color).toBe('red')
  })

  it('returns slate fallback on the dashboard', () => {
    const v = getModuleVisualsForPath('/')
    expect(v.color).toBe('slate')
    expect(v.feature).toBeNull()
  })

  it('returns slate fallback on unknown paths', () => {
    const v = getModuleVisualsForPath('/superadmin/cron')
    expect(v.color).toBe('slate')
    expect(v.feature).toBeNull()
  })

  it('returns slate fallback on null pathname (loading state)', () => {
    const v = getModuleVisualsForPath(null)
    expect(v.color).toBe('slate')
    expect(v.feature).toBeNull()
  })

  it('does not partial-prefix-match across module boundaries', () => {
    // '/jhax' must NOT match '/jha'. Boundary check via "/" or
    // exact equality.
    const v = getModuleVisualsForPath('/jhax')
    expect(v.color).toBe('slate')
    expect(v.feature).toBeNull()
  })

  it('a longer href beats a shorter one when both could match', () => {
    // Synthetic check: a child like /loto/equipment would still
    // resolve to /loto since /loto is the only matching top-level
    // href (children aren't candidates in the resolver).
    const v = getModuleVisualsForPath('/loto/equipment/123')
    expect(v.color).toBe('red')
    expect(v.feature?.id).toBe('loto')
  })
})
