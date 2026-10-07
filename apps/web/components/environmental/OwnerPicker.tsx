'use client'

import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { searchOwners, type MemberOption, type Scope } from '@/lib/environmental/client'
import { inputCls } from './form'

// Choose the person responsible for a record from the account's members. The API
// refuses anyone who is not a member, so this only offers people who are.

interface Props {
  scope: Scope
  value: string | null
  /** The chosen person's name, if known, so an existing owner shows by name. */
  valueLabel?: string | null
  onChange: (userId: string | null, label: string | null) => void
  disabled?: boolean
}

export function OwnerPicker({ scope, value, valueLabel, onChange, disabled }: Props) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<MemberOption[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      searchOwners(scope, query).then(setOptions).catch(() => setOptions([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [scope, query, open])

  if (value && !open) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
        <span className="flex-1 truncate text-slate-900 dark:text-slate-100">{valueLabel ?? 'Assigned'}</span>
        {!disabled && (
          <button type="button" aria-label="Clear owner" onClick={() => onChange(null, null)} className="rounded p-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        value={query} disabled={disabled} placeholder="Search people…" className={inputCls}
        onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {options.map(o => (
            <li key={o.user_id} role="option" aria-selected={false}>
              <button
                type="button" className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(o.user_id, o.display_name); setQuery(''); setOpen(false) }}
              >
                <span className="text-slate-900 dark:text-slate-100">{o.display_name}</span>
                {o.email && <span className="text-xs text-slate-500">{o.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
