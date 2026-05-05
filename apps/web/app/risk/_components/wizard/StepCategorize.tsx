'use client'

import type { WizardState } from '@/lib/risk-wizard'
import type { HazardCategory } from '@soteria/core/queries/risks'

// Wizard step 2 — Categorize the hazard. Aligns with PDD §5.2 +
// ISO 45001 6.1.2.1 (psychosocial is required, not optional).

interface Props {
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}

const CATEGORIES: { id: HazardCategory; label: string; subtitle: string }[] = [
  { id: 'physical',      label: 'Physical',      subtitle: 'Noise, vibration, heat, slips/trips/falls' },
  { id: 'chemical',      label: 'Chemical',      subtitle: 'Toxic, corrosive, flammable, reactive' },
  { id: 'biological',    label: 'Biological',    subtitle: 'Bloodborne, infectious, allergens' },
  { id: 'mechanical',    label: 'Mechanical',    subtitle: 'Struck-by, caught-in, crush, pinch' },
  { id: 'electrical',    label: 'Electrical',    subtitle: 'Shock, arc flash, static' },
  { id: 'ergonomic',     label: 'Ergonomic',     subtitle: 'Lifting, repetition, posture' },
  { id: 'psychosocial',  label: 'Psychosocial',  subtitle: 'Stress, harassment, workload (ISO 45001-required)' },
  { id: 'environmental', label: 'Environmental', subtitle: 'Releases, contamination, waste' },
  { id: 'radiological',  label: 'Radiological',  subtitle: 'Ionizing or non-ionizing' },
]

const ACTIVITY_TYPES: { id: WizardState['activity_type']; label: string }[] = [
  { id: 'routine',     label: 'Routine' },
  { id: 'non_routine', label: 'Non-routine' },
  { id: 'emergency',   label: 'Emergency' },
]

const FREQUENCIES: { id: WizardState['exposure_frequency']; label: string }[] = [
  { id: 'continuous', label: 'Continuous' },
  { id: 'daily',      label: 'Daily' },
  { id: 'weekly',     label: 'Weekly' },
  { id: 'monthly',    label: 'Monthly' },
  { id: 'rare',       label: 'Rare' },
]

export default function StepCategorize({ state, set }: Props) {
  function toggleAffected(key: keyof WizardState['affected_personnel']) {
    set('affected_personnel', { ...state.affected_personnel, [key]: !state.affected_personnel[key] })
  }

  return (
    <div className="space-y-5">
      <Field label="Hazard category" required>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CATEGORIES.map(c => {
            const active = state.hazard_category === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => set('hazard_category', c.id)}
                className={
                  'text-left rounded-lg border px-3 py-2 transition-colors ' +
                  (active
                    ? 'bg-brand-navy/5 dark:bg-brand-navy/20 border-brand-navy text-slate-900 dark:text-slate-100'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600')
                }
              >
                <div className="text-sm font-semibold">{c.label}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{c.subtitle}</div>
              </button>
            )
          })}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Location">
          <input
            type="text"
            value={state.location}
            onChange={e => set('location', e.target.value)}
            placeholder="e.g. Dock 4, Building B"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Process">
          <input
            type="text"
            value={state.process}
            onChange={e => set('process', e.target.value)}
            placeholder="e.g. Shipping & receiving"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Activity type">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-full">
            {ACTIVITY_TYPES.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => set('activity_type', a.id)}
                className={
                  'flex-1 text-xs px-3 py-2 transition-colors ' +
                  (state.activity_type === a.id
                    ? 'bg-brand-navy text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')
                }
              >
                {a.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Exposure frequency">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-full">
            {FREQUENCIES.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => set('exposure_frequency', f.id)}
                className={
                  'flex-1 text-xs px-2 py-2 transition-colors ' +
                  (state.exposure_frequency === f.id
                    ? 'bg-brand-navy text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Affected personnel" hint="Tap each group exposed to the hazard.">
        <div className="flex flex-wrap gap-2">
          {(['workers', 'contractors', 'visitors', 'public'] as const).map(k => {
            const active = state.affected_personnel[k]
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleAffected(k)}
                className={
                  'text-xs px-3 py-1.5 rounded-md border capitalize transition-colors ' +
                  (active
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700')
                }
              >
                {k}
              </button>
            )
          })}
        </div>
      </Field>
    </div>
  )
}

function Field({
  label, hint, required, children,
}: {
  label:     string
  hint?:     string
  required?: boolean
  children:  React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
        {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}
