'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, AlertCircle, Mail, Calendar, Clock } from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import type { TenantRole } from '@soteria/core/types'

// Member detail page. Renders profile + memberships across all tenants
// + per-user audit feed. Linked from AllMembersPanel + MembersSection.

interface UserDetail {
  user_id:              string
  email:                string | null
  full_name:            string | null
  is_admin:             boolean
  is_superadmin:        boolean
  must_change_password: boolean
  last_sign_in_at:      string | null
  created_at:           string | null
  status:               'invited' | 'active'
  memberships: Array<{
    tenant_id: string; tenant_number: string; tenant_name: string
    role: TenantRole; joined_at: string
  }>
  audit: Array<{
    id: number; occurred_at: string; actor_email: string | null
    table_name: string; operation: string; summary: string
  }>
}

export default function MemberDetailPage({ params }: { params: Promise<{ user_id: string }> }) {
  const { user_id } = use(params)
  const [user, setUser]     = useState<UserDetail | null>(null)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null); setUser(null)
    const result = await superadminJson<{ user: UserDetail }>(
      `/api/superadmin/users/${user_id}`, { method: 'GET' },
    )
    if (!result.ok || !result.body) { setError(result.error ?? 'Could not load user'); return }
    setUser(result.body.user)
  }, [user_id])

  useEffect(() => { void load() }, [load])

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <BackLink />
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      </div>
    )
  }
  if (!user) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }

  const label = user.full_name ?? user.email ?? user.user_id

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <BackLink />

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">
          Member
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-3 flex-wrap">
          {label}
          <StatusPill status={user.status} />
          {user.is_superadmin && <RoleBadge>Superadmin</RoleBadge>}
          {user.is_admin && !user.is_superadmin && <RoleBadge>Admin</RoleBadge>}
        </h1>
        {user.email && user.full_name && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-mono">{user.email}</p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-3">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> Created {fmt(user.created_at)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {user.last_sign_in_at ? `Last signed in ${fmt(user.last_sign_in_at)}` : 'Never signed in'}
          </span>
          {user.must_change_password && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
              <Mail className="h-3.5 w-3.5" /> Password change pending
            </span>
          )}
        </div>
      </header>

      <Section title={`Memberships (${user.memberships.length})`}>
        {user.memberships.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">Not a member of any tenant.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {user.memberships.map(m => (
              <li key={m.tenant_id} className="py-3 flex items-center justify-between gap-3">
                <Link
                  href={`/superadmin/tenants/${m.tenant_number}`}
                  className="flex-1 min-w-0 hover:text-brand-navy dark:hover:text-brand-yellow transition-colors"
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    <span className="font-mono text-slate-400 dark:text-slate-500 mr-2">#{m.tenant_number}</span>
                    {m.tenant_name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Joined {fmt(m.joined_at)}
                  </p>
                </Link>
                <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mt-8">
        <Section title={`Audit feed (${user.audit.length})`}>
          {user.audit.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">No recorded activity yet.</p>
          ) : (
            <ol className="space-y-3 relative pl-6">
              <span className="absolute left-2 top-1 bottom-1 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
              {user.audit.map(e => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-5 top-2 h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
                  <div className="text-sm text-slate-800 dark:text-slate-200">{e.summary}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {fmt(e.occurred_at)}
                    {e.actor_email && (
                      <>
                        {' · by '}
                        <span className="font-mono">{e.actor_email}</span>
                      </>
                    )}
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {e.operation} {e.table_name}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/superadmin" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4">
      <ArrowLeft className="h-3.5 w-3.5" /> Superadmin
    </Link>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-5">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function StatusPill({ status }: { status: 'invited' | 'active' }) {
  const cls = status === 'invited'
    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'
    : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
  return (
    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${cls}`}>
      {status === 'invited' ? 'Invited' : 'Active'}
    </span>
  )
}

function RoleBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-navy text-white">
      {children}
    </span>
  )
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}
