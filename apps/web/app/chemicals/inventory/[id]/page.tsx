'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ACTIVE_INVENTORY_STATUSES,
  INVENTORY_STATUSES,
  INVENTORY_STATUS_LABEL,
  expiryTier,
  daysUntil,
  type InventoryStatus,
} from '@soteria/core/chemicals'

interface Item {
  id:               string
  product_id:       string
  location_id:      string | null
  department:       string | null
  barcode:          string
  quantity:         number
  unit:             string
  container_type:   string | null
  received_date:    string | null
  opened_date:      string | null
  expiration_date:  string | null
  lot_number:       string | null
  manufacture_date: string | null
  status:           InventoryStatus
  purchase_order:   string | null
  cost_cents:       number | null
  notes:            string | null
  disposed_at:      string | null
  disposed_method:  string | null
  created_at:       string
  chemical_products: {
    id:              string
    name:            string
    manufacturer:    string | null
    product_code:    string | null
    ghs_signal_word: string | null
    ghs_pictograms:  string[] | null
    ppe_required:    string[] | null
    storage_class:   string | null
  } | null
  chemical_locations: {
    id:    string
    name:  string
    path:  string | null
    kind:  string
  } | null
}

interface LocationOpt { id: string; name: string; path: string | null; depth: number }

export default function InventoryDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id     = params?.id
  const { tenant } = useTenant()

  const [item,    setItem]    = useState<Item | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)
  const [locations, setLocations] = useState<LocationOpt[]>([])
  const [moveTo,    setMoveTo]    = useState('')
  const [disposeMethod, setDisposeMethod] = useState('')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setLoading(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const [itemRes, locRes] = await Promise.all([
        fetch(`/api/chemicals/inventory/${id}`, { headers }),
        fetch('/api/chemicals/locations', { headers }),
      ])
      const body = await itemRes.json()
      if (!itemRes.ok) {
        setError(body.error ?? `HTTP ${itemRes.status}`)
        setItem(null)
        return
      }
      setItem(body.item)
      setMoveTo(body.item.location_id ?? '')
      if (locRes.ok) {
        const lb = await locRes.json() as { locations: LocationOpt[] }
        const withDepth = (lb.locations ?? []).map(l => ({
          ...l,
          depth: l.path ? l.path.split(' / ').length - 1 : 0,
        }))
        setLocations(withDepth)
      }
    } finally {
      setLoading(false)
    }
  }, [tenant, id, buildHeaders])

  useEffect(() => { void load() }, [load])

  async function patch(update: Record<string, unknown>) {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res  = await fetch(`/api/chemicals/inventory/${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body:    JSON.stringify(update),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setItem(body.item)
    } finally {
      setBusy(false)
    }
  }

  async function dispose() {
    const method = disposeMethod.trim()
    if (!method) {
      setError('Disposal method is required')
      return
    }
    if (!confirm(`Dispose this container via "${method}"? This is final.`)) return
    await patch({ status: 'disposed', disposed_method: method })
  }

  const tier = useMemo(() => expiryTier(item?.expiration_date), [item])
  const days = useMemo(() => daysUntil(item?.expiration_date), [item])

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !item) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link href="/chemicals/inventory" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to inventory
        </Link>
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error ?? 'Container not found.'}
        </div>
      </div>
    )
  }

  const isLive = (ACTIVE_INVENTORY_STATUSES as readonly string[]).includes(item.status)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals/inventory" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to inventory
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-slate-500">{item.barcode}</div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {item.chemical_products?.name ?? '(unknown product)'}
          </h1>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-3">
            {item.chemical_products?.manufacturer && <span>{item.chemical_products.manufacturer}</span>}
            {item.chemical_products?.product_code && <span>· {item.chemical_products.product_code}</span>}
            <Link href={`/chemicals/${item.product_id}`} className="text-indigo-600 hover:underline">
              View chemical
            </Link>
          </div>
        </div>
        <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded ${
          item.status === 'disposed'
            ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
            : item.status === 'quarantined'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
        }`}>
          {INVENTORY_STATUS_LABEL[item.status]}
        </span>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card title="Quantity">
          <Field label="On hand" value={`${item.quantity} ${item.unit}`} />
          <Field label="Container" value={item.container_type ?? '—'} />
          <Field label="Lot" value={item.lot_number ?? '—'} />
          <Field label="PO" value={item.purchase_order ?? '—'} />
        </Card>
        <Card title="Dates">
          <Field label="Received"   value={item.received_date ?? '—'} />
          <Field label="Opened"     value={item.opened_date ?? '—'} />
          <Field label="Manufactured" value={item.manufacture_date ?? '—'} />
          <Field label="Expires"
            value={item.expiration_date
              ? `${item.expiration_date} (${days! < 0 ? `expired ${-days!}d ago` : `${days}d left`})`
              : '—'
            }
            valueClass={
              tier === 'expired' || tier === 'critical'
                ? 'text-rose-700 dark:text-rose-300 font-medium'
                : tier === 'warning'
                  ? 'text-amber-700 dark:text-amber-300'
                  : ''
            }
          />
        </Card>
        <Card title="Location">
          <Field label="Where" value={item.chemical_locations?.path ?? '(unassigned)'} />
          <Field label="Department" value={item.department ?? '—'} />
          {isLive && (
            <div className="mt-2 flex items-center gap-2">
              <select
                value={moveTo}
                onChange={e => setMoveTo(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="">(unassigned)</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{'— '.repeat(l.depth)}{l.name}</option>
                ))}
              </select>
              <button
                onClick={() => void patch({ location_id: moveTo || null })}
                disabled={busy || moveTo === (item.location_id ?? '')}
                className="px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
              >Move</button>
            </div>
          )}
        </Card>
        <Card title="Status">
          <Field label="Current" value={INVENTORY_STATUS_LABEL[item.status]} />
          {item.disposed_at && (
            <Field label="Disposed" value={`${item.disposed_at.slice(0, 10)} via ${item.disposed_method ?? '—'}`} />
          )}
          {isLive && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {INVENTORY_STATUSES
                .filter(s => s !== 'disposed' && s !== item.status)
                .map(s => (
                  <button
                    key={s}
                    onClick={() => void patch({ status: s })}
                    disabled={busy}
                    className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                  >Mark {INVENTORY_STATUS_LABEL[s].toLowerCase()}</button>
                ))}
            </div>
          )}
        </Card>
      </section>

      {item.notes && (
        <Card title="Notes">
          <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">{item.notes}</p>
        </Card>
      )}

      {isLive && (
        <section className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/30 dark:bg-rose-950/20 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Dispose container
          </h2>
          <p className="text-xs text-rose-700 dark:text-rose-300">
            Final action — captures the disposal method for waste characterization. Once disposed, the container becomes read-only history.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1">
              <span className="text-xs font-medium text-rose-800 dark:text-rose-300">Method</span>
              <input
                type="text"
                value={disposeMethod}
                onChange={e => setDisposeMethod(e.target.value)}
                placeholder="Hazardous waste pickup, incineration, drain (where permitted), …"
                className="mt-1 w-full px-3 py-1.5 text-sm rounded border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900"
              />
            </label>
            <button
              onClick={() => void dispose()}
              disabled={busy || !disposeMethod.trim()}
              className="px-3 py-1.5 text-sm rounded bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
            >Dispose</button>
          </div>
        </section>
      )}

      <button
        onClick={() => router.push(`/chemicals/${item.product_id}`)}
        className="text-sm text-indigo-600 hover:underline"
      >
        Print a label for this container →
      </button>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Field({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="text-sm flex gap-2">
      <span className="text-slate-500 min-w-[110px]">{label}</span>
      <span className={`text-slate-800 dark:text-slate-200 ${valueClass ?? ''}`}>
        {value || <span className="italic text-slate-400">—</span>}
      </span>
    </div>
  )
}
