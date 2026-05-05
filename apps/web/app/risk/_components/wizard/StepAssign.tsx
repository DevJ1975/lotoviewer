'use client'

import type { WizardState } from '@/lib/risk-wizard'
import MemberPicker from './MemberPicker'

// Wizard step 6 — Assign owner / reviewer / approver.
//
// Slice 4c upgrade: the slice-3 placeholder UUID textboxes were
// replaced with a MemberPicker that loads tenant_memberships from
// /api/risk/members. All three roles remain optional but are now
// pickable from the actual member list with full name + email.

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
      </div>

      <Field label="Owner (assigned_to)" hint="The person accountable for this risk.">
        <MemberPicker
          value={state.assigned_to}
          onChange={v => set('assigned_to', v)}
          placeholder="Unassigned — pick an owner"
        />
      </Field>

      <Field label="Reviewer" hint="Optional. The person who verifies controls were implemented.">
        <MemberPicker
          value={state.reviewer}
          onChange={v => set('reviewer', v)}
          placeholder="Unassigned — pick a reviewer"
        />
      </Field>

      <Field label="Approver" hint="Optional. The authority who can accept the residual risk per PDD §4.5 (e.g. site manager for High, executive for Extreme).">
        <MemberPicker
          value={state.approver}
          onChange={v => set('approver', v)}
          placeholder="Unassigned — pick an approver"
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
