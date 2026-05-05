'use client'

import { RiskBandPill } from '@/components/ui/RiskBandPill'
import {
  bandFor,
  scoreRisk,
  SEVERITY_LABELS,
  LIKELIHOOD_LABELS,
  type BandScheme,
  type Severity,
  type Likelihood,
} from '@soteria/core/risk'

// Reusable severity-and-likelihood picker. Used by:
//   - StepInherent (with allowSkip=false; user must score before next)
//   - StepResidual (with allowSkip=true; user can submit a 0/0 to mean
//                   "not yet scored — score later")
// Live-previews the resulting band pill so the user sees the
// classification update as they pick.

interface Props {
  severity:    0 | 1 | 2 | 3 | 4 | 5
  likelihood:  0 | 1 | 2 | 3 | 4 | 5
  onChangeSeverity:   (v: 0 | 1 | 2 | 3 | 4 | 5) => void
  onChangeLikelihood: (v: 0 | 1 | 2 | 3 | 4 | 5) => void
  bandScheme?: BandScheme
  allowSkip?:  boolean
  /**
   * Compact severity / likelihood descriptions to show next to each
   * radio. PDD §4.1 / §4.2 wording, condensed.
   */
  showHints?:  boolean
}

const SEVERITY_HINTS = [
  'First aid only, no lost time',
  'Medical treatment, restricted duty',
  'Lost-time injury, recordable',
  'Single fatality or permanent disability',
  'Multiple fatalities',
] as const

const LIKELIHOOD_HINTS = [
  '< 1 in 10 years (theoretical)',
  'Once in 5–10 years (industry has seen it)',
  'Once in 1–5 years (this org has seen it)',
  'Once per year (this site has seen it)',
  'Multiple times per year (recurring)',
] as const

export default function ScorePicker({
  severity, likelihood,
  onChangeSeverity, onChangeLikelihood,
  bandScheme = '4-band',
  allowSkip,
  showHints = true,
}: Props) {
  const score = severity > 0 && likelihood > 0 ? scoreRisk(severity, likelihood) : null
  const band  = score != null ? bandFor(score, bandScheme) : null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <Column
        title="Severity"
        subtitle="Worst-case consequence if it happens"
        labels={SEVERITY_LABELS}
        hints={showHints ? SEVERITY_HINTS : undefined}
        value={severity}
        onChange={onChangeSeverity}
        allowSkip={allowSkip}
      />
      <Column
        title="Likelihood"
        subtitle="How often we expect it to occur"
        labels={LIKELIHOOD_LABELS}
        hints={showHints ? LIKELIHOOD_HINTS : undefined}
        value={likelihood}
        onChange={onChangeLikelihood}
        allowSkip={allowSkip}
      />
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
          Live score
        </div>
        {score != null && band ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
            <div className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">
              {severity} × {likelihood} = {score}
            </div>
            <RiskBandPill band={band} score={score} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-xs text-slate-400">
            Pick severity + likelihood to preview the band.
          </div>
        )}
      </div>
    </div>
  )
}

interface ColumnProps<T extends number> {
  title:      string
  subtitle:   string
  labels:     readonly string[]
  hints?:     readonly string[]
  value:      T
  onChange:   (v: T) => void
  allowSkip?: boolean
}

function Column<T extends 0 | 1 | 2 | 3 | 4 | 5>({
  title, subtitle, labels, hints, value, onChange, allowSkip,
}: ColumnProps<T>) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-2">{subtitle}</div>
      <div className="space-y-1.5">
        {labels.map((label, i) => {
          const v = (i + 1) as T
          const active = value === v
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(v)}
              className={
                'w-full text-left rounded-lg border px-3 py-2 transition-colors ' +
                (active
                  ? 'bg-brand-navy/5 dark:bg-brand-navy/20 border-brand-navy text-slate-900 dark:text-slate-100'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600')
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{i + 1}. {label}</span>
              </div>
              {hints && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{hints[i]}</div>
              )}
            </button>
          )
        })}
        {allowSkip && (
          <button
            type="button"
            onClick={() => onChange(0 as T)}
            className={
              'w-full text-center rounded-lg border px-3 py-2 transition-colors text-xs italic ' +
              (value === 0
                ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
                : 'bg-white dark:bg-slate-800 border-dashed border-slate-300 dark:border-slate-700 text-slate-400 hover:border-slate-400 dark:hover:border-slate-600')
            }
          >
            Skip — score later
          </button>
        )}
      </div>
    </div>
  )
}
