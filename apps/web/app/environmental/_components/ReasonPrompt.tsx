'use client'

import { useState } from 'react'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT } from './formStyles'

// Asks for the reason behind a change the register keeps forever: retiring
// an aspect, an issue or an interested party. Retired rows keep their
// history, so the reason is required before the action runs.

export function ReasonPrompt({ explanation, label, placeholder, confirmLabel, onSubmit, onCancel }: {
  explanation:  string
  label:        string
  placeholder:  string
  confirmLabel: string
  onSubmit:     (reason: string) => Promise<unknown>
  onCancel:     () => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="text-xs text-amber-900 dark:text-amber-100">{explanation}</p>
      <textarea className={INPUT} rows={2} value={reason} onChange={e => setReason(e.target.value)}
        aria-label={label} placeholder={placeholder} />
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className={BUTTON_PRIMARY} disabled={saving || reason.trim().length === 0} onClick={async () => {
          setSaving(true)
          setError(null)
          try { await onSubmit(reason) }
          catch (err) { setError(err instanceof Error ? err.message : 'That did not work.') }
          finally { setSaving(false) }
        }}>{saving ? 'Saving…' : confirmLabel}</button>
      </div>
    </section>
  )
}
