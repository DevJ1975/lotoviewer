'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Loader2, Search, Filter } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { useDebounce } from '@/hooks/useDebounce'
import {
  GHS_PICTOGRAMS,
  GHS_PICTOGRAM_LABEL,
  type GhsPictogram,
} from '@soteria/core/chemicals'
import { PictogramBadges, SignalWordBadge } from './_components/PictogramBadges'

interface ProductRow {
  id:               string
  name:             string
  manufacturer:     string | null
  product_code:     string | null
  cas_numbers:      string[] | null
  ghs_pictograms:   string[] | null
  ghs_signal_word:  string | null
  sds_revision_date: string | null
  active_sds_id:    string | null
  archived_at:      string | null
  created_at:       string
}

export default function ChemicalsListPage() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<ProductRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pictogram, setPictogram] = useState<GhsPictogram | ''>('')
  const debouncedSearch = useDebounce(search, 250)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const params = new URLSearchParams()
    params.set('limit', '200')
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (pictogram) params.set('pictogram', pictogram)

    try {
      const res  = await fetch(`/api/chemicals/products?${params.toString()}`, { headers })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setRows([])
        return
      }
      setRows(body.products ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows([])
    }
  }, [tenant, debouncedSearch, pictogram])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const total       = rows?.length ?? 0
    const withSds     = rows?.filter(r => r.active_sds_id).length ?? 0
    const missingSds  = total - withSds
    return { total, withSds, missingSds }
  }, [rows])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Chemical Management
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Tenant-wide chemical catalog with versioned Safety Data Sheets.
          </p>
        </div>
        <Link
          href="/chemicals/new"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
        >
          <Plus className="w-4 h-4" />
          Add chemical
        </Link>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
          <div className="text-xs text-indigo-700 dark:text-indigo-300 uppercase font-medium">Products</div>
          <div className="text-3xl font-bold text-indigo-900 dark:text-indigo-100 mt-1">{counts.total}</div>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
          <div className="text-xs text-emerald-700 dark:text-emerald-300 uppercase font-medium">With active SDS</div>
          <div className="text-3xl font-bold text-emerald-900 dark:text-emerald-100 mt-1">{counts.withSds}</div>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <div className="text-xs text-amber-700 dark:text-amber-300 uppercase font-medium">Missing SDS</div>
          <div className="text-3xl font-bold text-amber-900 dark:text-amber-100 mt-1">{counts.missingSds}</div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, manufacturer, or product code"
            className="w-full pl-9 pr-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={pictogram}
            onChange={e => setPictogram(e.target.value as GhsPictogram | '')}
            className="px-2 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">All hazards</option>
            {GHS_PICTOGRAMS.map(p => (
              <option key={p} value={p}>{p} — {GHS_PICTOGRAM_LABEL[p]}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          {debouncedSearch || pictogram
            ? 'No chemicals match your filters.'
            : <>No chemicals yet. <Link href="/chemicals/new" className="text-indigo-600 hover:underline">Add the first one</Link>.</>
          }
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {rows.map(row => (
            <li key={row.id}>
              <Link
                href={`/chemicals/${row.id}`}
                className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{row.name}</span>
                  {row.manufacturer && (
                    <span className="text-xs text-slate-500">· {row.manufacturer}</span>
                  )}
                  <SignalWordBadge word={row.ghs_signal_word} />
                  <PictogramBadges pictograms={row.ghs_pictograms ?? []} />
                  {!row.active_sds_id && (
                    <span className="ml-auto inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      No SDS
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
                  {row.product_code && <span>Code: {row.product_code}</span>}
                  {row.cas_numbers && row.cas_numbers.length > 0 && (
                    <span>CAS: {row.cas_numbers.join(', ')}</span>
                  )}
                  {row.sds_revision_date && <span>SDS rev: {row.sds_revision_date}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
