'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, FlameKindling, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { INVENTORY_UNITS, type InventoryUnit } from '@soteria/core/chemicals'

interface MaqStatus {
  total_in_unit:              number
  headroom:                   number
  exceeds_cap:                boolean
  containers_in_other_units:  number
}

interface MaqRule {
  id:            string
  location_id:   string | null
  storage_class: string | null
  product_id:    string | null
  unit:          InventoryUnit
  max_quantity:  number
  reference:     string | null
  notes:         string | null
  created_at:    string
  status:        MaqStatus | null
  chemical_locations: { id: string; name: string; path: string | null } | null
  chemical_products:  { id: string; name: string; manufacturer: string | null } | null
}

interface ProductOpt  { id: string; name: string; manufacturer: string | null }
interface LocationOpt { id: string; name: string; path: string | null; depth: number }

const INSERTABLE_UNITS = INVENTORY_UNITS.filter(u => u !== 'other')

export default function MaqAdminPage() {
  const { tenant } = useTenant()
  const [rules,    setRules]    = useState<MaqRule[] | null>(null)
  const [products, setProducts] = useState<ProductOpt[]>([])
  const [locations, setLocations] = useState<LocationOpt[]>([])
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState(false)
  const [showAdd,  setShowAdd]  = useState(false)

  const [matchKind,    setMatchKind]    = useState<'storage_class' | 'product'>('storage_class')
  const [storageClass, setStorageClass] = useState('')
  const [productId,    setProductId]    = useState('')
  const [locationId,   setLocationId]   = useState('')
  const [unit,         setUnit]         = useState<InventoryUnit>('gal')
  const [maxQuantity,  setMaxQuantity]  = useState('')
  const [reference,    setReference]    = useState('')
  const [notes,        setNotes]        = useState('')

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
    const [rRes, pRes, lRes] = await Promise.all([
      fetch('/api/chemicals/maq',                { headers }),
      fetch('/api/chemicals/products?limit=500', { headers }),
      fetch('/api/chemicals/locations',          { headers }),
    ])
    const rBody = await rRes.json()
    if (!rRes.ok) {
      setError(rBody.error ?? `HTTP ${rRes.status}`)
      setRules([])
      return
    }
    setRules(rBody.rules ?? [])
    if (pRes.ok) setProducts((await pRes.json()).products ?? [])
    if (lRes.ok) {
      const lBody = await lRes.json() as { locations: LocationOpt[] }
      setLocations((lBody.locations ?? []).map(l => ({
        ...l,
        depth: l.path ? l.path.split(' / ').length - 1 : 0,
      })))
    }
  }, [tenant, buildHeaders])

  useEffect(() => { void load() }, [load])

  const exceededCount = useMemo(
    () => (rules ?? []).filter(r => r.status?.exceeds_cap).length,
    [rules],
  )

  function reset() {
    setMatchKind('storage_class')
    setStorageClass('')
    setProductId('')
    setLocationId('')
    setUnit('gal')
    setMaxQuantity('')
    setReference('')
    setNotes('')
  }

  async function add() {
    const qty = Number.parseFloat(maxQuantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Max quantity must be a positive number')
      return
    }
    if (matchKind === 'storage_class' && !storageClass.trim()) {
      setError('Storage class is required')
      return
    }
    if (matchKind === 'product' && !productId) {
      setError('Pick a chemical')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch('/api/chemicals/maq', {
        method:  'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body:    JSON.stringify({
          storage_class: matchKind === 'storage_class' ? storageClass.trim() : null,
          product_id:    matchKind === 'product'       ? productId           : null,
          location_id:   locationId || null,
          unit,
          max_quantity:  qty,
          reference:     reference.trim() || null,
          notes:         notes.trim()     || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      reset()
      setShowAdd(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this MAQ rule?')) return
    setBusy(true)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/chemicals/maq/${id}`, { method: 'DELETE', headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FlameKindling className="w-6 h-6" /> Maximum allowable quantities
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Fire-code (IFC / NFPA 30) caps per storage class or product, scoped optionally to a location.
            Rules above are compared against live inventory; over-cap rooms surface here and on the dashboard.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
        >
          <Plus className="w-4 h-4" /> Add rule
        </button>
      </header>

      {exceededCount > 0 && (
        <div className="rounded border border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>{exceededCount} rule{exceededCount === 1 ? '' : 's'} exceeded.</strong>
            {' '}Reduce on-hand quantity or move containers to another location.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 self-center">Match by:</span>
            {(['storage_class', 'product'] as const).map(k => (
              <label key={k} className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  checked={matchKind === k}
                  onChange={() => setMatchKind(k)}
                />
                {k === 'storage_class' ? 'Storage class' : 'Specific chemical'}
              </label>
            ))}
          </div>

          {matchKind === 'storage_class' ? (
            <Field label="Storage class (matches by ILIKE)">
              <input
                type="text"
                value={storageClass}
                onChange={e => setStorageClass(e.target.value)}
                placeholder="flammable, acid, oxidizer, …"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </Field>
          ) : (
            <Field label="Chemical">
              <select
                value={productId}
                onChange={e => setProductId(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="">— pick a chemical —</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.manufacturer ? ` · ${p.manufacturer}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Location (optional — site-wide if blank)">
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">(any location)</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>
                  {'— '.repeat(l.depth)}{l.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Max quantity">
              <input
                type="number" min="0" step="any"
                value={maxQuantity}
                onChange={e => setMaxQuantity(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </Field>
            <Field label="Unit">
              <select
                value={unit}
                onChange={e => setUnit(e.target.value as InventoryUnit)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                {INSERTABLE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Reference">
              <input
                type="text"
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="IFC 2018 Tbl 5003.1.1(1)"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </Field>
          </div>

          <Field label="Notes">
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </Field>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowAdd(false); reset() }}
              className="px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700"
            >Cancel</button>
            <button
              onClick={() => void add()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add rule
            </button>
          </div>
        </div>
      )}

      {rules === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No MAQ rules configured. Add one above to start tracking fire-code caps.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {rules.map(r => {
            const total = r.status?.total_in_unit ?? 0
            const ratio = r.max_quantity > 0 ? Math.min(1.5, total / r.max_quantity) : 0
            return (
              <li key={r.id} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {r.storage_class
                    ? <span className="font-medium text-slate-900 dark:text-slate-100">storage class &quot;{r.storage_class}&quot;</span>
                    : (
                      <Link
                        href={`/chemicals/${r.chemical_products?.id ?? ''}`}
                        className="font-medium text-slate-900 dark:text-slate-100 hover:underline"
                      >
                        {r.chemical_products?.name ?? '(unknown product)'}
                      </Link>
                    )
                  }
                  <span className="text-xs text-slate-500">
                    @ {r.chemical_locations?.path ?? '(any location)'}
                  </span>
                  <span className="ml-auto inline-flex items-baseline gap-1 font-mono">
                    <span className={`text-sm font-bold ${r.status?.exceeds_cap ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100'}`}>
                      {total}
                    </span>
                    <span className="text-xs text-slate-500">/ {r.max_quantity} {r.unit}</span>
                  </span>
                  <button
                    onClick={() => void remove(r.id)}
                    disabled={busy}
                    className="text-slate-400 hover:text-rose-600 disabled:opacity-50"
                    title="Delete rule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Fill bar */}
                <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={
                      r.status?.exceeds_cap ? 'h-full bg-rose-500'
                      : ratio > 0.8         ? 'h-full bg-amber-500'
                      : 'h-full bg-emerald-500'
                    }
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </div>

                <div className="text-xs text-slate-500 flex flex-wrap gap-x-3">
                  {r.reference && <span>{r.reference}</span>}
                  {r.notes && <span>· {r.notes}</span>}
                  {(r.status?.containers_in_other_units ?? 0) > 0 && (
                    <span className="text-amber-700 dark:text-amber-300">
                      · {r.status?.containers_in_other_units} container(s) in another unit are not counted
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}
