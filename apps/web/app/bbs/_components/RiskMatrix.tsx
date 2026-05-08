'use client'

import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import type { BBSSeverity, BBSLikelihood } from '@soteria/core/bbs'

// 3x3 risk matrix picker. Tap a cell to set both axes at once.
// Mobile-first — large tap targets.

interface Props {
  severity:    BBSSeverity | null
  likelihood:  BBSLikelihood | null
  onChange:    (sev: BBSSeverity, like: BBSLikelihood) => void
  disabled?:   boolean
}

const LEVELS: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']

const CELL_CLASS = (score: number) =>
  score <= 2 ? 'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-900 dark:text-emerald-100'
  : score <= 4 ? 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-100'
  :              'bg-rose-100  hover:bg-rose-200  dark:bg-rose-900/30  dark:hover:bg-rose-900/50  text-rose-900  dark:text-rose-100'

const NUM = { low: 1, medium: 2, high: 3 } as const

export function RiskMatrix({ severity, likelihood, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Likelihood →</span>
        <span>Severity ↓</span>
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-1 text-xs">
        <div />
        {LEVELS.map(l => (
          <div key={l} className="text-center font-medium text-slate-600 dark:text-slate-300 capitalize py-1">{l}</div>
        ))}
        {LEVELS.map(sev => (
          <Fragment key={`row-${sev}`}>
            <div className="font-medium text-slate-600 dark:text-slate-300 capitalize self-center pr-2 text-right">{sev}</div>
            {LEVELS.map(like => {
              const score = NUM[sev] * NUM[like]
              const selected = severity === sev && likelihood === like
              return (
                <button
                  key={`${sev}-${like}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(sev, like)}
                  className={cn(
                    'h-12 rounded font-semibold transition',
                    CELL_CLASS(score),
                    selected && 'ring-2 ring-slate-900 dark:ring-slate-100',
                    disabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {score}
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
