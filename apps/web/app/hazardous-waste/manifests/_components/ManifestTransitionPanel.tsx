'use client'

import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import {
  MANIFEST_NOTE_MAX, MANIFEST_STATUS_IS_TERMINAL, MANIFEST_TRANSITIONS, availableManifestActions, type ManifestAction,
} from '@soteria/core/hazardousWasteManifest'
import {
  MANIFEST_ACTION_CONFIRM_LABEL, MANIFEST_ACTION_DATE_LABEL, MANIFEST_ACTION_LABEL, MANIFEST_STATUS_LABEL,
  containerEffectText, todayLocal, type ManifestDetail,
} from '@/lib/hazardousWasteManifestView'

// The moves open to a manifest in its status, each showing what it will do to the containers
// before it does it. Only the actions the status allows are offered, so there is no button to
// press that the database would refuse; the database refuses it anyway, and its words are
// shown if a race gets that far.

interface Props {
  manifest:     ManifestDetail
  onTransition: (action: ManifestAction, on: string | null, note: string | null) => Promise<void>
}

export function ManifestTransitionPanel({ manifest, onTransition }: Props) {
  const [open, setOpen]   = useState<ManifestAction | null>(null)
  const [on, setOn]       = useState(() => todayLocal())
  const [note, setNote]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!manifest.can_modify) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Only the person who drafted this manifest, or a tenant admin, can ship it, record the signed copy, file an exception report or cancel it.
      </p>
    )
  }

  const actions = availableManifestActions(manifest.status)
  if (actions.length === 0) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        This manifest is {MANIFEST_STATUS_LABEL[manifest.status].toLowerCase()}.
        {MANIFEST_STATUS_IS_TERMINAL[manifest.status] ? ' Nothing more can be done to it.' : ''}
      </p>
    )
  }

  const choose = (action: ManifestAction) => {
    setOpen(open === action ? null : action)
    setOn(todayLocal())
    setNote('')
    setError(null)
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (!open) return
    setBusy(true)
    setError(null)
    try {
      await onTransition(open, MANIFEST_TRANSITIONS[open].dateMeaning === null ? null : on, note.trim() || null)
      setOpen(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rule = open ? MANIFEST_TRANSITIONS[open] : null
  const dateLabel = open ? MANIFEST_ACTION_DATE_LABEL[open] : null
  const missingTrackingNumber = open === 'ship' && manifest.manifest_tracking_number === null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map(action => (
          <button
            key={action}
            type="button"
            aria-expanded={open === action}
            aria-controls="manifest-action-form"
            onClick={() => choose(action)}
            className={`rounded-md border px-3 py-2 text-sm font-semibold ${
              open === action
                ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                : action === 'cancel'
                  ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30'
                  : 'border-slate-300 text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {MANIFEST_ACTION_LABEL[action]}
          </button>
        ))}
      </div>

      {open && rule && (
        <form
          id="manifest-action-form"
          aria-label={MANIFEST_ACTION_LABEL[open]}
          onSubmit={confirm}
          className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
        >
          <p className="text-sm text-slate-800 dark:text-slate-100">
            The manifest becomes <strong>{MANIFEST_STATUS_LABEL[rule.to]}</strong>.{' '}
            {containerEffectText(open, manifest.containers.length)}
          </p>

          {missingTrackingNumber && (
            <p role="alert" className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Add the manifest tracking number to this draft before shipping it.
            </p>
          )}

          {dateLabel && (
            <div className="space-y-1">
              <label htmlFor="manifest-action-date" className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {dateLabel}
              </label>
              <input
                id="manifest-action-date" type="date" required value={on} onChange={e => setOn(e.target.value)}
                max={todayLocal()} min={manifest.shipped_on ?? undefined}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="manifest-action-note" className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Note (optional)
            </label>
            <textarea
              id="manifest-action-note" rows={2} maxLength={MANIFEST_NOTE_MAX} value={note} onChange={e => setNote(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || missingTrackingNumber || (dateLabel !== null && on === '')}
              className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {MANIFEST_ACTION_CONFIRM_LABEL[open]}
            </button>
            <button type="button" onClick={() => setOpen(null)} className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
              Never mind
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
