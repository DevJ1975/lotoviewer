'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// Modal that collects the two fields the near-miss can't supply
// (activity_type + exposure_frequency) and POSTs to the escalate
// route. On success, redirects to the new risk detail page.
//
// Shown only on near-misses that aren't already escalated; the
// detail page hides the trigger button otherwise.

interface Props {
  nearMissId: string
  onClose:    () => void
}

const ACTIVITY_TYPES = [
  { v: 'routine',     label: 'Routine',     hint: 'Part of normal operations' },
  { v: 'non_routine', label: 'Non-routine', hint: 'Maintenance, changeover, irregular task' },
  { v: 'emergency',   label: 'Emergency',   hint: 'Spill, fire, evacuation' },
] as const

const EXPOSURE_FREQS = [
  { v: 'continuous', label: 'Continuous' },
  { v: 'daily',      label: 'Daily' },
  { v: 'weekly',     label: 'Weekly' },
  { v: 'monthly',    label: 'Monthly' },
  { v: 'rare',       label: 'Rare' },
] as const

type ActivityType  = typeof ACTIVITY_TYPES[number]['v']
type ExposureFreq  = typeof EXPOSURE_FREQS[number]['v']

export default function EscalateModal({ nearMissId, onClose }: Props) {
  const router = useRouter()
  const { tenant } = useTenant()

  const [activity, setActivity] = useState<ActivityType | ''>('')
  const [exposure, setExposure] = useState<ExposureFreq | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) { setError('No active tenant'); return }
    if (!activity || !exposure) { setError('Both fields are required'); return }

    setSubmitting(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch(`/api/near-miss/${nearMissId}/escalate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ activity_type: activity, exposure_frequency: exposure }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/risk/${body.risk.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Escalate to Risk Register
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Creates a linked risk entry and closes this report.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={onSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Activity type <span className="text-rose-600">*</span>
            </label>
            <div className="space-y-2">
              {ACTIVITY_TYPES.map(t => (
                <label
                  key={t.v}
                  className={
                    'flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer ' +
                    (activity === t.v
                      ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400')
                  }
                >
                  <input type="radio" name="activity" value={t.v} checked={activity === t.v}
                    onChange={() => setActivity(t.v)} className="mt-1" />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t.label}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.hint}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Exposure frequency <span className="text-rose-600">*</span>
            </label>
            <select
              value={exposure}
              onChange={e => setExposure(e.target.value as ExposureFreq)}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="">Select frequency…</option>
              {EXPOSURE_FREQS.map(f => (
                <option key={f.v} value={f.v}>{f.label}</option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Severity is derived from the near-miss potential (you can re-score on the risk page).
          </p>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-5 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Escalate
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
