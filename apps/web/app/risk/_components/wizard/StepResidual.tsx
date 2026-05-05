'use client'

import { useTenant } from '@/components/TenantProvider'
import {
  bandFor,
  isResidualAcceptable,
  readRiskConfig,
  scoreRisk,
} from '@soteria/core/risk'
import type { WizardState } from '@/lib/risk-wizard'
import ScorePicker from './ScorePicker'

// Wizard step 5 — score the RESIDUAL risk (with controls applied).
// Optional in slice 3 — user can skip and re-score later. When set,
// we surface the acceptance check (PDD §4.6 default ≤6).

interface Props {
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}

export default function StepResidual({ state, set }: Props) {
  const { tenant } = useTenant()
  const { bandScheme, acceptanceThreshold } = readRiskConfig(tenant?.settings ?? null)

  const inherentScore = state.inherent_severity * state.inherent_likelihood
  const residualSet = state.residual_severity > 0 && state.residual_likelihood > 0
  const residualScore = residualSet
    ? scoreRisk(state.residual_severity, state.residual_likelihood)
    : null
  const residualBand = residualScore != null ? bandFor(residualScore, bandScheme) : null
  const acceptable = residualSet ? isResidualAcceptable(residualScore, acceptanceThreshold) : null

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
        <strong>Score the risk WITH the controls you just selected.</strong>
        {' '}This is optional at create time — you can come back to score residual after controls are implemented.
        {residualSet && acceptable === false && (
          <div className="mt-1 text-amber-700 dark:text-amber-400 font-semibold">
            Residual ({residualScore}) is above the acceptance threshold (≤ {acceptanceThreshold}).
            The risk can't be marked Closed until residual is reduced — additional controls or
            an exception approval will be required.
          </div>
        )}
        {residualSet && acceptable === true && residualScore != null && (
          <div className="mt-1 text-emerald-700 dark:text-emerald-400 font-semibold">
            Residual ({residualScore}) is within the acceptance threshold (≤ {acceptanceThreshold}).
            {residualBand !== null && inherentScore > residualScore && (
              <> Risk reduced from {inherentScore} → {residualScore}.</>
            )}
          </div>
        )}
      </div>

      <ScorePicker
        severity={state.residual_severity}
        likelihood={state.residual_likelihood}
        onChangeSeverity={v   => set('residual_severity',   v)}
        onChangeLikelihood={v => set('residual_likelihood', v)}
        bandScheme={bandScheme}
        allowSkip
      />
    </div>
  )
}
