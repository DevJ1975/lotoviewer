// Thin i18n helper. Reads JSON dictionaries shipped under
// `packages/core/src/i18n/strings.<lang>.json`. No `next-intl`, no
// build-time codegen — just an exported `t()` that takes a key + a
// language and returns the translated string.
//
// Fallback: if the requested key is missing in the target language,
// we fall back to English. If it's missing in English too, we return
// the raw key so the missing translation is visible (not silently
// blank). This matches the principle "make illegal states observable
// even when they're not preventable".

import en from './i18n/strings.en.json'
import es from './i18n/strings.es.json'
import fr from './i18n/strings.fr.json'

export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr'] as const
export type Language = typeof SUPPORTED_LANGUAGES[number]

type StringDictionary = Record<string, string>

const DICTIONARIES: Record<Language, StringDictionary> = {
  en: en as StringDictionary,
  es: es as StringDictionary,
  fr: fr as StringDictionary,
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
}

/**
 * Translate a key for a given language. Missing key → English
 * fallback → raw key. Pure and deterministic.
 */
export function t(key: string, lang: Language | string | null | undefined): string {
  const target: Language = isSupportedLanguage(lang) ? lang : 'en'
  const direct = DICTIONARIES[target][key]
  if (direct !== undefined) return direct
  // English fallback for missing translations.
  const fallback = DICTIONARIES.en[key]
  if (fallback !== undefined) return fallback
  // Last-ditch: the key itself, so a missing entry is visible in the UI.
  return key
}

/**
 * Type guard for a runtime language value. Used at the env / DB / URL
 * boundary where the language is a string and we need it to be one
 * of our supported codes.
 */
export function isSupportedLanguage(lang: unknown): lang is Language {
  return typeof lang === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
}

/**
 * Normalize a possibly-unknown language code to a supported value.
 * Returns 'en' for anything we don't support. Saves callers from
 * repeating the guard at every read site.
 */
export function normalizeLanguage(lang: unknown): Language {
  return isSupportedLanguage(lang) ? lang : 'en'
}
