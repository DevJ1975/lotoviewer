'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  NEAR_MISS_HAZARD_CATEGORIES,
  NEAR_MISS_SEVERITY_BANDS,
  validateCreateInput,
  type NearMissHazardCategory,
  type NearMissSeverity,
} from '@soteria/core/nearMiss'

// /near-miss/new — Mobile-first capture form. Reporting is
// intentionally low-friction: any tenant member can file.
//
// Form state lives in component state. Two-column on desktop;
// stacks on mobile. Submit posts to /api/near-miss and redirects
// to the resulting detail page.

const SEVERITY_HELP: Record<NearMissSeverity, string> = {
  low:      'No injury possible',
  moderate: 'First-aid level injury possible',
  high:     'Lost-time injury possible',
  extreme:  'Life-threatening or fatal outcome possible',
}

function isoLocalNow() {
  // <input type="datetime-local"> wants 'YYYY-MM-DDTHH:mm' in *local*
  // time. JS Date toISOString returns UTC; we adjust for local offset
  // so the default value matches what the user is looking at.
  const d = new Date()
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

export default function NewNearMissPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  const [occurredAt,  setOccurredAt]  = useState<string>(isoLocalNow())
  const [location,    setLocation]    = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [immediate,   setImmediate]   = useState<string>('')
  const [hazard,      setHazard]      = useState<NearMissHazardCategory | ''>('')
  const [severity,    setSeverity]    = useState<NearMissSeverity | ''>('')

  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) {
      setError('No active tenant — refresh and try again.')
      return
    }

    // Convert datetime-local → ISO UTC for the API.
    const occurredIso = new Date(occurredAt).toISOString()

    const validationError = validateCreateInput({
      occurred_at:        occurredIso,
      description:        description,
      hazard_category:    hazard as NearMissHazardCategory,
      severity_potential: severity as NearMissSeverity,
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

      const res = await fetch('/api/near-miss', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          occurred_at:            occurredIso,
          location:               location.trim() || null,
          description:            description.trim(),
          immediate_action_taken: immediate.trim() || null,
          hazard_category:        hazard,
          severity_potential:     severity,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/near-miss/${body.report.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link
        href="/near-miss"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to reports
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Report a Near-Miss</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          An event that <em>almost</em> caused harm. The more detail you provide, the better we can prevent the next one.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="When did it happen?" required>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={e => setOccurredAt(e.target.value)}
              max={isoLocalNow()}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Location">
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Loading dock B, Line 3 packaging"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <Field label="What happened?" required>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the event in plain language. What was the worker doing? What almost went wrong?"
            rows={4}
            required
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Hazard category" required>
          <select
            value={hazard}
            onChange={e => setHazard(e.target.value as NearMissHazardCategory)}
            required
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm capitalize"
          >
            <option value="">Select a category…</option>
            {NEAR_MISS_HAZARD_CATEGORIES.map(c => (
              <option key={c} value={c} className="capitalize">{c}</option>
            ))}
          </select>
        </Field>

        <Field label="Severity potential" required hint="What's the worst that could have happened?">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {NEAR_MISS_SEVERITY_BANDS.map(s => (
              <label
                key={s}
                className={
                  'flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ' +
                  (severity === s
                    ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600')
                }
              >
                <input
                  type="radio"
                  name="severity"
                  value={s}
                  checked={severity === s}
                  onChange={() => setSeverity(s)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-semibold capitalize text-slate-800 dark:text-slate-200">{s}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{SEVERITY_HELP[s]}</p>
                </div>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Immediate action taken" hint="Optional: what was done in the moment to prevent harm?">
          <textarea
            value={immediate}
            onChange={e => setImmediate(e.target.value)}
            placeholder="e.g. Stopped the line, taped off the spill, called supervisor."
            rows={2}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/near-miss"
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
            Submit report
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
