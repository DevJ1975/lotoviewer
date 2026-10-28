import type { RegisterHealth } from '@soteria/core/managementSystem'
import { RegisterHealthBadge } from './RegisterHealthBadge'

// The line at the top of each register page: its traffic light and the
// counts behind it, so "why amber?" is answered without opening a report.

export interface HealthFact {
  label: string
  value: number | string
  /** Draws the eye when the count is something to act on. */
  warn?: boolean
}

export function RegisterHealthStrip({ title, health, facts }: {
  title: string
  health: RegisterHealth | null
  facts: HealthFact[]
}) {
  return (
    <section
      aria-label={`${title} register health`}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900"
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</span>
      {health && <RegisterHealthBadge health={health} />}
      {facts.map(fact => (
        <span key={fact.label} className="text-xs text-slate-600 dark:text-slate-300">
          <span className={`placard-numeric font-semibold ${fact.warn ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-slate-100'}`}>
            {fact.value}
          </span>{' '}
          {fact.label}
        </span>
      ))}
    </section>
  )
}
