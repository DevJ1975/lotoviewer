'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { ConfinedSpaceEntry, ConfinedSpacePermit } from '@/lib/types'
import { validateRosterUpdate, namesCurrentlyInside } from '@/lib/permitRoster'

// Mid-job add/remove of entrants and attendants. Validation lives in
// lib/permitRoster.ts so the rules ("can't remove someone currently
// inside") get unit-tested without React. The dialog reads the live
// entries list to compute who's inside; the inside-the-space check is
// the only hard error — everything else (blanks, dups, signed-off
// attendant being removed) is also enforced or warned.

export function EditRosterDialog({
  permit, entries, onClose, onSaved,
}: {
  permit:  ConfinedSpacePermit
  entries: ConfinedSpaceEntry[]
  onClose: () => void
  onSaved: (updated: ConfinedSpacePermit) => void
}) {
  const [entrants,   setEntrants]   = useState<string[]>(() => [...permit.entrants])
  const [attendants, setAttendants] = useState<string[]>(() => [...permit.attendants])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const inside = namesCurrentlyInside(entries)

  // Live validation as the user edits — surfaces blanks / dups / inside
  // violations on every keystroke. Save is gated on this list being empty
  // (filtering out the soft-warning prefix the helper emits).
  const issues = validateRosterUpdate({
    nextEntrants:        entrants.map(n => n.trim()).filter(n => n.length > 0).length === 0
      // Edge: empty entrants array shouldn't fail the "names cannot be
      // blank" check on a list with no rows. Pass an empty list through.
      ? entrants.filter(n => n.trim().length > 0)
      : entrants,
    nextAttendants:      attendants.filter(n => n.trim().length > 0),
    entries,
    signedAttendantName: permit.attendant_signature_name,
  })
  // Distinguish hard errors from the "heads up" soft warning.
  const hardErrors = issues.filter(e => !e.toLowerCase().startsWith('heads up'))
  const warnings   = issues.filter(e =>  e.toLowerCase().startsWith('heads up'))

  async function save() {
    if (hardErrors.length > 0) return
    setSubmitting(true)
    setError(null)
    const cleanEntrants   = entrants.map(n => n.trim()).filter(Boolean)
    const cleanAttendants = attendants.map(n => n.trim()).filter(Boolean)
    const { data, error: err } = await supabase
      .from('loto_confined_space_permits')
      .update({
        entrants:   cleanEntrants,
        attendants: cleanAttendants,
        updated_at: new Date().toISOString(),
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    setSubmitting(false)
    if (err || !data) { setError(formatSupabaseError(err, 'save roster')); return }
    onSaved(data as ConfinedSpacePermit)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 overflow-y-auto py-10">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit roster</h2>
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

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Add or remove entrants and attendants while the permit is active. An entrant
          who is currently inside the space cannot be removed — log them out from the
          Entrant Log first.
        </p>

        <NameListEditor
          label="Authorized entrants"
          values={entrants}
          onChange={setEntrants}
          locked={inside}
          lockedHint="currently inside"
        />
        <NameListEditor
          label="Attendant(s)"
          values={attendants}
          onChange={setAttendants}
          locked={[]}
        />

        {hardErrors.length > 0 && (
          <ul className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-[11px] text-rose-900 dark:text-rose-100 space-y-0.5">
            {hardErrors.map(e => <li key={e}>• {e}</li>)}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100 space-y-0.5">
            {warnings.map(e => <li key={e}>• {e}</li>)}
          </ul>
        )}
        {error && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={submitting || hardErrors.length > 0}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {submitting ? 'Saving…' : 'Save roster'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Editable list of names. Each row has a delete button except for
// names in `locked` (which still render with a hint badge instead of
// the X). The `+` button at the bottom appends a fresh empty row that
// auto-focuses for typing.
function NameListEditor({
  label, values, onChange, locked, lockedHint,
}: {
  label:       string
  values:      string[]
  onChange:    (next: string[]) => void
  locked:      string[]
  lockedHint?: string
}) {
  function update(i: number, v: string) {
    onChange(values.map((x, j) => j === i ? v : x))
  }
  function remove(i: number) {
    onChange(values.filter((_, j) => j !== i))
  }
  function add() {
    onChange([...values, ''])
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</p>
      <ul className="space-y-1">
        {values.map((name, i) => {
          const isLocked = locked.includes(name)
          return (
            <li key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={e => update(i, e.target.value)}
                placeholder="Name"
                className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
              {isLocked ? (
                <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200">
                  {lockedHint ?? 'locked'}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${name || 'row'}`}
                  className="shrink-0 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 px-2 py-1 rounded-md transition-colors"
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={add}
        className="text-xs font-semibold text-brand-navy hover:underline"
      >
        + Add
      </button>
    </div>
  )
}
