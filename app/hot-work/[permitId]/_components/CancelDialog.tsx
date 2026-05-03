'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { HotWorkCancelReason, HotWorkPermit } from '@/lib/types'
import { HOT_WORK_CANCEL_REASON_LABELS } from '@/lib/types'

// Cancel + close-out dialog. The same form covers all cancel reasons —
// the wording adapts (close-out vs. cancel-for-cause) so the supervisor
// gets the right call-to-action regardless of why they're closing the
// permit.

export function CancelDialog({
  permit, initialReason, onClose, onCanceled,
}: {
  permit:        HotWorkPermit
  initialReason: HotWorkCancelReason
  onClose:       () => void
  onCanceled:    (updated: HotWorkPermit) => void
}) {
  const [reason, setReason] = useState<HotWorkCancelReason>(initialReason)
  const [notes, setNotes]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  const requiresNotes = reason !== 'task_complete'
  const isCloseOut    = reason === 'task_complete'
  const dialogTitle   = isCloseOut ? 'Close out permit' : 'Cancel permit'
  const submitLabel   = isCloseOut ? 'Close out' : 'Cancel permit'
  const submitTone    = isCloseOut
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : reason === 'fire_observed' ? 'bg-rose-700 hover:bg-rose-800'
    : 'bg-rose-600 hover:bg-rose-700'

  async function submit() {
    if (requiresNotes && !notes.trim()) {
      setErr('Describe the situation when canceling for this reason.'); return
    }
    setBusy(true); setErr(null)
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('loto_hot_work_permits')
      .update({
        canceled_at:   now,
        cancel_reason: reason,
        cancel_notes:  notes.trim() || null,
        updated_at:    now,
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    setBusy(false)
    if (error || !data) { setErr(formatSupabaseError(error, 'save')); return }
    onCanceled(data as HotWorkPermit)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{dialogTitle}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none px-1">×</button>
        </header>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reason</span>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as HotWorkCancelReason)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              {Object.entries(HOT_WORK_CANCEL_REASON_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Notes {requiresNotes && <span className="text-rose-500">*</span>}
            </span>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={
                reason === 'fire_observed'    ? 'What was observed? Was the fire suppressed? Was emergency response activated?'
              : reason === 'unsafe_condition' ? 'What condition triggered the cancel? (sprinklers down, ignition near combustibles, etc.)'
              : reason === 'expired'          ? 'Permit ran past expiration — describe the disposition.'
              : reason === 'other'            ? 'Describe the close-out reason.'
              :                                 '(optional)'
              }
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>
        </div>
        {err && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200">Back</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={`px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40 transition-colors ${submitTone}`}
          >
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
