import { describe, it, expect } from 'vitest'
import { ENERGY_CODES, energyCodeFor, hexToRgb01 } from '@/lib/energyCodes'

// ── energyCodeFor ──────────────────────────────────────────────────────────

describe('energyCodeFor', () => {
  it('returns the canonical record for a known single-letter code', () => {
    const e = energyCodeFor('E')
    expect(e.code).toBe('E')
    expect(e.labelEn).toBe('Electrical')
    expect(e.hex).toBe('#FFD900')
  })

  it('returns the canonical record for a known two-letter code', () => {
    expect(energyCodeFor('OG').labelEn).toBe('Comp. Gas')
  })

  it('is case-insensitive — placards may be edited with lowercase entries', () => {
    expect(energyCodeFor('e').code).toBe('E')
    expect(energyCodeFor('og').labelEn).toBe('Comp. Gas')
  })

  it('trims whitespace before lookup so trailing spaces don\'t cause "Unknown"', () => {
    expect(energyCodeFor('  G ').labelEn).toBe('Gas')
  })

  it('returns a placeholder record for unknown codes — never throws', () => {
    const e = energyCodeFor('Z')
    expect(e.code).toBe('Z')
    expect(e.labelEn).toBe('Z')
    expect(e.hex).toBe('#888888')   // muted gray sentinel
  })

  it('handles null input by returning the "?" placeholder', () => {
    const e = energyCodeFor(null)
    expect(e.code).toBe('?')
    expect(e.labelEn).toBe('Unknown')
  })

  it('handles undefined input by returning the "?" placeholder', () => {
    const e = energyCodeFor(undefined)
    expect(e.code).toBe('?')
  })

  it('handles empty string by returning the "?" placeholder (not an empty-code record)', () => {
    const e = energyCodeFor('')
    expect(e.code).toBe('?')
    expect(e.labelEn).toBe('Unknown')
  })

  it('every catalog code is independently resolvable — no aliasing', () => {
    for (const c of ENERGY_CODES) {
      expect(energyCodeFor(c.code).code).toBe(c.code)
    }
  })

  it('returns a textHex that is white on every dark color in the catalog', () => {
    // Sanity check: bright yellow ('E') is the only catalog hue with
    // dark-text contrast; everything else should pair with white text.
    for (const c of ENERGY_CODES) {
      if (c.code === 'E') continue
      expect(c.textHex).toBe('#FFFFFF')
    }
  })
})

// ── hexToRgb01 ─────────────────────────────────────────────────────────────

describe('hexToRgb01', () => {
  it('parses a simple #RRGGBB string into floats in [0, 1]', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb01('#FFFFFF')).toEqual([1, 1, 1])
  })

  it('parses without the leading #', () => {
    expect(hexToRgb01('FF0000')).toEqual([1, 0, 0])
  })

  it('handles lowercase hex digits', () => {
    expect(hexToRgb01('#ff00ff')).toEqual([1, 0, 1])
  })

  it('round-trips a recognizable middle value (yellow brand color)', () => {
    const [r, g, b] = hexToRgb01('#FFD900')
    expect(r).toBeCloseTo(1)
    expect(g).toBeCloseTo(0xD9 / 255, 5)
    expect(b).toBeCloseTo(0)
  })

  it('produces values monotonic across the hex range', () => {
    const dark   = hexToRgb01('#202020')[0]
    const middle = hexToRgb01('#808080')[0]
    const light  = hexToRgb01('#E0E0E0')[0]
    expect(dark).toBeLessThan(middle)
    expect(middle).toBeLessThan(light)
  })
})
