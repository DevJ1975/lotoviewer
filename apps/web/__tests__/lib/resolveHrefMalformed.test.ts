import { describe, it, expect } from 'vitest'
import { resolveHref } from '@/lib/resolveHref'
import { entityHref } from '@/lib/safetyBoards/client'
import { hrefForCrossRef } from '@/lib/safetyBoards/crossRef'

// resolveHref's detail-page fallback decoded the trailing segment so a UUID
// would read as text. decodeURIComponent throws URIError on any incomplete
// escape, and "MIX-100%" is enough to trigger it.
//
// That mattered far more than a bad label. AppDrawer resolves every Recents
// entry in its render body, AppChrome mounts the drawer from the ROOT layout,
// so the throw escaped the route-level error boundary and hit global-error —
// replacing the whole application. And because pushRecent had already written
// the offending path to localStorage, it happened again on every authenticated
// route until the user cleared storage.

const MALFORMED = [
  '/incidents/100%',          // trailing percent — a plausible equipment id
  '/incidents/%zz',           // non-hex escape
  '/equipment/%',             // bare percent
  '/chemicals/%E0%A4%A',      // truncated multi-byte sequence
]

describe('resolveHref — malformed percent-escapes', () => {
  it.each(MALFORMED)('does not throw on %s', path => {
    expect(() => resolveHref(path)).not.toThrow()
  })

  it('still resolves the row rather than dropping it', () => {
    const r = resolveHref('/equipment/MIX-100%')
    expect(r).not.toBeNull()
    expect(r!.href).toBe('/equipment/MIX-100%')
  })

  it('shows the undecodable id raw instead of failing', () => {
    expect(resolveHref('/incidents/100%')!.label).toContain('100%')
  })

  it('still decodes a well-formed escape', () => {
    expect(resolveHref('/incidents/abc%20def')!.label).toContain('abc def')
  })
})

// The other half: stop producing such paths. Every other /equipment/ builder
// in the app already encodes; these two did not.
describe('entity href builders encode their id', () => {
  it('encodes a percent in an equipment id', () => {
    expect(entityHref('equipment', 'MIX-100%')).toBe('/equipment/MIX-100%25')
  })

  it('encodes a slash so it cannot forge a path segment', () => {
    expect(entityHref('equipment', 'LINE/3')).toBe('/equipment/LINE%2F3')
  })

  it('leaves an ordinary id readable', () => {
    expect(entityHref('incident', 'abc-123')).toBe('/incidents/abc-123')
  })

  it('encodes cross-reference ids from free-typed post text', () => {
    expect(hrefForCrossRef({ prefix: 'EQUIP', id: 'MIX-100%', raw: '', index: 0 } as never))
      .toBe('/equipment/MIX-100%25')
  })

  // The whole point: what these builders emit must survive what Recents does.
  it('produces paths resolveHref can handle', () => {
    for (const id of ['MIX-100%', 'LINE/3', 'A B', '%', 'ok-1']) {
      const href = entityHref('equipment', id)!
      expect(() => resolveHref(href)).not.toThrow()
    }
  })
})
