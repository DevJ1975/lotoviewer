'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { CancelReason, ConfinedSpacePermit } from '@soteria/core/types'
import { CANCEL_REASON_LABELS } from '@soteria/core/confinedSpaceLabels'

interface CancelProps {
  permit:          ConfinedSpacePermit
  initialReason:   CancelReason
  // Whether a pre_entry atmospheric test exists on this permit. Drives the
  // §1910.146(d)(5) compliance warning — closing out a permit that never
  // had a pre-entry test is non-compliant and the supervisor should know.
  hasPreEntryTest: boolean
  onClose:         () => void
  onCanceled:      (updated: ConfinedSpacePermit) => void
}

export function CancelDialog({ permit, initialReason, hasPreEntryTest, onClose, onCanceled }: CancelProps) {
  const [reason, setReason]       = useState<CancelReason>(initialReason)
  const [notes, setNotes]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const requiresNotes = reason !== 'task_complete'
  // Surface the missing-pre-entry-test warning whenever it applies, not just
  // for `expired`. A `task_complete` cancellation on a permit that never had
  // a pre-entry test is just as non-compliant.
  const showPreEntryWarning = !hasPreEntryTest

  async function submit() {
    if (requiresNotes && !notes.trim()) {
      setError('Please describe the situation when canceling for this reason.')
      return
    }
    setSubmitting(true)
    setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_permits')
      .update({
        canceled_at:   now,
        cancel_reason: reason,
        cancel_notes:  notes.trim() || null,
        updated_at:    now,
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    if (err || !data) {
      setError(formatSupabaseError(err, 'cancel'))
      setSubmitting(false)
      return
    }
    onCanceled(data as ConfinedSpacePermit)
  }

  // Dialog adapts to the chosen reason. task_complete is the normal
  // close-out flow (emerald submit, "Close out permit" wording);
  // anything else is a cancellation for cause and stays rose.
  const isCloseOut    = reason === 'task_complete'
  const dialogTitle   = isCloseOut ? 'Close out permit'    : 'Cancel permit'
  const submitLabel   = isCloseOut ? 'Close out'           : 'Cancel permit'
  const submittingLbl = isCloseOut ? 'Closing out…'        : 'Canceling…'
  const submitTone    = isCloseOut
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : 'bg-rose-600 hover:bg-rose-700'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{dialogTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reason</span>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as CancelReason)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              {Object.entries(CANCEL_REASON_LABELS).map(([k, label]) => (
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
                reason === 'prohibited_condition' ? 'What condition was detected? Was the space evacuated successfully?'
              : reason === 'expired'              ? 'Permit ran past expiration — describe the disposition.'
              : reason === 'other'                ? 'Describe the cancellation reason.'
              :                                     '(optional)'
              }
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>
        </div>

        {showPreEntryWarning && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
            <p className="font-bold mb-0.5">No pre-entry test on record</p>
            <p>
              §1910.146(d)(5) requires an atmospheric test before entry. This permit will
              close with that gap on the audit trail — note the disposition above so a
              future inspector understands why.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
          >
            Back
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={`px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40 transition-colors ${submitTone}`}
          >
            {submitting ? submittingLbl : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
