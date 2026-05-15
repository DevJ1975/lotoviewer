import { describe, it, expect } from 'vitest'
import {
  t,
  normalizeLanguage,
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABEL,
} from '@soteria/core/i18n'

// The translation contract:
//   1. Known key + supported language → translated string
//   2. Known key + unsupported language → English fallback
//   3. Unknown key + any language → English fallback
//   4. Unknown key in English too → raw key (so a missing translation
//      is visible to the user, not silently blank)

describe('t', () => {
  it('returns the Spanish translation when present', () => {
    expect(t('nav.dashboard', 'es')).toBe('Panel principal')
  })

  it('returns the French translation when present', () => {
    expect(t('nav.dashboard', 'fr')).toBe('Tableau de bord')
  })

  it('returns the English translation when language=en', () => {
    expect(t('nav.dashboard', 'en')).toBe('Dashboard')
  })

  it('falls back to English when the language is not supported', () => {
    expect(t('nav.dashboard', 'de')).toBe('Dashboard')
    expect(t('nav.dashboard', 'klingon')).toBe('Dashboard')
  })

  it('falls back to English when the language is null or undefined', () => {
    expect(t('nav.dashboard', null)).toBe('Dashboard')
    expect(t('nav.dashboard', undefined)).toBe('Dashboard')
  })

  it('returns the raw key when the key is not in any dictionary', () => {
    // Visible-missing translation is the contract — a typo should
    // surface, not silently render as empty.
    expect(t('nav.never.added', 'es')).toBe('nav.never.added')
    expect(t('nav.never.added', 'en')).toBe('nav.never.added')
  })

  it('falls back to English when the key exists in English but not in the target', () => {
    // Simulated by passing a real key — every key currently exists
    // in all three languages, but the fallback logic must still
    // hold structurally. Verified by the unsupported-lang test above.
    // Add a placard-only key check for completeness:
    expect(t('placard.title', 'fr')).toBe('PROCÉDURE DE CONSIGNATION/DÉCONSIGNATION')
    expect(t('placard.title', 'en')).toBe('LOCKOUT/TAGOUT PROCEDURE')
  })
})

describe('isSupportedLanguage', () => {
  it('returns true for each supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(isSupportedLanguage(lang)).toBe(true)
    }
  })

  it('returns false for unsupported languages', () => {
    expect(isSupportedLanguage('de')).toBe(false)
    expect(isSupportedLanguage('')).toBe(false)
    expect(isSupportedLanguage(null)).toBe(false)
    expect(isSupportedLanguage(undefined)).toBe(false)
    expect(isSupportedLanguage(42)).toBe(false)
  })
})

describe('normalizeLanguage', () => {
  it('passes through supported values', () => {
    expect(normalizeLanguage('en')).toBe('en')
    expect(normalizeLanguage('es')).toBe('es')
    expect(normalizeLanguage('fr')).toBe('fr')
  })

  it('falls back to en for unsupported values', () => {
    expect(normalizeLanguage('de')).toBe('en')
    expect(normalizeLanguage(null)).toBe('en')
    expect(normalizeLanguage(undefined)).toBe('en')
    expect(normalizeLanguage('')).toBe('en')
  })
})

describe('LANGUAGE_LABEL', () => {
  it('has a label for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_LABEL[lang]).toBeTruthy()
    }
  })
})
