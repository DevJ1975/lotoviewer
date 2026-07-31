import { describe, it, expect } from 'vitest'
import { resolveHref } from '@/lib/resolveHref'

// Recents used to drop every path the two catalogs couldn't name — which is
// every one of the app's 128 dynamic segments. So the one surface meant to
// adapt to the user quietly ignored the pages most worth returning to: a
// specific incident, chemical, or piece of equipment.

describe('resolveHref — catalogued routes', () => {
  it('still resolves a top-level module exactly', () => {
    const r = resolveHref('/incidents')
    expect(r).not.toBeNull()
    expect(r!.label).toBe('Incident Reporting')
    expect(r!.source).toBe('feature')
  })

  it('labels a child with its parent', () => {
    const r = resolveHref('/incidents/new')
    expect(r).not.toBeNull()
    expect(r!.label).toContain('/')
  })
})

describe('resolveHref — detail pages', () => {
  it('resolves a detail page against its module instead of dropping it', () => {
    const r = resolveHref('/incidents/8f14e45f-ceea-467a-9f1e-1f1f1f1f1f1f')
    expect(r).not.toBeNull()
    expect(r!.label).toContain('Incident Reporting')
    expect(r!.href).toBe('/incidents/8f14e45f-ceea-467a-9f1e-1f1f1f1f1f1f')
  })

  it('truncates a long id so the module name survives a 22rem drawer', () => {
    const r = resolveHref('/incidents/8f14e45f-ceea-467a-9f1e-1f1f1f1f1f1f')
    expect(r!.label).toContain('…')
    expect(r!.label.length).toBeLessThan(45)
  })

  it('keeps a short readable id whole', () => {
    const r = resolveHref('/equipment/PUMP-12')
    expect(r).not.toBeNull()
    expect(r!.label).toContain('PUMP-12')
    expect(r!.label).not.toContain('…')
  })

  it('decodes percent-encoded ids', () => {
    const r = resolveHref('/equipment/LINE%203')
    expect(r!.label).toContain('LINE 3')
  })

  // Longest prefix wins, so a deep admin route reads as the nearest real
  // destination rather than the section root.
  it('prefers the most specific catalogued ancestor', () => {
    const r = resolveHref('/admin/people/contractors/abc/prequalification')
    expect(r).not.toBeNull()
    expect(r!.label).toContain('Contractors')
  })

  it('returns null for a path with no catalogued ancestor', () => {
    expect(resolveHref('/definitely-not-a-module/xyz')).toBeNull()
  })

  it('returns null for a single unknown segment', () => {
    expect(resolveHref('/nope')).toBeNull()
  })
})
