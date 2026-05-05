import { describe, it, expect } from 'vitest'
import { ENERGY_CODES, energyCodeFor, hexToRgb01 } from '@soteria/core/energyCodes'

// ── energyCodeFor ──────────────────────────────────────────────────────────

describe('energyCodeFor', () => {
  it('returns the canonical record for a known single-letter code', () => {
    const e = energyCodeFor('E')
    expect(e.code).toBe('E')
    expect(e.labelEn).toBe('Electrical')
    expect(e.hex).toBe('#BF1414')
  })

  it('returns the canonical record for a known two-letter code', () => {
    expect(energyCodeFor('CG').labelEn).toBe('Compressed Gas')
  })

  it('is case-insensitive — placards may be edited with lowercase entries', () => {
    expect(energyCodeFor('e').code).toBe('E')
    expect(energyCodeFor('cg').labelEn).toBe('Compressed Gas')
  })

  it('trims whitespace before lookup so trailing spaces don\'t cause "Unknown"', () => {
    expect(energyCodeFor('  G ').labelEn).toBe('Gas')
  })

  it('aliases legacy "O" to canonical "M" (Mechanical)', () => {
    // Migration 023 renames the data-side 'O' rows to 'M', but the lib
    // alias keeps any unmigrated row rendering correctly in the brief
    // window between deploy and migration apply.
    const e = energyCodeFor('O')
    expect(e.code).toBe('M')
    expect(e.labelEn).toBe('Mechanical')
  })

  it('aliases legacy "OG" to canonical "CG" (Compressed Gas)', () => {
    const e = energyCodeFor('OG')
    expect(e.code).toBe('CG')
    expect(e.labelEn).toBe('Compressed Gas')
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

  it('every catalog code is independently resolvable', () => {
    for (const c of ENERGY_CODES) {
      expect(energyCodeFor(c.code).code).toBe(c.code)
    }
  })

  it('catalog covers the 12 Snak King canonical codes plus the None sentinel', () => {
    const codes = ENERGY_CODES.map(c => c.code).sort()
    expect(codes).toEqual(['CG','CP','E','G','GR','H','M','N','P','S','T','V','W'])
  })

  it('two codes use dark text (yellow Gas + white Control Panel); the rest use white text', () => {
    // Light-background codes need dark text for legibility. The rest
    // pair with white text on darker fills.
    const darkText = ENERGY_CODES.filter(c => c.textHex === '#1A1A1A').map(c => c.code).sort()
    expect(darkText).toEqual(['CP', 'G'])
    for (const c of ENERGY_CODES) {
      if (c.code === 'G' || c.code === 'CP') continue
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
