'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Plus, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Tenant } from '@/lib/types'

// Superadmin tenants list. RLS lets superadmin read all tenants directly,
// so no API route is needed for the read; the future create/edit actions
// (slices 6.2 / 6.3) will go through /api/superadmin/* routes that
// re-verify with requireSuperadmin().
//
// Each row links into /superadmin/tenants/[number] (stub today, real edit
// page in slice 6.3). Member counts come from the embedded
// tenant_memberships(count) — RLS-allowed for superadmins.

interface TenantWithMembers extends Tenant {
  member_count: number
}

const STATUS_STYLES: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  trial:    'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  disabled: 'bg-rose-100    text-rose-800    dark:bg-rose-900/40    dark:text-rose-200',
  archived: 'bg-slate-200   text-slate-700   dark:bg-slate-700      dark:text-slate-300',
}

export default function SuperadminTenants() {
  const [tenants, setTenants] = useState<TenantWithMembers[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('tenants')
      .select('*, tenant_memberships(count)')
      .order('tenant_number', { ascending: true })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    type Row = Tenant & { tenant_memberships: { count: number }[] }
    const rows = (data ?? []) as Row[]
    setTenants(rows.map(r => ({
      ...r,
      member_count: r.tenant_memberships?.[0]?.count ?? 0,
    })))
    setLoading(false)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">
            Superadmin
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
            Tenants
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            All organizations on this deployment. Use the 4-digit number when
            referencing tenants in support tickets and audit queries.
          </p>
        </div>
        <Link
          href="/superadmin/tenants/new"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New tenant
        </Link>
      </header>

      {loading && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Couldn&apos;t load tenants</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && tenants.length === 0 && (
        <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
          No tenants yet. Create the first one with the button above.
        </div>
      )}

      {!loading && !error && tenants.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-semibold px-4 py-3">#</th>
                <th className="text-left font-semibold px-4 py-3">Name</th>
                <th className="text-left font-semibold px-4 py-3">Slug</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
                <th className="text-left font-semibold px-4 py-3">Modules on</th>
                <th className="text-right font-semibold px-4 py-3">Members</th>
                <th className="text-left font-semibold px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {tenants.map(t => {
                const modulesOn = Object.entries(t.modules ?? {}).filter(([, v]) => v === true).length
                const created = new Date(t.created_at).toLocaleDateString()
                return (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {t.tenant_number}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/superadmin/tenants/${t.tenant_number}`}
                        className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-navy dark:hover:text-brand-yellow transition-colors"
                      >
                        {t.name}
                      </Link>
                      {t.is_demo && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-brand-yellow text-brand-navy tracking-wider">
                          Demo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {t.slug}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide ${STATUS_STYLES[t.status] ?? STATUS_STYLES.archived}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 tabular-nums">
                      {modulesOn}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300 tabular-nums">
                      {t.member_count}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                      {created}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
