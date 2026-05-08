'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import {
  ENTITY_LINK_LABEL, ENTITY_LINK_TYPES, searchEntities,
  type EntityLinkType,
} from '@/lib/safetyBoards/client'

// Picker for thread's linked entity (incident, equipment, …).
// Two-step: pick a type, then type-ahead search within that type's
// table. Returns (type, id, label) to the parent.

interface Props {
  value: { type: EntityLinkType; id: string; label?: string } | null
  onChange: (next: { type: EntityLinkType; id: string; label: string } | null) => void
  disabled?: boolean
}

interface Suggestion { id: string; label: string; sub: string }

export default function EntityLinkPicker({ value, onChange, disabled }: Props) {
  const { tenant } = useTenant()
  const [type, setType] = useState<EntityLinkType>(value?.type ?? 'incident')
  const [q, setQ]       = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Suggestion[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search.
  useEffect(() => {
    if (!tenant?.id || !open) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return }
      setBusy(true)
      try {
        const items = await searchEntities(tenant.id, type, q.trim())
        setResults(items)
      } catch { setResults([]) }
      finally { setBusy(false) }
    }, 250)
  }, [tenant?.id, type, q, open])

  const display = useMemo(() => value ? value.label ?? value.id : '', [value])

  function pick(s: Suggestion) {
    onChange({ type, id: s.id, label: s.label })
    setOpen(false)
    setQ('')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={type}
          onChange={e => { setType(e.target.value as EntityLinkType); setResults([]); setQ('') }}
          disabled={disabled}
          className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
        >
          {ENTITY_LINK_TYPES.map(t => (
            <option key={t} value={t}>{ENTITY_LINK_LABEL[t]}</option>
          ))}
        </select>

        {value ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-navy/10 dark:bg-brand-yellow/15 px-2 py-1 text-xs text-brand-navy dark:text-brand-yellow">
            {ENTITY_LINK_LABEL[value.type]}: {display}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="hover:text-rose-600"
                title="Unlink"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Link to {ENTITY_LINK_LABEL[type]}…
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && !value && (
        <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 p-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={`Search ${ENTITY_LINK_LABEL[type].toLowerCase()}s…`}
            className="w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm mb-2"
            autoFocus
          />
          {busy && (
            <div className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> searching…
            </div>
          )}
          {!busy && q && results.length === 0 && (
            <p className="px-2 py-1 text-xs italic text-slate-500">No matches.</p>
          )}
          <ul className="max-h-56 overflow-y-auto">
            {results.map(s => (
              <li key={s.id}>
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); pick(s) }}
                  className="w-full text-left rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div className="font-medium text-slate-700 dark:text-slate-200 truncate">{s.label}</div>
                  {s.sub && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{s.sub}</div>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
