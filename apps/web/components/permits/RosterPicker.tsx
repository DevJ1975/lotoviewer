'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import type { PermitWorkerRole } from '@soteria/core/permitTrainingGate'
import { loadActiveRoster, type CrewMember, type RosterMember } from '@/lib/permits/permitCrew'

interface RosterPickerProps {
  tenantId: string
  roles: { role: PermitWorkerRole; label: string; hint?: string; required?: boolean }[]
  value: CrewMember[]
  onChange: (crew: CrewMember[]) => void
  disabled?: boolean
}

// Workers are picked from the tenant roster rather than typed, because a
// typed name cannot be checked against training records — the permit
// training gate keys on members.id.
export function RosterPicker({ tenantId, roles, value, onChange, disabled }: RosterPickerProps) {
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeRole, setActiveRole] = useState<PermitWorkerRole>(roles[0].role)

  useEffect(() => {
    loadActiveRoster(tenantId).then(setRoster).catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [tenantId])

  const onRole = new Set(value.filter(c => c.role === activeRole).map(c => c.memberId))
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return roster
      .filter(m => [m.display_name, m.employee_id, m.department, m.position_title].some(v => v?.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [query, roster])

  function add(member: RosterMember) {
    if (onRole.has(member.id)) return
    onChange([...value, { memberId: member.id, displayName: member.display_name, role: activeRole }])
    setQuery('')
  }

  function remove(target: CrewMember) {
    onChange(value.filter(c => !(c.memberId === target.memberId && c.role === target.role)))
  }

  return (
    <div className="space-y-3">
      {roles.map(r => {
        const people = value.filter(c => c.role === r.role)
        return (
          <div key={r.role}>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {r.label}{r.required && <span className="text-rose-500"> *</span>}
              {r.hint && <span className="ml-1 font-normal text-slate-400">{r.hint}</span>}
            </p>
            <ul className="mt-1 flex min-h-9 flex-wrap gap-1.5" aria-label={r.label}>
              {people.length === 0 && <li className="text-xs italic text-slate-400">No one added yet</li>}
              {people.map(person => (
                <li key={person.memberId} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {person.displayName}
                  {!disabled && (
                    <button type="button" onClick={() => remove(person)} aria-label={`Remove ${person.displayName} as ${r.label}`}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {!disabled && (
        <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            {roles.length > 1 && (
              <select
                value={activeRole}
                onChange={e => setActiveRole(e.target.value as PermitWorkerRole)}
                aria-label="Add as"
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                {roles.map(r => <option key={r.role} value={r.role}>Add as {r.label.toLowerCase()}</option>)}
              </select>
            )}
            <label className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search the roster by name, ID or department"
                aria-label="Search the roster"
                className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-2 text-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700"
              />
            </label>
          </div>
          {loadError && <p className="mt-2 text-xs text-rose-600">Could not load the roster: {loadError}</p>}
          {matches.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {matches.map(m => (
                <li key={m.id}>
                  <button type="button" onClick={() => add(m)} disabled={onRole.has(m.id)}
                    className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40 dark:hover:bg-slate-800">
                    <span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{m.display_name}</span>
                      <span className="ml-2 text-xs text-slate-500">{[m.employee_id, m.position_title, m.department].filter(Boolean).join(' · ')}</span>
                    </span>
                    <UserPlus className="h-4 w-4 shrink-0 text-brand-navy" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && matches.length === 0 && roster.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">No one on the roster matches. Add them under People first so their training can be verified.</p>
          )}
        </div>
      )}
    </div>
  )
}
