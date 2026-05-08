'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  EXPOSURE_ROUTES,
  EXPOSURE_ROUTE_LABEL,
  EXPOSURE_SEVERITIES,
  EXPOSURE_SEVERITY_LABEL,
  type ExposureRoute,
  type ExposureSeverity,
} from '@soteria/core/chemicals'

// Inline panel rendered on /incidents/[id] when the incident may
// involve a chemical agent. Captures the OSHA 301 / NIOSH-style
// exposure event that links the incident to a chemical_products row.

interface ProductOpt {
  id:           string
  name:         string
  manufacturer: string | null
}

interface ExposureEvent {
  id:                       string
  product_id:               string
  route:                    ExposureRoute
  estimated_quantity:       string | null
  exposure_duration_minutes: number | null
  severity:                 ExposureSeverity | null
  ppe_in_use:               string[]
  measured_ppm:             number | null
  notes:                    string | null
  created_at:               string
  chemical_products: {
    id:               string
    name:             string
    manufacturer:     string | null
    ghs_signal_word:  string | null
    ghs_pictograms:   string[] | null
    pel_twa_ppm:      number | null
    stel_ppm:         number | null
    idlh_ppm:         number | null
  } | null
}

interface Props { incidentId: string }

export default function ChemicalExposuresPanel({ incidentId }: Props) {
  const { tenant } = useTenant()
  const [events,   setEvents]   = useState<ExposureEvent[] | null>(null)
  const [products, setProducts] = useState<ProductOpt[]>([])
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [productId, setProductId] = useState('')
  const [route,     setRoute]     = useState<ExposureRoute>('inhalation')
  const [severity,  setSeverity]  = useState<ExposureSeverity | ''>('')
  const [estimatedQuantity, setEstimatedQuantity] = useState('')
  const [duration,  setDuration]  = useState<string>('')
  const [measuredPpm, setMeasuredPpm] = useState<string>('')
  const [ppe,       setPpe]       = useState<string>('')
  const [notes,     setNotes]     = useState('')

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
    const [eRes, pRes] = await Promise.all([
      fetch(`/api/incidents/${incidentId}/chemical-exposures`, { headers }),
      fetch('/api/chemicals/products?limit=500', { headers }),
    ])
    if (!eRes.ok) {
      const body = await eRes.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${eRes.status}`)
      setEvents([])
      return
    }
    const eBody = await eRes.json()
    setEvents(eBody.events ?? [])
    if (pRes.ok) {
      const pBody = await pRes.json()
      setProducts(pBody.products ?? [])
    }
  }, [tenant, incidentId, buildHeaders])

  useEffect(() => { void load() }, [load])

  function reset() {
    setProductId('')
    setRoute('inhalation')
    setSeverity('')
    setEstimatedQuantity('')
    setDuration('')
    setMeasuredPpm('')
    setPpe('')
    setNotes('')
  }

  async function add() {
    if (!productId) {
      setError('Pick a chemical')
      return
    }
    const dur = duration.trim() ? Number.parseInt(duration, 10) : null
    if (duration.trim() && (Number.isNaN(dur ?? NaN) || (dur ?? -1) < 0)) {
      setError('Duration must be a non-negative integer')
      return
    }
    const ppm = measuredPpm.trim() ? Number.parseFloat(measuredPpm) : null
    if (measuredPpm.trim() && (Number.isNaN(ppm ?? NaN) || (ppm ?? -1) < 0)) {
      setError('Measured ppm must be a non-negative number')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/incidents/${incidentId}/chemical-exposures`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          product_id:               productId,
          route,
          severity:                 severity || null,
          estimated_quantity:       estimatedQuantity.trim() || null,
          exposure_duration_minutes: dur,
          measured_ppm:             ppm,
          ppe_in_use:               ppe.split(',').map(s => s.trim()).filter(Boolean),
          notes:                    notes.trim() || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      reset()
      setShowForm(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(eventId: string) {
    if (!confirm('Delete this exposure event?')) return
    setBusy(true)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/incidents/${incidentId}/chemical-exposures/${eventId}`, {
        method: 'DELETE', headers,
      })
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
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FlaskConical className="w-4 h-4" /> Chemical exposures
        </h2>
        <button
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
        >
          <Plus className="w-3 h-3" /> Add exposure
        </button>
      </div>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {showForm && (
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-slate-50 dark:bg-slate-900">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Chemical *</span>
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
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Route *</span>
              <select
                value={route}
                onChange={e => setRoute(e.target.value as ExposureRoute)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                {EXPOSURE_ROUTES.map(r => (
                  <option key={r} value={r}>{EXPOSURE_ROUTE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Severity</span>
              <select
                value={severity}
                onChange={e => setSeverity(e.target.value as ExposureSeverity | '')}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="">—</option>
                {EXPOSURE_SEVERITIES.map(s => (
                  <option key={s} value={s}>{EXPOSURE_SEVERITY_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Estimated quantity</span>
              <input
                type="text"
                value={estimatedQuantity}
                onChange={e => setEstimatedQuantity(e.target.value)}
                placeholder="approx 1 cup, a few drops, …"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Duration (min)</span>
              <input
                type="number" min="0" step="1"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Measured ppm</span>
              <input
                type="number" min="0" step="any"
                value={measuredPpm}
                onChange={e => setMeasuredPpm(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">PPE in use (comma-separated)</span>
            <input
              type="text"
              value={ppe}
              onChange={e => setPpe(e.target.value)}
              placeholder="Nitrile gloves, half-face respirator, …"
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Notes</span>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); reset() }}
              className="px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700"
            >Cancel</button>
            <button
              onClick={() => void add()}
              disabled={busy || !productId}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add
            </button>
          </div>
        </div>
      )}

      {events === null ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : events.length === 0 ? (
        <div className="text-sm text-slate-500 italic">
          No chemical exposures recorded for this incident.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
          {events.map(ev => {
            const exceedsPel = typeof ev.measured_ppm === 'number'
              && typeof ev.chemical_products?.pel_twa_ppm === 'number'
              && ev.measured_ppm > ev.chemical_products.pel_twa_ppm
            return (
              <li key={ev.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/chemicals/${ev.product_id}`}
                    className="font-medium text-slate-900 dark:text-slate-100 hover:underline"
                  >
                    {ev.chemical_products?.name ?? '(unknown chemical)'}
                  </Link>
                  <span className="text-xs text-slate-500">via {EXPOSURE_ROUTE_LABEL[ev.route]}</span>
                  {ev.severity && (
                    <span className="text-xs text-slate-500">· {EXPOSURE_SEVERITY_LABEL[ev.severity]}</span>
                  )}
                  {exceedsPel && (
                    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                      EXCEEDS PEL ({ev.chemical_products?.pel_twa_ppm} ppm)
                    </span>
                  )}
                  <button
                    onClick={() => void remove(ev.id)}
                    disabled={busy}
                    className="ml-auto text-slate-400 hover:text-rose-600 disabled:opacity-50"
                    title="Delete exposure event"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
                  {ev.estimated_quantity && <span>qty: {ev.estimated_quantity}</span>}
                  {typeof ev.exposure_duration_minutes === 'number' && <span>· {ev.exposure_duration_minutes}m</span>}
                  {typeof ev.measured_ppm === 'number' && <span>· {ev.measured_ppm} ppm</span>}
                  {ev.ppe_in_use.length > 0 && <span>· PPE: {ev.ppe_in_use.join(', ')}</span>}
                </div>
                {ev.notes && (
                  <div className="mt-1 text-xs text-slate-700 dark:text-slate-300 italic">{ev.notes}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
