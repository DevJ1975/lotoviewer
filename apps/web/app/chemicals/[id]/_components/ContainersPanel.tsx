'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Package, Plus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  INVENTORY_STATUS_LABEL,
  expiryTier,
  daysUntil,
  type InventoryStatus,
  type ExpiryTier,
} from '@soteria/core/chemicals'

interface Container {
  id:              string
  barcode:         string
  quantity:        number
  unit:            string
  container_type:  string | null
  expiration_date: string | null
  status:          InventoryStatus
  chemical_locations: { id: string; name: string; path: string | null } | null
}

const TIER_CLS: Record<ExpiryTier, string> = {
  expired:  'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  warning:  'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  ok:       'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  unknown:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

interface Props { productId: string }

export default function ContainersPanel({ productId }: Props) {
  const { tenant } = useTenant()
  const [items, setItems] = useState<Container[] | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const params = new URLSearchParams({
      product_id: productId,
      limit:      '200',
    })
    const res = await fetch(`/api/chemicals/inventory?${params}`, { headers })
    if (!res.ok) { setItems([]); return }
    const body = await res.json()
    setItems(body.items ?? [])
  }, [tenant, productId])

  useEffect(() => { void load() }, [load])

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Package className="w-4 h-4" /> Inventory containers
        </h2>
        <Link
          href={`/chemicals/inventory/new?product=${productId}`}
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
        >
          <Plus className="w-3 h-3" /> Add container
        </Link>
      </div>

      {items === null ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-500 italic">
          No active containers for this chemical.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
          {items.map(c => {
            const tier = expiryTier(c.expiration_date)
            const days = daysUntil(c.expiration_date)
            return (
              <li key={c.id}>
                <Link
                  href={`/chemicals/inventory/${c.id}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900 text-sm"
                >
                  <span className="font-mono text-xs text-slate-500">{c.barcode}</span>
                  <span>{c.quantity} {c.unit}</span>
                  {c.container_type && <span className="text-xs text-slate-500">· {c.container_type}</span>}
                  {c.chemical_locations?.path && <span className="text-xs text-slate-500">· 📍 {c.chemical_locations.path}</span>}
                  <span className="ml-auto inline-flex items-center gap-2">
                    <span className="text-xs text-slate-500">{INVENTORY_STATUS_LABEL[c.status]}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded ${TIER_CLS[tier]}`}>
                      {tier === 'unknown'
                        ? 'no expiry'
                        : tier === 'expired'
                          ? `expired ${Math.abs(days ?? 0)}d ago`
                          : `${days}d left`}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
