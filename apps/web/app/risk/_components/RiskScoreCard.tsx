'use client'

import { RiskBandPill } from '@/components/ui/RiskBandPill'
import {
  isResidualAcceptable,
  type Band,
  type BandScheme,
  SEVERITY_LABELS,
  LIKELIHOOD_LABELS,
} from '@soteria/core/risk'

// Side-by-side Inherent + Residual score cards on the risk detail
// page. Each card shows severity × likelihood = score with its band
// pill, plus a small badge indicating whether the residual passes
// the tenant's acceptance threshold.

interface Props {
  inherent: {
    severity:   number
    likelihood: number
    score:      number
    band:       Band
  }
  residual: {
    severity:   number | null
    likelihood: number | null
    score:      number | null
    band:       Band | null
  }
  bandScheme:          BandScheme
  acceptanceThreshold: number
}

export default function RiskScoreCard({ inherent, residual, bandScheme: _scheme, acceptanceThreshold }: Props) {
  const residualSet = residual.band != null && residual.score != null
  const acceptable  = residualSet ? isResidualAcceptable(residual.score, acceptanceThreshold) : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <ScorePanel
        label="Inherent (no controls)"
        severity={inherent.severity}
        likelihood={inherent.likelihood}
        score={inherent.score}
        band={inherent.band}
      />
      {residualSet ? (
        <ScorePanel
          label="Residual (with controls)"
          severity={residual.severity!}
          likelihood={residual.likelihood!}
          score={residual.score!}
          band={residual.band!}
          subText={
            acceptable
              ? `Within acceptance threshold (≤ ${acceptanceThreshold})`
              : `Above acceptance threshold (≤ ${acceptanceThreshold})`
          }
          subTone={acceptable ? 'ok' : 'warn'}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 flex items-center justify-center text-center text-xs text-slate-400 italic">
          Residual not yet scored. Score this after controls are documented.
        </div>
      )}
    </div>
  )
}

function ScorePanel({
  label, severity, likelihood, score, band, subText, subTone,
}: {
  label:       string
  severity:    number
  likelihood:  number
  score:       number
  band:        Band
  subText?:    string
  subTone?:    'ok' | 'warn'
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100">
          {severity} × {likelihood} = {score}
        </div>
        <RiskBandPill band={band} score={score} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 text-[11px]">
        <div>
          <span className="text-slate-500 dark:text-slate-400">Severity:</span>{' '}
          <span className="font-semibold">{SEVERITY_LABELS[severity - 1]}</span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">Likelihood:</span>{' '}
          <span className="font-semibold">{LIKELIHOOD_LABELS[likelihood - 1]}</span>
        </div>
      </div>
      {subText && (
        <div className={
          'text-[11px] font-semibold ' +
          (subTone === 'ok'   ? 'text-emerald-700 dark:text-emerald-400' :
           subTone === 'warn' ? 'text-amber-700 dark:text-amber-400' :
           'text-slate-500')
        }>
          {subText}
        </div>
      )}
    </div>
  )
}
