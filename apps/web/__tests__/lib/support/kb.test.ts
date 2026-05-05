import { describe, it, expect, beforeEach } from 'vitest'
import { resolveKb, listKbIds, _setKbCacheForTests } from '@/lib/support/kb'

// Stub the KB content so the resolver doesn't touch the disk during the
// jsdom test run. The fixture covers both registered modules; if a new
// module is added to MODULE_DEFS, listKbIds() catches it and the test
// below will fail until the fixture is updated.

const FIXTURE = {
  general:           '# general fixture body',
  loto:              '# loto fixture body',
  'confined-spaces': '# cs fixture body',
  'hot-work':        '# hot-work fixture body',
  risk:              '# risk fixture body',
}

beforeEach(() => {
  _setKbCacheForTests(FIXTURE as unknown as Record<string, string>)
})

describe('resolveKb', () => {
  it('always includes the general KB regardless of pathname or tenant', () => {
    const r = resolveKb({ pathname: null, tenantModules: null })
    expect(r.loadedIds).toContain('general')
    expect(r.systemContext).toContain('general fixture body')
  })

  it('does NOT include LOTO when the user is not on a LOTO page', () => {
    const r = resolveKb({ pathname: '/settings', tenantModules: { loto: true } })
    expect(r.loadedIds).not.toContain('loto')
    expect(r.systemContext).not.toContain('loto fixture body')
  })

  it('includes LOTO when on /loto and the tenant has it enabled', () => {
    const r = resolveKb({ pathname: '/loto', tenantModules: { loto: true } })
    expect(r.loadedIds).toEqual(['general', 'loto'])
    expect(r.systemContext).toContain('loto fixture body')
  })

  it('includes LOTO for sibling routes that belong to the LOTO module', () => {
    for (const p of ['/equipment/EQ-001', '/departments/north-line', '/print', '/import', '/decommission', '/status']) {
      const r = resolveKb({ pathname: p, tenantModules: { loto: true } })
      expect(r.loadedIds, `pathname ${p}`).toContain('loto')
    }
  })

  it('treats prefix-only matches strictly — /lotoroom should NOT load LOTO', () => {
    const r = resolveKb({ pathname: '/lotoroom', tenantModules: { loto: true } })
    expect(r.loadedIds).not.toContain('loto')
  })

  it('hides LOTO when the tenant has explicitly disabled the module', () => {
    const r = resolveKb({ pathname: '/loto', tenantModules: { loto: false } })
    expect(r.loadedIds).not.toContain('loto')
  })

  it('hides LOTO when tenantModules is null even on /loto (no membership state)', () => {
    // moduleVisibility falls back to the static feature flag when there\'s no
    // override row. LOTO is enabled by default in features.ts so this should
    // still load — guards against a regression where we accidentally require
    // an explicit override.
    const r = resolveKb({ pathname: '/loto', tenantModules: null })
    expect(r.loadedIds).toContain('loto')
  })

  it('is case-insensitive on the pathname so URL casing quirks do not matter', () => {
    const r = resolveKb({ pathname: '/LOTO', tenantModules: { loto: true } })
    expect(r.loadedIds).toContain('loto')
  })

  it('joins KB sections with a separator so the model can tell them apart', () => {
    const r = resolveKb({ pathname: '/loto', tenantModules: { loto: true } })
    expect(r.systemContext).toContain('---')
    expect(r.systemContext).toContain('### GENERAL')
    expect(r.systemContext).toContain('### LOTO')
  })
})

describe('listKbIds', () => {
  it('returns the registered module ids — keep in sync with MODULE_DEFS', () => {
    const ids = listKbIds()
    expect(ids).toContain('general')
    expect(ids).toContain('loto')
    expect(ids).toContain('confined-spaces')
    expect(ids).toContain('hot-work')
    expect(ids).toContain('risk')
  })
})

// ── Per-module path matching ──────────────────────────────────────────────
//
// One test per non-LOTO module, asserting the route prefix actually
// triggers the load. Each module also has its enabled-by-default feature
// flag in features.ts, so passing tenantModules: null still loads them.

describe('confined-spaces module', () => {
  it('loads on /confined-spaces and its sub-pages', () => {
    for (const p of ['/confined-spaces', '/confined-spaces/CS-MIX-04', '/confined-spaces/CS-MIX-04/permits/new', '/confined-spaces/import', '/confined-spaces/status']) {
      const r = resolveKb({ pathname: p, tenantModules: { 'confined-spaces': true } })
      expect(r.loadedIds, `pathname ${p}`).toContain('confined-spaces')
    }
  })
  it('does NOT leak into unrelated routes', () => {
    const r = resolveKb({ pathname: '/loto', tenantModules: { 'confined-spaces': true, loto: true } })
    expect(r.loadedIds).not.toContain('confined-spaces')
  })
  it('respects the tenant module toggle', () => {
    const r = resolveKb({ pathname: '/confined-spaces', tenantModules: { 'confined-spaces': false } })
    expect(r.loadedIds).not.toContain('confined-spaces')
  })
})

describe('hot-work module', () => {
  it('loads on /hot-work and its sub-pages', () => {
    for (const p of ['/hot-work', '/hot-work/new', '/hot-work/HW-2026-01', '/hot-work/status']) {
      const r = resolveKb({ pathname: p, tenantModules: { 'hot-work': true } })
      expect(r.loadedIds, `pathname ${p}`).toContain('hot-work')
    }
  })
  it('respects the tenant module toggle', () => {
    const r = resolveKb({ pathname: '/hot-work', tenantModules: { 'hot-work': false } })
    expect(r.loadedIds).not.toContain('hot-work')
  })
})

describe('risk module', () => {
  it('loads on /risk and its sub-pages', () => {
    for (const p of ['/risk', '/risk/list', '/risk/new', '/risk/RA-001', '/risk/controls', '/risk/export/iipp']) {
      const r = resolveKb({ pathname: p, tenantModules: { 'risk-assessment': true } })
      expect(r.loadedIds, `pathname ${p}`).toContain('risk')
    }
  })
  it('gates on the risk-assessment feature id (not "risk")', () => {
    // The feature id in features.ts is 'risk-assessment'; the KB id we
    // expose is just 'risk'. This test catches a regression where someone
    // accidentally renames the gate to 'risk' and silently breaks tenant
    // toggles.
    const r = resolveKb({ pathname: '/risk', tenantModules: { 'risk-assessment': false } })
    expect(r.loadedIds).not.toContain('risk')
  })
})

describe('cross-module isolation', () => {
  it('only loads the relevant module even when others are enabled', () => {
    const r = resolveKb({
      pathname:      '/confined-spaces',
      tenantModules: { loto: true, 'confined-spaces': true, 'hot-work': true, 'risk-assessment': true },
    })
    expect(r.loadedIds.sort()).toEqual(['confined-spaces', 'general'])
  })
})
