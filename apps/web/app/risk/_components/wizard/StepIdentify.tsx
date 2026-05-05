'use client'

import type { WizardState } from '@/lib/risk-wizard'

// Wizard step 1 — Identify the hazard.
//   title:                short human-readable name
//   description:          when + where + how the hazard manifests
//   source:               PDD §5.3 identification method
//   source_ref_id:        optional uuid of the inspection / JSA / incident
//                         that surfaced the risk; soft FK only

interface Props {
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}

const SOURCES: { id: WizardState['source']; label: string; subtitle: string }[] = [
  { id: 'inspection',    label: 'Inspection',     subtitle: 'Workplace inspection or walk-around' },
  { id: 'jsa',           label: 'JSA / JHA',      subtitle: 'Job Safety Analysis' },
  { id: 'incident',      label: 'Incident',       subtitle: 'Recordable injury, illness, or near-miss' },
  { id: 'worker_report', label: 'Worker report',  subtitle: 'Anonymous channel per Cal/OSHA §3203(a)(3)' },
  { id: 'audit',         label: 'Audit',          subtitle: 'Internal or external audit finding' },
  { id: 'moc',           label: 'MOC',            subtitle: 'Management of Change re-evaluation' },
  { id: 'other',         label: 'Other',          subtitle: 'SDS review, manufacturer warning, regulatory change' },
]

export default function StepIdentify({ state, set }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="Title"
        hint="Short name for the hazard (e.g. “Forklift collision near loading dock”)"
        required
      >
        <input
          type="text"
          value={state.title}
          onChange={e => set('title', e.target.value)}
          placeholder="What is the hazard?"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </Field>

      <Field
        label="Description"
        hint="When, where, and how does the hazard occur? Who could be harmed? Include the kind of detail an inspector or new worker would need."
        required
      >
        <textarea
          value={state.description}
          onChange={e => set('description', e.target.value)}
          rows={5}
          placeholder="Workers entering the dock turn on foot have limited visibility of forklifts. The corner is blind on both sides; recent near-miss reported by a contractor in March."
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Source" hint="How was this hazard identified? PDD §5.3.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SOURCES.map(src => {
            const active = state.source === src.id
            return (
              <button
                key={src.id}
                type="button"
                onClick={() => set('source', src.id)}
                className={
                  'text-left rounded-lg border px-3 py-2 transition-colors ' +
                  (active
                    ? 'bg-brand-navy/5 dark:bg-brand-navy/20 border-brand-navy text-slate-900 dark:text-slate-100'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600')
                }
              >
                <div className="text-sm font-semibold">{src.label}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{src.subtitle}</div>
              </button>
            )
          })}
        </div>
      </Field>

      <Field
        label="Source reference (optional)"
        hint="UUID of the inspection / JSA / incident record this risk came from. Soft reference — leave blank if unknown."
      >
        <input
          type="text"
          value={state.source_ref_id}
          onChange={e => set('source_ref_id', e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        />
      </Field>
    </div>
  )
}

function Field({
  label, hint, required, children,
}: {
  label:    string
  hint?:    string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
        </label>
      </div>
      {children}
      {hint && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  )
}
