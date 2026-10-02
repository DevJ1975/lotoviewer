'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

// Member picker for the risk wizard's Assign step, also used by the
// environmental process map. Loads the active tenant's tenant_memberships
// once and caches them across every picker on the page (owner / reviewer /
// approver here; one per process there) so they share one fetch.
//
// Uses controlled-component state — caller owns the user_id; the
// picker just renders display + dispatches changes. Empty string
// means "unassigned."

export interface Member {
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

// In-memory cache, keyed by tenant id, so re-mounting MemberPicker (e.g.
// when stepping through wizard steps) doesn't re-fetch. It holds the
// request itself, not just its result, so pickers that mount together
// share one fetch instead of each starting their own. A failed request is
// dropped so the next mount retries. Stale-after-tenant-switch is fine
// because we tear down on switch via the `tenant?.id` dep.
const cache = new Map<string, Promise<Member[]>>()

async function fetchMembers(tenantId: string): Promise<Member[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {}
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
  headers['x-active-tenant'] = tenantId
  const res = await fetch('/api/risk/members', { headers })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return (body.members ?? []) as Member[]
}

function membersOf(tenantId: string): Promise<Member[]> {
  let request = cache.get(tenantId)
  if (!request) {
    request = fetchMembers(tenantId)
    cache.set(tenantId, request)
    request.catch(() => cache.delete(tenantId))
  }
  return request
}

/** The active tenant's members, for pickers and for showing who holds a role read-only. */
export function useTenantMembers(): { members: Member[] | null; error: string | null } {
  const { tenant } = useTenant()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    membersOf(tenant.id).then(
      list => { if (!cancelled) setMembers(list) },
      (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [tenant?.id])

  return { members, error }
}

/** How a member is named on screen: their name, else their email, else their id. */
export function memberName(member: Member): string {
  return member.full_name ?? member.email ?? member.user_id
}

export default function MemberPicker({ value, onChange, placeholder = 'Unassigned' }: Props) {
  const { members, error } = useTenantMembers()
  const [open, setOpen]    = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Close on Escape or a press outside, not only on mouse-leave: keyboard
  // and touch users never leave with a mouse, and an open list covers the
  // pickers below it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onPress = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open])

  const selected = members?.find(m => m.user_id === value) ?? null

  return (
    <div ref={root} className="relative">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="flex-1 text-left rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm flex items-center justify-between gap-2"
        >
          {selected ? (
            <span>
              <span className="font-medium">{memberName(selected)}</span>
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
                {memberName(m)}
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
