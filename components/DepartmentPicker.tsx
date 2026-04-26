'use client'

import { useState } from 'react'

// Pick from a known department or type a new one. Replaces the free-text
// input + <datalist> we used originally — datalists are a poor affordance
// on iPad (Safari renders the suggestions in a tiny popover that field
// supervisors miss), and there was no obvious cue that you could add a
// brand-new department by typing.
//
// Controlled — the parent owns the canonical string. We pass empty string
// out for "no value", the same shape any plain <input> would emit. The
// "+ Add new department…" sentinel switches to a text input inline; once
// the user types a non-empty value, that string is the picker's value
// (we don't store the sentinel).

const SENTINEL = '__add_new__'

export function DepartmentPicker({
  value, onChange, knownDepartments, placeholder = 'Department',
}: {
  value:             string
  onChange:          (next: string) => void
  knownDepartments:  string[]
  placeholder?:      string
}) {
  // "adding" is purely local state — it tracks whether the user picked the
  // sentinel option this session. Once they type into the inline input, the
  // value becomes the typed string and the parent doesn't need to know we
  // were ever in "add" mode.
  const [adding, setAdding] = useState(
    () => value !== '' && !knownDepartments.includes(value),
  )

  // The select shows known departments + the sentinel. When the value isn't
  // in the list (e.g. a freshly-typed new department), the select displays
  // the sentinel so the user sees they're in "add new" mode.
  const selectValue =
    adding || (value !== '' && !knownDepartments.includes(value))
      ? SENTINEL
      : value

  function handleSelect(next: string) {
    if (next === SENTINEL) {
      setAdding(true)
      onChange('')
      return
    }
    setAdding(false)
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      <select
        value={selectValue}
        onChange={e => handleSelect(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
      >
        <option value="">— Select a department —</option>
        {knownDepartments.map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
        <option value={SENTINEL}>+ Add new department…</option>
      </select>
      {adding && (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={`New department name (e.g. ${placeholder})`}
          autoFocus
          className="w-full rounded-lg border border-brand-navy/30 bg-brand-navy/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
      )}
    </div>
  )
}
