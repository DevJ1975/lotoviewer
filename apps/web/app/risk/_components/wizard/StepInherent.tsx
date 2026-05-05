'use client'

import { useTenant } from '@/components/TenantProvider'
import { readRiskConfig } from '@soteria/core/risk'
import type { WizardState } from '@/lib/risk-wizard'
import ScorePicker from './ScorePicker'

// Wizard step 3 — score the INHERENT risk (no controls applied).
// PDD §4.1 + §4.2 + §4.5. The score lives in DB-side generated
// columns once the risk row inserts; this picker just feeds the
// number into the wizard state.

interface Props {
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}

export default function StepInherent({ state, set }: Props) {
  const { tenant } = useTenant()
  const { bandScheme } = readRiskConfig(tenant?.settings ?? null)

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        <strong>Score the hazard as if no controls were in place</strong> — this is the “inherent” baseline against which we'll measure control effectiveness in step 5 (Residual).
      </div>

      <ScorePicker
        severity={state.inherent_severity}
        likelihood={state.inherent_likelihood}
        onChangeSeverity={v   => set('inherent_severity',   v)}
        onChangeLikelihood={v => set('inherent_likelihood', v)}
        bandScheme={bandScheme}
      />
    </div>
  )
}
