import { describe, it, expect } from 'vitest'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

// Pure-logic tests for the per-tenant module resolver. These cover the
// matrix of (tenant override × static enabled × parent inheritance) so
// regressions in the resolver fail at unit-test time, not at render time.

describe('isModuleVisible', () => {
  describe('tenant override (top-level)', () => {
    it('returns true when tenant explicitly enables a top-level module', () => {
      expect(isModuleVisible('loto', { loto: true })).toBe(true)
    })

    it('returns false when tenant explicitly disables a top-level module', () => {
      expect(isModuleVisible('confined-spaces', { 'confined-spaces': false })).toBe(false)
    })

    it('falls back to the static catalog when the tenant has no override key', () => {
      // 'loto' is enabled in the static catalog (lib/features.ts).
      expect(isModuleVisible('loto', {})).toBe(true)
    })

    it('treats null tenantModules as no overrides — fall back to catalog', () => {
      expect(isModuleVisible('loto', null)).toBe(true)
    })

    it('treats undefined tenantModules as no overrides — fall back to catalog', () => {
      expect(isModuleVisible('loto', undefined)).toBe(true)
    })
  })

  describe('child inheritance', () => {
    it('child inherits parent enabled when parent is enabled by tenant', () => {
      // 'loto-status' is a child of 'loto' (parent: 'loto' in features.ts)
      expect(isModuleVisible('loto-status', { loto: true })).toBe(true)
    })

    it('child inherits parent disabled when parent is disabled by tenant', () => {
      // Even though loto-status itself isn't in the override map, it
      // inherits its parent's "off" state.
      expect(isModuleVisible('loto-status', { loto: false })).toBe(false)
    })

    it('child of disabled parent stays hidden even if child appears in overrides', () => {
      // Children inherit — explicit child override is ignored. This is
      // important because the admin UI only renders top-level
      // checkboxes; a stray child key shouldn't accidentally re-enable.
      expect(isModuleVisible('loto-status', { loto: false, 'loto-status': true })).toBe(false)
    })

    it('child of confined-spaces inherits its disabled state', () => {
      expect(isModuleVisible('cs-status-board', { 'confined-spaces': false })).toBe(false)
    })
  })

  describe('hard global disable', () => {
    it('returns false for an unknown feature id', () => {
      expect(isModuleVisible('not-a-real-feature', { 'not-a-real-feature': true })).toBe(false)
    })
  })

  describe('Snak King default (LOTO-only) profile', () => {
    // Mirrors the modules JSONB inserted by migration 028 for slug=snak-king.
    const snakKingModules = {
      loto:                       true,
      'confined-spaces':          false,
      'hot-work':                 false,
      'reports-scorecard':        true,
      'reports-insights':         true,
      'reports-compliance-bundle':true,
      'reports-inspector':        true,
      'admin-loto-devices':       true,
      'admin-configuration':      true,
      'admin-webhooks':           true,
      'admin-training':           false,
      'admin-hygiene-log':        true,
      'settings-notifications':   true,
      support:                    true,
    }

    it('LOTO module is visible', () => {
      expect(isModuleVisible('loto', snakKingModules)).toBe(true)
    })

    it('LOTO children inherit visible', () => {
      expect(isModuleVisible('loto-status', snakKingModules)).toBe(true)
      expect(isModuleVisible('loto-departments', snakKingModules)).toBe(true)
      expect(isModuleVisible('loto-print', snakKingModules)).toBe(true)
    })

    it('Confined Spaces hidden along with its children', () => {
      expect(isModuleVisible('confined-spaces', snakKingModules)).toBe(false)
      expect(isModuleVisible('cs-status-board', snakKingModules)).toBe(false)
      expect(isModuleVisible('cs-import', snakKingModules)).toBe(false)
    })

    it('Hot Work hidden along with its child', () => {
      expect(isModuleVisible('hot-work', snakKingModules)).toBe(false)
      expect(isModuleVisible('hot-work-status', snakKingModules)).toBe(false)
    })
  })

  describe('WLS Demo (full safety stack) profile', () => {
    // Mirrors migration 028 for slug=wls-demo.
    const wlsDemoModules = {
      loto:                       true,
      'confined-spaces':          true,
      'hot-work':                 true,
      'reports-scorecard':        true,
      'reports-compliance-bundle':true,
      'reports-inspector':        true,
      'admin-training':           true,
      'admin-loto-devices':       true,
    }

    it('every safety module is visible', () => {
      expect(isModuleVisible('loto', wlsDemoModules)).toBe(true)
      expect(isModuleVisible('confined-spaces', wlsDemoModules)).toBe(true)
      expect(isModuleVisible('hot-work', wlsDemoModules)).toBe(true)
    })

    it('children of every safety module are visible by inheritance', () => {
      expect(isModuleVisible('loto-status', wlsDemoModules)).toBe(true)
      expect(isModuleVisible('cs-status-board', wlsDemoModules)).toBe(true)
      expect(isModuleVisible('hot-work-status', wlsDemoModules)).toBe(true)
    })
  })
})
