import { describe, it, expect } from 'vitest'
import { resolveLandingPath } from '@/lib/landing'
import type { Tenant } from '@soteria/core/types'

// Builds a Tenant fixture with sane defaults; pass `over` to flip
// just the columns the test cares about.
function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id:             '00000000-0000-0000-0000-000000000001',
    tenant_number:  '0001',
    slug:           'fixture',
    name:           'Fixture Tenant',
    status:         'active',
    is_demo:        false,
    disabled_at:    null,
    modules:        {},
    logo_url:       null,
    custom_domain:  null,
    settings:       {},
    created_at:     '2026-01-01T00:00:00Z',
    updated_at:     '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('resolveLandingPath', () => {
  it('redirects single-module tenants to that module home', () => {
    // Snak King-shape tenant: only LOTO enabled; everything else
    // toggled off explicitly so the catalog defaults don't make
    // them multi-module.
    const t = tenant({
      modules: {
        'loto':            true,
        'confined-spaces': false,
        'hot-work':        false,
        'risk-assessment': false,
        'near-miss':       false,
        'jha':             false,
      },
    })
    expect(resolveLandingPath(t)).toBe('/loto')
  })

  it('returns null for tenants with multiple modules visible (renders dashboard)', () => {
    // WLS Demo-shape: LOTO + Confined Spaces both on; Hot Work and
    // any future modules left to the catalog defaults.
    const t = tenant({
      modules: {
        'loto':            true,
        'confined-spaces': true,
      },
    })
    // Even if the catalog auto-enables more modules, we must NOT
    // redirect; multiple visible top-level modules => dashboard.
    expect(resolveLandingPath(t)).toBeNull()
  })

  it('honors an explicit settings.default_landing_path override', () => {
    // Multi-module tenant that nonetheless wants /confined-spaces/status
    // as the default (e.g. an EHS team that lives there).
    const t = tenant({
      modules:  { 'loto': true, 'confined-spaces': true },
      settings: { default_landing_path: '/confined-spaces/status' },
    })
    expect(resolveLandingPath(t)).toBe('/confined-spaces/status')
  })

  it('override beats single-module auto-derive when both apply', () => {
    // Single-module tenant could auto-derive to /loto, but the
    // override should win — it's the explicit signal.
    const t = tenant({
      modules:  { 'loto': true, 'confined-spaces': false, 'hot-work': false, 'risk-assessment': false, 'near-miss': false, 'jha': false },
      settings: { default_landing_path: '/status' },
    })
    expect(resolveLandingPath(t)).toBe('/status')
  })

  it('ignores a malformed override that does not start with /', () => {
    const t = tenant({
      modules:  { 'loto': true, 'confined-spaces': false, 'hot-work': false, 'risk-assessment': false, 'near-miss': false, 'jha': false },
      settings: { default_landing_path: 'https://evil.com/' },
    })
    expect(resolveLandingPath(t)).toBe('/loto')
  })

  it('ignores an empty-string override', () => {
    const t = tenant({
      modules:  { 'loto': true, 'confined-spaces': false, 'hot-work': false, 'risk-assessment': false, 'near-miss': false, 'jha': false },
      settings: { default_landing_path: '   ' },
    })
    expect(resolveLandingPath(t)).toBe('/loto')
  })

  it('returns null when no tenant is active', () => {
    expect(resolveLandingPath(null)).toBeNull()
  })

  it('falls through to dashboard when zero modules are visible', () => {
    // Edge case: every module explicitly disabled. We don't redirect;
    // the user lands on the dashboard which renders with empty data.
    // (RLS + ModuleGuard handle the actual access concerns.)
    const t = tenant({
      modules: {
        'loto':            false,
        'confined-spaces': false,
        'hot-work':        false,
        'risk-assessment': false,
        'near-miss':       false,
        'jha':             false,
      },
    })
    expect(resolveLandingPath(t)).toBeNull()
  })
})
