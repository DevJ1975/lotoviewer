'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

// Shared form layout for /admin/working-at-heights/*/new pages.
// Wraps the inputs in a consistent header + card + submit/cancel
// footer, and handles the busy spinner during inserts.

export interface FormShellProps {
  title:       string
  description: string
  Icon:        LucideIcon
  backHref:    string
  onSubmit:    () => Promise<void>
  children:    ReactNode
  /** Disable submit when required fields are empty. */
  canSubmit:   boolean
  /** Optional one-line server error surfaced above the submit button. */
  error?:      string | null
}

export function FormShell({
  title, description, Icon, backHref, onSubmit, children, canSubmit, error,
}: FormShellProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setLocalErr(null)
    try { await onSubmit() }
    catch (err) {
      setLocalErr(err instanceof Error ? err.message : 'Save failed.')
    } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href={backHref} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow">
        <ArrowLeft className="h-3.5 w-3.5" />
        Cancel
      </Link>
      <header className="mt-3 mb-5 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Working at Heights</p>
          <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50">{title}</h1>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{description}</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-4">{children}</div>

        {(error || localErr) && (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
            {error ?? localErr}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={() => router.push(backHref)} className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit || busy} className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-50 dark:bg-brand-yellow dark:text-slate-950 dark:hover:bg-brand-yellow/90">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </main>
  )
}

// ─── Field primitives ─────────────────────────────────────────────────────

export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}{required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">{hint}</p>}
    </label>
  )
}

const baseInput = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy dark:border-slate-700 dark:bg-slate-950 dark:focus:border-brand-yellow dark:focus:ring-brand-yellow'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={`${baseInput} ${props.className ?? ''}`} />
}
export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={`${baseInput} ${props.className ?? ''}`} />
}
export function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" {...props} className={`${baseInput} ${props.className ?? ''}`} />
}
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${baseInput} ${props.className ?? ''}`} />
}
export function Select({ options, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  return (
    <select {...rest} className={`${baseInput} ${rest.className ?? ''}`}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
export function Checkbox({ label, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      <input type="checkbox" {...rest} className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy/30" />
      {label}
    </label>
  )
}

export function TwoCol({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
}
