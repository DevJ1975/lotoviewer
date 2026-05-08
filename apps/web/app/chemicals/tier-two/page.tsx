'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Filter, Loader2, Search } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { type TierTwoRow } from '@soteria/core/chemicals'
import { PictogramBadges, SignalWordBadge } from '../_components/PictogramBadges'

export default function TierTwoPage() {
  const { tenant } = useTenant()
  const [rows,  setRows]  = useState<TierTwoRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [groupBy, setGroupBy] = useState<'product' | 'location'>('product')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const res  = await fetch('/api/chemicals/tier-two', { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setRows([])
      return
    }
    setRows(body.rows ?? [])
  }, [tenant, buildHeaders])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.product_name.toLowerCase().includes(q)
      || (r.manufacturer ?? '').toLowerCase().includes(q)
      || (r.location_path ?? '').toLowerCase().includes(q)
      || (r.cas_numbers ?? []).some(c => c.includes(q))
      || (r.storage_class ?? '').toLowerCase().includes(q),
    )
  }, [rows, search])

  const counts = useMemo(() => {
    if (!filtered) return { rows: 0, products: 0, locations: 0 }
    const products  = new Set(filtered.map(r => r.product_id))
    const locations = new Set(filtered.map(r => r.location_id ?? '__unassigned__'))
    return {
      rows:      filtered.length,
      products:  products.size,
      locations: locations.size,
    }
  }, [filtered])

  const grouped = useMemo(() => {
    const groups = new Map<string, { label: string; rows: TierTwoRow[] }>()
    for (const r of filtered) {
      const key = groupBy === 'product'
        ? `${r.product_id}|${r.product_name}`
        : `${r.location_id ?? '__unassigned__'}|${r.location_path ?? '(unassigned)'}`
      const label = groupBy === 'product' ? r.product_name : (r.location_path ?? '(unassigned)')
      if (!groups.has(key)) groups.set(key, { label, rows: [] })
      groups.get(key)!.rows.push(r)
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [filtered, groupBy])

  async function downloadCsv() {
    if (!tenant?.id) return
    setDownloading(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch('/api/chemicals/tier-two?format=csv', { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]
        ?? 'tier-two.csv'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Tier II report</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            EPCRA Tier II rollup of every active chemical container, summed by product and location.
            Export as CSV for state filing.
          </p>
        </div>
        <button
          onClick={() => void downloadCsv()}
          disabled={downloading || !rows || rows.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Download CSV
        </button>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <section className="grid grid-cols-3 gap-3">
        <Tile label="Rollup rows" value={counts.rows} />
        <Tile label="Distinct chemicals" value={counts.products} />
        <Tile label="Distinct locations" value={counts.locations} />
      </section>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, manufacturer, CAS, or location"
            className="w-full pl-9 pr-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-500">Group by</span>
          {(['product', 'location'] as const).map(g => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`px-2 py-1 text-xs rounded border ${
                groupBy === g
                  ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >{g}</button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          {rows.length === 0
            ? 'No active inventory. Add chemicals + containers to populate the Tier II rollup.'
            : 'No rows match your search.'
          }
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(group => (
            <details key={group.label} open className="rounded-lg border border-slate-200 dark:border-slate-800">
              <summary className="cursor-pointer px-4 py-2 flex flex-wrap items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-900">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{group.label}</span>
                <span className="text-xs text-slate-500">{group.rows.length} row{group.rows.length === 1 ? '' : 's'}</span>
              </summary>
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {group.rows.map(r => (
                  <li key={`${r.product_id}|${r.location_id ?? 'none'}|${r.unit}`} className="px-4 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {groupBy === 'location' && (
                        <Link href={`/chemicals/${r.product_id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
                          {r.product_name}
                        </Link>
                      )}
                      {groupBy === 'product' && r.location_path && (
                        <span className="text-xs text-slate-600 dark:text-slate-300">📍 {r.location_path}</span>
                      )}
                      <SignalWordBadge word={r.ghs_signal_word ?? null} />
                      <PictogramBadges pictograms={r.ghs_pictograms ?? []} />
                      <span className="ml-auto font-mono text-sm text-slate-900 dark:text-slate-100">
                        {r.total_quantity} {r.unit}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
                      {r.cas_numbers && r.cas_numbers.length > 0 && <span>CAS {r.cas_numbers.join(', ')}</span>}
                      {r.manufacturer && <span>· {r.manufacturer}</span>}
                      {r.storage_class && <span>· {r.storage_class}</span>}
                      <span>· {r.container_count} container{r.container_count === 1 ? '' : 's'}</span>
                      {r.earliest_expiration && <span>· earliest exp {r.earliest_expiration}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
      <div className="text-xs text-indigo-700 dark:text-indigo-300 uppercase font-medium">{label}</div>
      <div className="text-3xl font-bold text-indigo-900 dark:text-indigo-100 mt-1">{value}</div>
    </div>
  )
}
