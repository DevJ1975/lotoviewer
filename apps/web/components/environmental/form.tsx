import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

// Form pieces shared by the environmental screens, matching the native-control
// styling the other module forms use.

export const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/60 disabled:opacity-60'

export const primaryButtonCls =
  'inline-flex items-center justify-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60 dark:bg-brand-yellow dark:text-slate-900 dark:hover:bg-brand-yellow/90'

export const secondaryButtonCls =
  'inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}

/** Every problem the API reported, in one banner, so a form is fixed in one pass. */
export function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      {errors.length === 1 ? <span>{errors[0]}</span> : <ul className="list-disc pl-4">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
    </div>
  )
}
