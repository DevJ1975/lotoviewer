'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  JHA_FREQUENCIES,
  validateJhaCreateInput,
  type JhaFrequency,
} from '@soteria/core/jha'

// /jha/new — Minimal header-create form. Slice 3 ships the editor
// for steps / hazards / controls; slice 2 just lets an admin spin
// up the JHA shell so the rest of the team has something to view.

const FREQ_HELP: Record<JhaFrequency, string> = {
  continuous: 'Performed continuously throughout shift',
  daily:      'Once or more per shift',
  weekly:     'Routine weekly task',
  monthly:    'Routine monthly task',
  quarterly:  'Quarterly maintenance / inspection',
  annually:   'Performed once per year',
  as_needed:  'Triggered by an event (changeover, repair)',
}

export default function NewJhaPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  const [title,        setTitle]       = useState<string>('')
  const [description,  setDescription] = useState<string>('')
  const [location,     setLocation]    = useState<string>('')
  const [performedBy,  setPerformedBy] = useState<string>('')
  const [frequency,    setFrequency]   = useState<JhaFrequency | ''>('')

  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) { setError('No active tenant'); return }

    const validationError = validateJhaCreateInput({
      title,
      frequency: frequency as JhaFrequency,
    })
    if (validationError) { setError(validationError); return }

    setSubmitting(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch('/api/jha', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title:        title.trim(),
          description:  description.trim() || null,
          location:     location.trim() || null,
          performed_by: performedBy.trim() || null,
          frequency,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/jha/${body.jha.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link
        href="/jha"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to JHAs
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New Job Hazard Analysis</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Set up the header. Steps, hazards, and controls are added on the detail page.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Title" required hint="A short name for the task — e.g. 'Conveyor belt changeover'.">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Description" hint="Optional. Why this task gets a JHA, scope, references.">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Location">
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Line 3 packaging"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Performed by">
            <input
              type="text"
              value={performedBy}
              onChange={e => setPerformedBy(e.target.value)}
              placeholder="e.g. Maintenance crew, contractors"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <Field label="Frequency" required hint="How often is the task performed? Drives the review cadence.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {JHA_FREQUENCIES.map(f => (
              <label
                key={f}
                className={
                  'flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ' +
                  (frequency === f
                    ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600')
                }
              >
                <input
                  type="radio"
                  name="frequency"
                  value={f}
                  checked={frequency === f}
                  onChange={() => setFrequency(f)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-semibold capitalize text-slate-800 dark:text-slate-200">
                    {f.replace('_', ' ')}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{FREQ_HELP[f]}</p>
                </div>
              </label>
            ))}
          </div>
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/jha"
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-5 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create JHA
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
