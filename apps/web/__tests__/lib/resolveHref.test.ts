import { describe, expect, it } from 'vitest'
import { resolveHref } from '@/lib/resolveHref'

describe('resolveHref', () => {
  it('resolves a top-level feature href to its name + icon', () => {
    const r = resolveHref('/loto')
    expect(r?.label).toBe('LOTO')
    expect(r?.source).toBe('feature')
    expect(r?.Icon).toBeDefined()
  })

  it('resolves a child feature href as "Parent / Child"', () => {
    // /status is the LOTO Status Report child.
    const r = resolveHref('/status')
    expect(r?.label).toBe('LOTO / Status Report')
    expect(r?.source).toBe('feature')
  })

  it('resolves an admin landing tile by /admin/<slug>', () => {
    const r = resolveHref('/admin/members')
    expect(r?.label).toBe('Members')
    expect(r?.source).toBe('admin')
  })

  it('returns null for an unrecognized path', () => {
    expect(resolveHref('/some-random-deep-path/123')).toBeNull()
  })

  it('returns null for an exact-path mismatch (no fuzzy prefix matching)', () => {
    // /loto/equipment/abc is a real route but not in the catalog; we
    // don't fuzzy-match to /loto.
    expect(resolveHref('/loto/equipment/abc')).toBeNull()
  })
})
