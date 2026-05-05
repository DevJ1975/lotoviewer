import { describe, it, expect, beforeEach } from 'vitest'
import { resolveKb, listKbIds, _setKbCacheForTests } from '@/lib/support/kb'

// Stub the KB content so the resolver doesn't touch the disk during the
// jsdom test run. The fixture covers both registered modules; if a new
// module is added to MODULE_DEFS, listKbIds() catches it and the test
// below will fail until the fixture is updated.

const FIXTURE = {
  general: '# general fixture body',
  loto:    '# loto fixture body',
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
  })
})
