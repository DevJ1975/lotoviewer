'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { RiskStatus } from '@soteria/core/queries/risks'

// Admin-only PATCH actions on the risk detail page.
// Three actions in slice 2:
//   1. Change status (PATCH /api/risk/[id])
//   2. Mark reviewed (POST /api/risk/[id]/reviews)
//   3. (Slice 3 ships: re-score, reassign owner, edit controls)
//
// All actions auth-gate at the API; the dropdown buttons surface
// the path so admins know what's available.

interface Props {
  riskId:        string
  currentStatus: RiskStatus
  /** Whether the active user has admin/owner role (server-checked at PATCH; this just dims the UI). */
  canEdit:       boolean
}

const STATUSES: { id: RiskStatus; label: string }[] = [
  { id: 'open',                  label: 'Open' },
  { id: 'in_review',             label: 'In review' },
  { id: 'controls_in_progress',  label: 'Controls in progress' },
  { id: 'monitoring',            label: 'Monitoring' },
  { id: 'closed',                label: 'Closed' },
  { id: 'accepted_exception',    label: 'Accepted (exception)' },
]

export default function RiskQuickActions({ riskId, currentStatus, canEdit }: Props) {
  const router = useRouter()
  const { tenant } = useTenant()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)

  async function changeStatus(next: RiskStatus) {
    if (busy || next === currentStatus) { setShowStatusMenu(false); return }
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/risk/${riskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':     'application/json',
          authorization:      `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant':  tenant?.id ?? '',
        },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setShowStatusMenu(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitReview(notes: string) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/risk/${riskId}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          authorization:      `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant':  tenant?.id ?? '',
        },
        body: JSON.stringify({ trigger: 'manual', outcome: 'no_change', notes }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setShowReviewModal(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowStatusMenu(s => !s)}
            className="text-xs font-semibold inline-flex items-center gap-1 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            Change status <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showStatusMenu && (
            <div className="absolute z-10 right-0 mt-1 w-56 bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {STATUSES.map(s => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy || s.id === currentStatus}
                  onClick={() => void changeStatus(s.id)}
                  className={
                    'w-full text-left text-xs px-3 py-2 transition-colors ' +
                    (s.id === currentStatus
                      ? 'bg-slate-50 dark:bg-slate-800 text-slate-400 cursor-default'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200')
                  }
                >
                  {s.label}
                  {s.id === currentStatus && <span className="ml-1 text-[10px] uppercase tracking-wider">current</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => setShowReviewModal(true)}
          className="text-xs font-semibold inline-flex items-center gap-1 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Mark reviewed
        </button>
      </div>

      {error && <p className="text-xs text-rose-700 bg-rose-50 px-2 py-1 rounded">{error}</p>}

      {showReviewModal && (
        <ReviewModal
          busy={busy}
          onCancel={() => setShowReviewModal(false)}
          onSubmit={submitReview}
        />
      )}
    </div>
  )
}

function ReviewModal({
  busy, onCancel, onSubmit,
}: {
  busy:     boolean
  onCancel: () => void
  onSubmit: (notes: string) => void
}) {
  const [notes, setNotes] = useState('')
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onCancel}>
      <form
        onSubmit={e => { e.preventDefault(); onSubmit(notes) }}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full p-6 space-y-3"
      >
        <h3 className="text-lg font-bold">Mark this risk reviewed</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Records a review event in the audit log and bumps the next-review date by the cadence appropriate to the current band.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="What did you check? What did you find?"
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-navy text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-brand-navy/90"
          >
            {busy ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      </form>
    </div>
  )
}
