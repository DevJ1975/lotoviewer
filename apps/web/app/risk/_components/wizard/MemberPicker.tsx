'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

// Member picker for the risk wizard's Assign step. Loads the
// active tenant's tenant_memberships once on mount + caches them
// across the three picker instances (owner / reviewer / approver)
// so we don't fire 3 identical fetches.
//
// Uses controlled-component state — caller owns the user_id; the
// picker just renders display + dispatches changes. Empty string
// means "unassigned."

interface Member {
  user_id:   string
  role:      string
  email:     string | null
  full_name: string | null
}

interface Props {
  value:        string
  onChange:     (uuid: string) => void
  placeholder?: string
}

// Simple in-memory cache so re-mounting MemberPicker (e.g. when
// stepping through wizard steps) doesn't re-fetch. Keyed by tenant
// id; stale-after-tenant-switch is fine because we tear down on
// switch via the `tenant?.id` dep.
const cache = new Map<string, Member[]>()

export default function MemberPicker({ value, onChange, placeholder = 'Unassigned' }: Props) {
  const { tenant } = useTenant()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [open, setOpen]       = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!tenant?.id) return
      if (cache.has(tenant.id)) {
        setMembers(cache.get(tenant.id)!)
        return
      }
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const headers: Record<string, string> = {}
        if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
        headers['x-active-tenant'] = tenant.id
        const res = await fetch('/api/risk/members', { headers })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        const list = (body.members ?? []) as Member[]
        cache.set(tenant.id, list)
        setMembers(list)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [tenant?.id])

  const selected = members?.find(m => m.user_id === value) ?? null

  return (
    <div className="relative">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex-1 text-left rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm flex items-center justify-between gap-2"
        >
          {selected ? (
            <span>
              <span className="font-medium">{selected.full_name ?? selected.email ?? selected.user_id}</span>
              {selected.role && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {selected.role}
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-slate-400 hover:text-rose-700 px-2"
            title="Unassign"
            aria-label="Unassign"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-20 mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {members === null && !error && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          )}
          {error && (
            <p className="px-3 py-2 text-xs text-rose-700 bg-rose-50">{error}</p>
          )}
          {members && members.length === 0 && (
            <p className="px-3 py-3 text-xs italic text-slate-400 text-center">
              No members in this tenant yet.
            </p>
          )}
          {members && members.length > 0 && members.map(m => (
            <button
              key={m.user_id}
              type="button"
              onClick={() => { onChange(m.user_id); setOpen(false) }}
              className={
                'w-full text-left px-3 py-2 text-sm transition-colors ' +
                (m.user_id === value
                  ? 'bg-brand-navy/5 dark:bg-brand-navy/20'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800')
              }
            >
              <div className="font-medium text-slate-800 dark:text-slate-200">
                {m.full_name ?? m.email ?? m.user_id}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                {m.email && <span>{m.email}</span>}
                <span className="uppercase tracking-wide">{m.role}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
