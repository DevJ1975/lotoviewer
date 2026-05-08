'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Filter, Loader2, Plus, ScanLine } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ACTIVE_INVENTORY_STATUSES,
  INVENTORY_STATUS_LABEL,
  INVENTORY_STATUSES,
  expiryTier,
  daysUntil,
  type InventoryStatus,
  type ExpiryTier,
} from '@soteria/core/chemicals'

interface Item {
  id:               string
  product_id:       string
  location_id:      string | null
  barcode:          string
  quantity:         number
  unit:             string
  container_type:   string | null
  expiration_date:  string | null
  status:           InventoryStatus
  chemical_products: {
    id:   string
    name: string
    manufacturer: string | null
    ghs_signal_word: string | null
  } | null
  chemical_locations: {
    id:   string
    name: string
    path: string | null
  } | null
}

const TIER_CLS: Record<ExpiryTier, string> = {
  expired:  'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  warning:  'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  ok:       'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  unknown:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

export default function InventoryListPage() {
  const { tenant } = useTenant()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [statusFilter, setStatusFilter] = useState<InventoryStatus[]>([
    ...ACTIVE_INVENTORY_STATUSES,
  ])
  const [expiringOnly, setExpiringOnly] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const params = new URLSearchParams()
    params.set('limit', '500')
    if (statusFilter.length > 0 && statusFilter.length !== INVENTORY_STATUSES.length) {
      params.set('status', statusFilter.join(','))
    }
    if (expiringOnly) params.set('expiring', 'true')

    try {
      const res  = await fetch(`/api/chemicals/inventory?${params.toString()}`, { headers })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setItems([])
        return
      }
      setItems(body.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setItems([])
    }
  }, [tenant, statusFilter, expiringOnly])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const out = { total: items?.length ?? 0, expired: 0, critical: 0, warning: 0 }
    for (const i of items ?? []) {
      const tier = expiryTier(i.expiration_date)
      if (tier === 'expired')  out.expired++
      if (tier === 'critical') out.critical++
      if (tier === 'warning')  out.warning++
    }
    return out
  }, [items])

  function toggleStatus(s: InventoryStatus) {
    setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Chemical inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Containers on shelves. Scan a barcode or filter by location, status, or expiring stock.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/chemicals/scan"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
          >
            <ScanLine className="w-4 h-4" /> Scan
          </Link>
          <Link
            href="/chemicals/inventory/new"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
          >
            <Plus className="w-4 h-4" /> Add container
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Containers"  value={counts.total}    color="indigo" />
        <Tile label="Expired"     value={counts.expired}  color="rose" />
        <Tile label="≤ 7 days"    value={counts.critical} color="rose" />
        <Tile label="≤ 30 days"   value={counts.warning}  color="amber" />
      </section>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          onClick={() => setShowFilters(s => !s)}
          className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"
        >
          <Filter className="w-4 h-4" /> Filters
        </button>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={expiringOnly}
            onChange={e => setExpiringOnly(e.target.checked)}
            className="rounded"
          />
          Expiring within 60 days
        </label>
      </div>

      {showFilters && (
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3 flex flex-wrap gap-2 text-sm">
          {INVENTORY_STATUSES.map(s => (
            <label key={s} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={statusFilter.includes(s)}
                onChange={() => toggleStatus(s)}
                className="rounded"
              />
              {INVENTORY_STATUS_LABEL[s]}
            </label>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No containers match your filters. <Link href="/chemicals/inventory/new" className="text-indigo-600 hover:underline">Add the first one</Link>.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {items.map(item => {
            const tier = expiryTier(item.expiration_date)
            const days = daysUntil(item.expiration_date)
            return (
              <li key={item.id}>
                <Link
                  href={`/chemicals/inventory/${item.id}`}
                  className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-xs text-slate-500">{item.barcode}</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {item.chemical_products?.name ?? '(unknown product)'}
                    </span>
                    {item.chemical_products?.manufacturer && (
                      <span className="text-xs text-slate-500">· {item.chemical_products.manufacturer}</span>
                    )}
                    <span className={`ml-auto inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded ${TIER_CLS[tier]}`}>
                      {tier === 'unknown'
                        ? 'no expiry'
                        : tier === 'expired'
                          ? `expired ${Math.abs(days ?? 0)}d ago`
                          : `${days}d left`}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex flex-wrap gap-x-3">
                    <span>{item.quantity} {item.unit}</span>
                    {item.container_type && <span>· {item.container_type}</span>}
                    <span>· {INVENTORY_STATUS_LABEL[item.status]}</span>
                    {item.chemical_locations?.path && <span>· 📍 {item.chemical_locations.path}</span>}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Tile({ label, value, color }: { label: string; value: number; color: 'indigo' | 'rose' | 'amber' }) {
  const cls = {
    indigo: 'border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-100',
    rose:   'border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-100',
    amber:  'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-100',
  }[color]
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="text-xs uppercase font-medium opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </div>
  )
}
