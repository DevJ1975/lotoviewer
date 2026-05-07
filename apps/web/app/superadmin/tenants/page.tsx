'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, AlertCircle, X as XIcon, ToggleLeft, ToggleRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getModules, type FeatureCategory } from '@soteria/core/features'
import { superadminJson } from '@/lib/superadminFetch'
import type { Tenant } from '@soteria/core/types'

const MODULE_GROUPS: FeatureCategory[] = ['safety', 'reports', 'admin']

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

  // Bulk-module-toggle state. Selecting tenants reveals a sticky
  // bottom bar; from there an admin picks one module + Enable/Disable
  // and the action fires via /api/superadmin/tenants/bulk-modules.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModuleId, setBulkModuleId] = useState<string>('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  // Module catalog flat list for the dropdown.
  const moduleOptions = useMemo(
    () => MODULE_GROUPS.flatMap(cat =>
      getModules(cat)
        .filter(m => !m.comingSoon)
        .map(m => ({ id: m.id, label: m.name, category: cat })),
    ),
    [],
  )

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else              next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    setSelected(prev =>
      prev.size === tenants.length ? new Set() : new Set(tenants.map(t => t.id)),
    )
  }

  async function bulkToggle(enabled: boolean) {
    if (!bulkModuleId) { setBulkResult('Pick a module first.'); return }
    if (selected.size === 0) { setBulkResult('Select at least one tenant.'); return }
    setBulkBusy(true)
    setBulkResult(null)
    const result = await superadminJson<{ updated: number; failed: Array<{ tenant_id: string; error: string }> }>(
      '/api/superadmin/tenants/bulk-modules',
      {
        method: 'POST',
        body:   JSON.stringify({
          tenant_ids: Array.from(selected),
          module_id:  bulkModuleId,
          enabled,
        }),
      },
    )
    setBulkBusy(false)
    if (!result.ok || !result.body) {
      setBulkResult(result.error ?? 'Bulk update failed')
      return
    }
    const failed = result.body.failed.length
    setBulkResult(
      failed === 0
        ? `Updated ${result.body.updated} tenant${result.body.updated === 1 ? '' : 's'}.`
        : `Updated ${result.body.updated}, failed ${failed}: ${result.body.failed.slice(0, 3).map(f => f.error).join('; ')}`,
    )
    // Refresh so the "Modules on" count column updates.
    await load()
  }

  const load = useCallback(async () => {
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
  }, [])

  useEffect(() => { void load() }, [load])

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
                <th className="px-2 py-3 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={tenants.length > 0 && selected.size === tenants.length}
                    onChange={toggleSelectAll}
                  />
                </th>
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
                    className={`hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors ${selected.has(t.id) ? 'bg-brand-yellow/10 dark:bg-brand-yellow/5' : ''}`}
                  >
                    <td className="px-2 py-3 w-8">
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.name}`}
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelected(t.id)}
                      />
                    </td>
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

      {/* Sticky bulk-action bar — visible only when ≥1 tenant selected */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-0 inset-x-0 z-30 bg-brand-navy text-white border-t border-white/10 shadow-2xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold shrink-0">
              {selected.size} tenant{selected.size === 1 ? '' : 's'} selected
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="text-white/70 hover:text-white"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <select
                value={bulkModuleId}
                onChange={e => setBulkModuleId(e.target.value)}
                disabled={bulkBusy}
                className="px-2 py-1 text-xs rounded-md bg-white/10 text-white border border-white/20 focus:outline-none focus:ring-2 focus:ring-brand-yellow disabled:opacity-50"
              >
                <option value="">— pick a module —</option>
                {moduleOptions.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    [{opt.category}] {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void bulkToggle(true)}
                disabled={bulkBusy || !bulkModuleId}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40"
              >
                <ToggleRight className="h-3.5 w-3.5" />
                Enable
              </button>
              <button
                type="button"
                onClick={() => void bulkToggle(false)}
                disabled={bulkBusy || !bulkModuleId}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 disabled:opacity-40"
              >
                <ToggleLeft className="h-3.5 w-3.5" />
                Disable
              </button>
            </div>
            {bulkResult && (
              <p className="basis-full text-[11px] text-white/80">{bulkResult}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
