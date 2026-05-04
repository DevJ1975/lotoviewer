'use client'

import { useCallback, useEffect, useState } from 'react'
import { renameDepartment } from '@/lib/departments'

interface Props {
  currentName: string
  onClose:     () => void
  onRenamed:   (newName: string) => void
}

export default function RenameDepartmentModal({ currentName, onClose, onRenamed }: Props) {
  const [name, setName]             = useState(currentName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const trimmed   = name.trim()
  const unchanged = trimmed === currentName
  const isEmpty   = trimmed.length === 0
  const canSubmit = !isEmpty && !unchanged && !submitting

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await renameDepartment(currentName, trimmed)
      onRenamed(trimmed)
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Could not rename department.')
      setSubmitting(false)
    }
  }, [canSubmit, currentName, trimmed, onRenamed, onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget && !submitting) onClose() }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Rename Department</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{currentName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-xl leading-none disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block" htmlFor="rename-dept-input">
            New name <span className="text-rose-500">*</span>
          </label>
          <input
            id="rename-dept-input"
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            disabled={submitting}
            autoFocus
            placeholder="Department name"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-900/40 disabled:text-slate-500 dark:disabled:text-slate-400"
          />

          {isEmpty && (
            <p className="text-[11px] text-rose-500">Name cannot be empty.</p>
          )}

          {error && (
            <p className="text-sm text-rose-500 font-medium">{error}</p>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Every equipment row in{' '}
            <span className="font-medium text-slate-600 dark:text-slate-300">{currentName}</span>{' '}
            will be updated in a single bulk operation.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {submitting ? 'Renaming…' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  )
}
