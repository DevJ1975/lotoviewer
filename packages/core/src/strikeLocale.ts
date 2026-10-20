// A STRIKE module can publish one version per language (strike_module_versions
// .locale). Learners pick a language; they always get the newest published
// version in it. Completions are per module, so a Spanish completion counts
// for every requirement an English one does.

export const STRIKE_DEFAULT_LOCALE = 'en'

/** Newest version per locale, from any list of published versions. */
export function latestVersionPerLocale<T extends { locale: string; version_number: number }>(versions: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>()
  for (const version of versions) {
    const current = latest.get(version.locale)
    if (!current || version.version_number > current.version_number) latest.set(version.locale, version)
  }
  return latest
}

/**
 * The language to show: the learner's choice when the module has it, else
 * English, else whatever the module was published in.
 */
export function pickStrikeLocale(available: readonly string[], preferred: string | null | undefined): string | null {
  if (available.length === 0) return null
  if (preferred && available.includes(preferred)) return preferred
  if (available.includes(STRIKE_DEFAULT_LOCALE)) return STRIKE_DEFAULT_LOCALE
  return [...available].sort()[0]
}
