'use client'

import { useEffect } from 'react'
import { useTenant } from '@/components/TenantProvider'
import {
  bandFor,
  reviewCadenceDays,
  readRiskConfig,
} from '@soteria/core/risk'
import type { WizardState } from '@/lib/risk-wizard'

// Wizard step 7 — Review cadence (next_review_date).
//
// Auto-defaults to today + cadence(band), where band uses the
// residual band when present, falling back to inherent. Per PDD §6.3:
//   extreme:  90 days
//   high:    180 days
//   moderate: 365 days
//   low:     730 days
//
// User can override the suggested date but the validator requires a
// non-past, well-formed YYYY-MM-DD before submit.

interface Props {
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}

export default function StepReview({ state, set }: Props) {
  const { tenant } = useTenant()
  const { bandScheme } = readRiskConfig(tenant?.settings ?? null)

  const inherentScore = state.inherent_severity * state.inherent_likelihood
  const residualSet   = state.residual_severity > 0 && state.residual_likelihood > 0
  const residualScore = residualSet ? state.residual_severity * state.residual_likelihood : null

  // Use residual band when present (matches the Mark-Reviewed cadence
  // on the detail page); else fall back to inherent.
  const band = residualScore != null
    ? bandFor(residualScore, bandScheme)
    : (inherentScore > 0 ? bandFor(inherentScore, bandScheme) : null)

  const cadenceDays = band ? reviewCadenceDays(band) : null

  // Auto-fill the date the first time the user reaches this step
  // (when the field is still blank). Don't clobber a user-edited
  // value.
  useEffect(() => {
    if (state.next_review_date) return
    if (cadenceDays == null) return
    const d = new Date(Date.now() + cadenceDays * 86_400_000).toISOString().slice(0, 10)
    set('next_review_date', d)
  }, [state.next_review_date, cadenceDays, set])

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
        Per PDD §6.3, review cadence is band-driven:
        {' '}
        <strong>Extreme</strong> 90 days · <strong>High</strong> 180 days
        · <strong>Moderate</strong> annually · <strong>Low</strong> 2 years.
        We've pre-filled today + cadence based on the
        {' '}
        {residualScore != null ? <strong>residual</strong> : <strong>inherent</strong>}
        {' '}band ({band ?? 'unset'}); change it if your program calls for a tighter window.
      </div>

      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
          Next review date
        </label>
        <input
          type="date"
          value={state.next_review_date}
          onChange={e => set('next_review_date', e.target.value)}
          className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          {cadenceDays != null
            ? `Default: ${cadenceDays} days from today.`
            : 'Pick the inherent score first to see the default cadence.'}
        </p>
      </div>
    </div>
  )
}
