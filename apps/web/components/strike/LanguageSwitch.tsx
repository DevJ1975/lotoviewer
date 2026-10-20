'use client'

import { Languages } from 'lucide-react'
import { STRIKE_LOCALE_LABEL, isStrikeLocale } from './player/copy'

// English | Español, shown only when the module is published in more than
// one language. Labels are each language's own name, so a worker who reads
// only Spanish can find theirs.
export function LanguageSwitch({ locales, value, onChange }: { locales: string[]; value: string; onChange: (locale: string) => void }) {
  const choices = locales.filter(isStrikeLocale)
  if (choices.length < 2) return null
  return (
    <div role="radiogroup" aria-label="Language / Idioma" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
      <Languages className="ml-1.5 h-4 w-4 text-slate-500" aria-hidden />
      {choices.map(locale => (
        <button key={locale} type="button" role="radio" aria-checked={value === locale} lang={locale} onClick={() => onChange(locale)}
          className={`min-h-11 rounded-md px-3 text-sm font-semibold ${value === locale ? 'bg-brand-navy text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
          {STRIKE_LOCALE_LABEL[locale]}
        </button>
      ))}
    </div>
  )
}
