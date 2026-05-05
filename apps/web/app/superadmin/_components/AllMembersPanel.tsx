'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, Users, Search } from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import type { TenantRole } from '@soteria/core/types'

interface UserRow {
  user_id:         string
  email:           string | null
  full_name:       string | null
  is_admin:        boolean
  is_superadmin:   boolean
  last_sign_in_at: string | null
  status:          'invited' | 'active'
  memberships:    Array<{ tenant_id: string; tenant_number: string; tenant_name: string; role: TenantRole }>
}

// Cross-tenant member list rendered on the /superadmin landing page.
// Pulls from /api/superadmin/users (service-role read of profiles +
// memberships + auth.users). Filterable by name/email; rows show the
// invite status pill + which tenants they belong to.
export function AllMembersPanel() {
  const [users, setUsers]   = useState<UserRow[] | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setError(null)
    const result = await superadminJson<{ users: UserRow[] }>(
      '/api/superadmin/users', { method: 'GET' },
    )
    if (!result.ok || !result.body) {
      setError(result.error ?? 'Could not load users')
      setUsers([])
      return
    }
    setUsers(result.body.users)
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    if (!users) return []
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      (u.email ?? '').toLowerCase().includes(q)
      || (u.full_name ?? '').toLowerCase().includes(q)
      || u.memberships.some(m =>
        m.tenant_name.toLowerCase().includes(q) || m.tenant_number.includes(q)
      )
    )
  }, [users, search])

  const totals = useMemo(() => {
    if (!users) return { total: 0, active: 0, invited: 0 }
    return {
      total:   users.length,
      active:  users.filter(u => u.status === 'active').length,
      invited: users.filter(u => u.status === 'invited').length,
    }
  }, [users])

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <header className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-4 w-4 text-brand-navy dark:text-brand-yellow shrink-0" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            All members
          </h2>
          {users && (
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              · {totals.total} total ·
              <span className="text-emerald-700 dark:text-emerald-300"> {totals.active} active</span> ·
              <span className="text-amber-700 dark:text-amber-300"> {totals.invited} invited</span>
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="search"
            placeholder="Filter by name, email, or tenant"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-7 pr-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy w-56 max-w-full"
          />
        </div>
      </header>

      {users === null && (
        <div className="py-10 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {error && (
        <div className="m-5 p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      )}

      {users && users.length === 0 && !error && (
        <p className="py-8 px-5 text-sm text-slate-500 dark:text-slate-400 text-center">
          No users in the system yet.
        </p>
      )}

      {users && users.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name / Email</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Tenants</th>
                <th className="text-left font-semibold px-4 py-2.5">Last signed in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {filtered.map(u => {
                const label = u.full_name ?? u.email ?? u.user_id
                return (
                  <tr key={u.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/superadmin/users/${u.user_id}`}
                        className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate hover:text-brand-navy dark:hover:text-brand-yellow transition-colors"
                      >
                        {label}
                      </Link>
                      {u.full_name && u.email && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">{u.email}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {u.is_superadmin && <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-brand-navy text-white font-bold">Superadmin</span>}
                        {u.is_admin && !u.is_superadmin && <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-slate-700 text-white font-bold">Admin</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusPill status={u.status} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      {u.memberships.length === 0 ? (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">no memberships</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1">
                          {u.memberships.map(m => (
                            <li key={m.tenant_id}>
                              <Link
                                href={`/superadmin/tenants/${m.tenant_number}`}
                                title={`${m.tenant_name} — ${m.role}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 transition-colors"
                              >
                                <span className="font-mono text-slate-400 dark:text-slate-500">#{m.tenant_number}</span>
                                <span>{m.tenant_name}</span>
                                <span className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{m.role}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {u.last_sign_in_at
                        ? new Date(u.last_sign_in_at).toLocaleDateString()
                        : <span className="italic">never</span>}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400 text-center">
                    No matches for &ldquo;{search}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function StatusPill({ status }: { status: 'invited' | 'active' }) {
  if (status === 'invited') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
        Invited
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200">
      Active
    </span>
  )
}
