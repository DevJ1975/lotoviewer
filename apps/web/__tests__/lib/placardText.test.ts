import { describe, expect, it } from 'vitest'
import { PLACARD_TEXT } from '@/lib/placardText'

// The placard renders on screen and through the PDF generator, in
// English and Spanish. These tests pin the bilingual contract: every
// key carries both languages with the same shape, no string is empty,
// and the step lists stay aligned (the PDF prints them side-by-side,
// double-sided — a length mismatch shears the translation off the
// procedure it translates).

type LangPair = { en: unknown; es: unknown }
const entries = Object.entries(PLACARD_TEXT) as Array<[string, LangPair]>

function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(flattenStrings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenStrings)
  return []
}

describe('PLACARD_TEXT', () => {
  it('provides en + es for every key', () => {
    for (const [key, pair] of entries) {
      expect(pair.en, `${key}.en missing`).toBeDefined()
      expect(pair.es, `${key}.es missing`).toBeDefined()
    }
  })

  it('keeps en and es the same shape (string↔string, array↔array of equal length)', () => {
    for (const [key, pair] of entries) {
      expect(Array.isArray(pair.es), `${key}: en/es shape mismatch`).toBe(Array.isArray(pair.en))
      if (Array.isArray(pair.en) && Array.isArray(pair.es)) {
        expect(pair.es.length, `${key}: step count differs between languages`).toBe(pair.en.length)
      }
      if (typeof pair.en === 'object' && !Array.isArray(pair.en) && pair.en !== null) {
        expect(Object.keys(pair.es as object).sort(), `${key}: subkeys differ`).toEqual(Object.keys(pair.en as object).sort())
      }
    }
  })

  it('contains no empty or whitespace-only strings', () => {
    for (const [key, pair] of entries) {
      for (const s of flattenStrings(pair)) {
        expect(s.trim().length, `${key} has a blank string`).toBeGreaterThan(0)
      }
    }
  })

  it('contains no characters the PDF generator cannot render (control chars, unpaired surrogates)', () => {
    for (const [key, pair] of entries) {
      for (const s of flattenStrings(pair)) {
        expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), `${key} contains a control character`).toBe(false)
        expect(s.includes('�'), `${key} contains a replacement character (broken encoding)`).toBe(false)
      }
    }
  })

  it('keeps the deprecated steps/stepsHeader aliases identical to the application wording', () => {
    expect(PLACARD_TEXT.steps).toEqual(PLACARD_TEXT.applicationSteps)
    expect(PLACARD_TEXT.stepsHeader).toEqual(PLACARD_TEXT.applicationHeader)
  })

  it('ships seven application steps and seven removal steps (1910.147 sequences)', () => {
    expect(PLACARD_TEXT.applicationSteps.en).toHaveLength(7)
    expect(PLACARD_TEXT.removalSteps.en).toHaveLength(7)
  })
})
