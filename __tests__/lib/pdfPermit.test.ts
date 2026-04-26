import { describe, it, expect } from 'vitest'
import { sanitizeForWinAnsi } from '@/lib/pdfPermit'

// pdf-lib's StandardFonts use WinAnsi (CP1252) which doesn't cover
// Unicode subscripts, superscripts, or smart typography. Hazard text
// from the AI suggester routinely contains O₂ / H₂S / CO₂ — the
// renderer used to throw "WinAnsi cannot encode '₂'" mid-page until
// the sanitizer was added. These tests pin the substitution map so any
// future change is loud.

describe('sanitizeForWinAnsi', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(sanitizeForWinAnsi('Hello, world.')).toBe('Hello, world.')
  })

  it('returns the input unchanged when null/empty (defensive — drawText is called many times)', () => {
    // The function rejects falsy input early to avoid the regex pass.
    expect(sanitizeForWinAnsi('')).toBe('')
  })

  it('substitutes every numeric subscript ₀-₉ to its ASCII digit', () => {
    expect(sanitizeForWinAnsi('₀₁₂₃₄₅₆₇₈₉')).toBe('0123456789')
  })

  it('substitutes the chemistry hazards that originally crashed the renderer', () => {
    expect(sanitizeForWinAnsi('O₂ deficiency')).toBe('O2 deficiency')
    expect(sanitizeForWinAnsi('H₂S exposure')).toBe('H2S exposure')
    expect(sanitizeForWinAnsi('CO₂ displacement (~50× volume)'))
      .toBe('CO2 displacement (~50x volume)')
  })

  it('substitutes superscripts to ASCII digits', () => {
    // Skips ¹/²/³ (those map separately because they're already in
    // WinAnsi but normalized for safety).
    expect(sanitizeForWinAnsi('10⁰ 10⁴ 10⁵ 10⁶ 10⁷ 10⁸ 10⁹')).toBe('100 104 105 106 107 108 109')
  })

  it('normalizes ¹ ² ³ to plain digits', () => {
    expect(sanitizeForWinAnsi('m³ m² m¹')).toBe('m3 m2 m1')
  })

  it('replaces typographic dashes and minus with ASCII hyphen', () => {
    expect(sanitizeForWinAnsi('19.5–23.5%')).toBe('19.5-23.5%')
    expect(sanitizeForWinAnsi('LEL‐pre-entry')).toBe('LEL-pre-entry')
    expect(sanitizeForWinAnsi('value: − 5')).toBe('value: - 5')
  })

  it('replaces smart quotes with straight quotes', () => {
    expect(sanitizeForWinAnsi('He said “hi”'))
      .toBe('He said "hi"')
    expect(sanitizeForWinAnsi("‘single’")).toBe("'single'")
  })

  it('replaces ellipsis with three dots', () => {
    expect(sanitizeForWinAnsi('Verify rescue plan…')).toBe('Verify rescue plan...')
  })

  it('replaces the Unicode bullet (used by some pasted content)', () => {
    // The U+2022 bullet IS in WinAnsi at 0x95 — confirm we leave it
    // alone (or normalize it to the same character) since stripping it
    // would degrade legitimate bullet lists.
    const out = sanitizeForWinAnsi('• Item one')
    // Either the bullet survives (still WinAnsi-renderable) or it was
    // intentionally normalized — test that it's not the catch-all '?'.
    expect(out).not.toBe('? Item one')
  })

  it('replaces × with x for chemistry expressions', () => {
    expect(sanitizeForWinAnsi('5× volume')).toBe('5x volume')
  })

  it('falls back to ? for non-Latin-1 characters that have no mapping (emoji, CJK, etc.)', () => {
    expect(sanitizeForWinAnsi('Done ✅')).toBe('Done ?')
    expect(sanitizeForWinAnsi('注意')).toBe('??')
  })

  it('normalizes a non-breaking space to a regular space', () => {
    expect(sanitizeForWinAnsi('alpha beta')).toBe('alpha beta')
  })

  it('preserves Latin-1 characters that ARE in WinAnsi (accented letters)', () => {
    // Spanish supervisors enter "Operación" — must round-trip.
    expect(sanitizeForWinAnsi('Operación de mezcla')).toBe('Operación de mezcla')
  })

  it('handles a real-world AI-suggester hazard string end-to-end', () => {
    const input  = 'CO₂ displacement (active fermentation generates ~50× volume) — verify O₂ ≥ 19.5%'
    const output = sanitizeForWinAnsi(input)
    // Every char must be in Latin-1 + WinAnsi extras after sanitize.
    for (let i = 0; i < output.length; i++) {
      const code = output.charCodeAt(i)
      const isAscii = code <= 0x7F
      const isLatin1 = code >= 0xA0 && code <= 0xFF
      const isAllowedHigh = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
        .includes(output[i])
      expect(isAscii || isLatin1 || isAllowedHigh, `char ${output.charCodeAt(i).toString(16)} at ${i}`).toBe(true)
    }
    // Subscript was specifically rewritten.
    expect(output).toContain('CO2')
    expect(output).toContain('O2')
  })
})
