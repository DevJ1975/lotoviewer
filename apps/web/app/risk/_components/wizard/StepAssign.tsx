'use client'

import type { WizardState } from '@/lib/risk-wizard'

// Wizard step 6 — Assign owner / reviewer / approver.
// All three are optional UUIDs. Slice 4 will replace these with a
// member-picker that resolves emails/names; for slice 3 we accept
// raw UUIDs (a SQL-known auth.users id) so the wizard can submit
// without blocking on a UI dependency we haven't built yet.

interface Props {
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}

export default function StepAssign({ state, set }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
        Single accountable person per ISO 45001 5.3 + IIPP §3203(a)(1).
        Reviewer + approver are optional but recommended for High/Extreme risks.
        {' '}
        <span className="text-slate-500 dark:text-slate-400">
          Slice-3 placeholder: paste user UUIDs. A member-picker UI is coming in slice 4.
        </span>
      </div>

      <Field label="Owner (assigned_to)" hint="UUID of the person accountable for this risk.">
        <input
          type="text"
          value={state.assigned_to}
          onChange={e => set('assigned_to', e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        />
      </Field>

      <Field label="Reviewer" hint="Optional. The person who reviews + verifies the controls were implemented.">
        <input
          type="text"
          value={state.reviewer}
          onChange={e => set('reviewer', e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        />
      </Field>

      <Field label="Approver" hint="Optional. The authority who can accept the residual risk per PDD §4.5 (e.g. site manager for High, executive for Extreme).">
        <input
          type="text"
          value={state.approver}
          onChange={e => set('approver', e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        />
      </Field>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}
