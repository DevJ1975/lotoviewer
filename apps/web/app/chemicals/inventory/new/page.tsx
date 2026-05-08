'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  CONTAINER_TYPES,
  INVENTORY_UNITS,
  type ContainerType,
  type InventoryUnit,
} from '@soteria/core/chemicals'

interface ProductOpt {
  id:           string
  name:         string
  manufacturer: string | null
}
interface LocationOpt {
  id:    string
  name:  string
  path:  string | null
  depth: number
}

export default function NewContainerPage() {
  const router = useRouter()
  const search = useSearchParams()
  const { tenant } = useTenant()

  const initialProductId = search?.get('product') ?? ''

  const [products,  setProducts]  = useState<ProductOpt[]>([])
  const [locations, setLocations] = useState<LocationOpt[]>([])
  const [error,     setError]     = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [productId,    setProductId]    = useState(initialProductId)
  const [locationId,   setLocationId]   = useState('')
  const [conflicts,    setConflicts]    = useState<{ product_id: string; product_name: string; findings: { reason: string }[] }[]>([])
  const [acknowledgedConflict, setAcknowledgedConflict] = useState(false)
  const [requestApproval, setRequestApproval] = useState(false)
  const [barcode,      setBarcode]      = useState('')
  const [quantity,     setQuantity]     = useState<string>('1')
  const [unit,         setUnit]         = useState<InventoryUnit>('ea')
  const [containerType, setContainerType] = useState<ContainerType | ''>('')
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10))
  const [expirationDate, setExpirationDate] = useState('')
  const [lotNumber,    setLotNumber]    = useState('')
  const [purchaseOrder, setPurchaseOrder] = useState('')
  const [notes,        setNotes]        = useState('')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  // Re-check compatibility whenever product OR location changes —
  // we want a warning the moment the user picks both. Reset the
  // explicit override on every change so the user has to re-ack.
  useEffect(() => {
    if (!tenant?.id || !productId || !locationId) {
      setConflicts([])
      setAcknowledgedConflict(false)
      return
    }
    let cancelled = false
    void (async () => {
      const headers = await buildHeaders()
      const url = `/api/chemicals/locations/${locationId}/compatibility-check?product=${productId}`
      const res = await fetch(url, { headers })
      if (cancelled) return
      if (!res.ok) {
        setConflicts([])
        return
      }
      const body = await res.json()
      setConflicts(body.conflicts ?? [])
      setAcknowledgedConflict(false)
    })()
    return () => { cancelled = true }
  }, [tenant, productId, locationId, buildHeaders])

  useEffect(() => {
    if (!tenant?.id) return
    void (async () => {
      const headers = await buildHeaders()
      const [pRes, lRes] = await Promise.all([
        fetch('/api/chemicals/products?limit=500', { headers }),
        fetch('/api/chemicals/locations',          { headers }),
      ])
      if (pRes.ok) {
        const body = await pRes.json()
        setProducts(body.products ?? [])
      }
      if (lRes.ok) {
        const body = await lRes.json() as { locations: LocationOpt[] }
        // Compute depth from path so the dropdown indents.
        const withDepth = (body.locations ?? []).map(l => ({
          ...l,
          depth: l.path ? l.path.split(' / ').length - 1 : 0,
        }))
        setLocations(withDepth)
      }
    })()
  }, [tenant, buildHeaders])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) return
    if (!productId) {
      setError('Pick a chemical product')
      return
    }
    if (conflicts.length > 0 && !acknowledgedConflict) {
      setError('Storage incompatibility flagged — acknowledge below or pick a different location.')
      return
    }
    const qty = Number.parseFloat(quantity)
    if (!Number.isFinite(qty) || qty < 0) {
      setError('Quantity must be a non-negative number')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch('/api/chemicals/inventory', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          product_id:     productId,
          location_id:    locationId || null,
          barcode:        barcode.trim() || undefined,
          quantity:       qty,
          unit,
          container_type: containerType || undefined,
          received_date:  receivedDate || null,
          expiration_date: expirationDate || null,
          lot_number:     lotNumber.trim() || null,
          purchase_order: purchaseOrder.trim() || null,
          notes:          notes.trim() || null,
          status:         requestApproval ? 'requested' : 'in_stock',
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      router.push(`/chemicals/inventory/${body.item.id}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals/inventory" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to inventory
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Add container</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Track a physical container of a chemical. Leave the barcode blank to auto-allocate one (printable from the container detail page).
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Chemical *">
          <select
            value={productId}
            onChange={e => setProductId(e.target.value)}
            required
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">— pick a chemical —</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.manufacturer ? ` · ${p.manufacturer}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Location">
          <select
            value={locationId}
            onChange={e => setLocationId(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">(unassigned)</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>
                {'— '.repeat(l.depth)}{l.name}
              </option>
            ))}
          </select>
        </Field>

        {conflicts.length > 0 && (
          <div className="rounded border border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30 px-3 py-2 space-y-2">
            <div className="text-sm font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Storage incompatibility — {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}
            </div>
            <ul className="text-xs text-rose-800 dark:text-rose-300 space-y-1.5">
              {conflicts.map(c => (
                <li key={c.product_id}>
                  <div className="font-medium">{c.product_name}</div>
                  {c.findings.map((f, i) => (
                    <div key={i} className="opacity-90">— {f.reason}</div>
                  ))}
                </li>
              ))}
            </ul>
            <label className="inline-flex items-center gap-2 text-xs text-rose-800 dark:text-rose-300 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledgedConflict}
                onChange={e => setAcknowledgedConflict(e.target.checked)}
                className="rounded"
              />
              I understand the conflict and want to proceed anyway
            </label>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Quantity *">
            <input
              type="number" min="0" step="any"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              required
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </Field>
          <Field label="Unit *">
            <select
              value={unit}
              onChange={e => setUnit(e.target.value as InventoryUnit)}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              {INVENTORY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Container type">
            <select
              value={containerType}
              onChange={e => setContainerType(e.target.value as ContainerType | '')}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">—</option>
              {CONTAINER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Barcode (auto-allocates if blank)">
            <input
              type="text"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              placeholder="CHEM-…"
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
            />
          </Field>
          <Field label="Lot number">
            <input
              type="text"
              value={lotNumber}
              onChange={e => setLotNumber(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Received">
            <input
              type="date"
              value={receivedDate}
              onChange={e => setReceivedDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </Field>
          <Field label="Expires">
            <input
              type="date"
              value={expirationDate}
              onChange={e => setExpirationDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </Field>
          <Field label="Purchase order">
            <input
              type="text"
              value={purchaseOrder}
              onChange={e => setPurchaseOrder(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
        </Field>

        <label className="flex items-start gap-2 text-sm rounded border border-slate-200 dark:border-slate-800 px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requestApproval}
            onChange={e => setRequestApproval(e.target.checked)}
            className="mt-0.5 rounded"
          />
          <span>
            <span className="font-medium text-slate-900 dark:text-slate-100">File as request</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Container is created with status &quot;requested&quot; and waits in the approval queue
              before it counts as in-stock. Use this when your tenant requires safety review on every receipt.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link
            href="/chemicals/inventory"
            className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700"
          >Cancel</Link>
          <button
            type="submit"
            disabled={submitting || !productId}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Saving…' : 'Save container'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}
