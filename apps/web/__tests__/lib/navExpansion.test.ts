import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NAV_EXPANSION_EVENT,
  isExpanded,
  readExpansion,
  toggleExpansion,
  writeExpansion,
  type NavExpansion,
} from '@/lib/navExpansion'

const TENANT = 'tenant-abc'
const KEY = `soteria.nav.expanded.${TENANT}`

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('readExpansion', () => {
  it('returns an empty record for a null tenant (no key to read)', () => {
    expect(readExpansion(null)).toEqual({})
  })

  it('returns an empty record when nothing is stored', () => {
    expect(readExpansion(TENANT)).toEqual({})
  })

  it('parses a stored record of booleans', () => {
    localStorage.setItem(KEY, JSON.stringify({ chemicals: true, permits: false }))
    expect(readExpansion(TENANT)).toEqual({ chemicals: true, permits: false })
  })

  it('reads from the per-tenant key, not a shared one', () => {
    localStorage.setItem(`soteria.nav.expanded.other`, JSON.stringify({ chemicals: true }))
    // The requested tenant has no key of its own → empty, no cross-tenant leak.
    expect(readExpansion(TENANT)).toEqual({})
  })

  it('drops non-boolean values rather than trusting them', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        good: true,
        str: 'true',
        num: 1,
        nul: null,
        nested: { open: true },
        arr: [true],
      }),
    )
    expect(readExpansion(TENANT)).toEqual({ good: true })
  })

  it('returns an empty record for unparseable JSON', () => {
    localStorage.setItem(KEY, '{ not valid json')
    expect(readExpansion(TENANT)).toEqual({})
  })

  it('returns an empty record for a JSON array (not an object map)', () => {
    localStorage.setItem(KEY, JSON.stringify(['chemicals', 'permits']))
    expect(readExpansion(TENANT)).toEqual({})
  })

  it.each([
    ['a JSON string primitive', JSON.stringify('chemicals')],
    ['a JSON number primitive', JSON.stringify(42)],
    ['the literal null', JSON.stringify(null)],
    ['the literal true', JSON.stringify(true)],
  ])('returns an empty record for %s', (_label, raw) => {
    localStorage.setItem(KEY, raw)
    expect(readExpansion(TENANT)).toEqual({})
  })

  it('returns an empty record when storage access throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(readExpansion(TENANT)).toEqual({})
  })
})

describe('writeExpansion', () => {
  it('does nothing for a null tenant', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    writeExpansion(null, { chemicals: true })
    expect(setItem).not.toHaveBeenCalled()
  })

  it('persists the record under the per-tenant key', () => {
    writeExpansion(TENANT, { chemicals: true, permits: false })
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ chemicals: true, permits: false })
  })

  it('round-trips through readExpansion', () => {
    const expansion: NavExpansion = { chemicals: true, hazards: false }
    writeExpansion(TENANT, expansion)
    expect(readExpansion(TENANT)).toEqual(expansion)
  })

  it('notifies same-tab listeners via the custom event', () => {
    const listener = vi.fn()
    window.addEventListener(NAV_EXPANSION_EVENT, listener)
    writeExpansion(TENANT, { chemicals: true })
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(NAV_EXPANSION_EVENT, listener)
  })

  it('swallows a storage throw (quota / private mode) instead of crashing the drawer', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => writeExpansion(TENANT, { chemicals: true })).not.toThrow()
  })
})

describe('isExpanded', () => {
  it('honours an explicit true even when the route is inactive', () => {
    expect(isExpanded({ chemicals: true }, 'chemicals', false)).toBe(true)
  })

  it('honours an explicit false even when the route is active', () => {
    expect(isExpanded({ chemicals: false }, 'chemicals', true)).toBe(false)
  })

  it.each([
    [true],
    [false],
  ])('falls back to active=%s when the user has no stored opinion', (active) => {
    expect(isExpanded({}, 'chemicals', active)).toBe(active)
  })
})

describe('toggleExpansion', () => {
  it('opens a module the user has never touched while standing outside it', () => {
    expect(toggleExpansion({}, 'chemicals', false)).toEqual({ chemicals: true })
  })

  it('records an explicit close for the module the user is standing in', () => {
    // active=true with no stored value reads as expanded, so a toggle must
    // persist `false` — deleting the key would let `active` re-open it.
    expect(toggleExpansion({}, 'chemicals', true)).toEqual({ chemicals: false })
  })

  it('flips an explicit true to false', () => {
    expect(toggleExpansion({ chemicals: true }, 'chemicals', false)).toEqual({ chemicals: false })
  })

  it('flips an explicit false to true', () => {
    expect(toggleExpansion({ chemicals: false }, 'chemicals', true)).toEqual({ chemicals: true })
  })

  it('preserves other modules and does not mutate the input', () => {
    const input: NavExpansion = { chemicals: true, permits: false }
    const out = toggleExpansion(input, 'permits', false)
    expect(out).toEqual({ chemicals: true, permits: true })
    expect(input).toEqual({ chemicals: true, permits: false })
    expect(out).not.toBe(input)
  })
})
