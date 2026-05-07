'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, Plus, Save } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// /osha/establishments — admin CRUD for OSHA establishments.
//
// Each establishment carries the address + NAICS + per-year hours/
// employees inputs that drive the 300A annual rate calculations. The
// per-year hours editor lives inline on each establishment row — the
// admin types the year + hours + employees and saves. We don't
// expose the full hours_employees_by_year jsonb to the UI; the API
// merges the year-input on PATCH.

interface Establishment {
  id:                          string
  establishment_name:          string
  street:                      string | null
  city:                        string | null
  state:                       string | null
  zip:                         string | null
  naics_code:                  string | null
  hours_employees_by_year:     Record<string, { employees?: number; hours?: number }> | null
  certifying_executive_name:   string | null
  certifying_executive_title:  string | null
  is_partial_year:             boolean
}

export default function EstablishmentsPage() {
  const { tenant } = useTenant()

  const [items,   setItems]   = useState<Establishment[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [showNew, setShowNew] = useState(false)

  // New form state.
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newState, setNewState] = useState('')
  const [newNaics, setNewNaics] = useState('')

  const load = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/osha/establishments', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setItems(body.establishments as Establishment[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => { void load() }, [load])

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant!.id,
    }
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  async function createEst(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) { setError('Name is required'); return }
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch('/api/osha/establishments', {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          establishment_name: newName.trim(),
          city:               newCity.trim() || undefined,
          state:              newState.trim() || undefined,
          naics_code:         newNaics.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setItems(prev => [...prev, body.establishment as Establishment])
      setNewName(''); setNewCity(''); setNewState(''); setNewNaics('')
      setShowNew(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/osha" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to OSHA dashboard
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">OSHA establishments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            One row per physical location / business unit. Drives the 300A and ITA forms.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(s => !s)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" />
          {showNew ? 'Cancel' : 'New establishment'}
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showNew && (
        <form onSubmit={createEst} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Establishment name" required>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm" />
            </Field>
            <Field label="NAICS code">
              <input type="text" value={newNaics} onChange={e => setNewNaics(e.target.value)}
                placeholder="6-digit"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm" />
            </Field>
            <Field label="City">
              <input type="text" value={newCity} onChange={e => setNewCity(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm" />
            </Field>
            <Field label="State">
              <input type="text" value={newState} onChange={e => setNewState(e.target.value)}
                placeholder="2 letters" maxLength={2}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm uppercase" />
            </Field>
          </div>
          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && items.length === 0 && !showNew && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No establishments yet.</p>
        </div>
      )}

      <ul className="space-y-3">
        {items.map(e => (
          <EstablishmentRow key={e.id} establishment={e} onChanged={load} authedHeaders={authedHeaders} />
        ))}
      </ul>
    </div>
  )
}

function EstablishmentRow({
  establishment, onChanged, authedHeaders,
}: {
  establishment:  Establishment
  onChanged:      () => Promise<void>
  authedHeaders:  () => Promise<Record<string, string>>
}) {
  const e = establishment
  const now = new Date()
  const [yr, setYr] = useState<number>(now.getFullYear() - 1)
  const yearKey = String(yr)
  const existing = e.hours_employees_by_year?.[yearKey] ?? { employees: 0, hours: 0 }
  const [employees, setEmployees] = useState<number>(existing.employees ?? 0)
  const [hours,     setHours]     = useState<number>(existing.hours     ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveYear() {
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/osha/establishments?id=${e.id}`, {
        method:  'PATCH',
        headers,
        body:    JSON.stringify({
          year: yr,
          annual_avg_employees: employees,
          total_hours_worked:   hours,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{e.establishment_name}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {[e.city, e.state, e.zip].filter(Boolean).join(', ') || 'No address'}
            {e.naics_code && ` · NAICS ${e.naics_code}`}
          </p>
        </div>
        {e.certifying_executive_name && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Certifier: {e.certifying_executive_name}
            {e.certifying_executive_title && ` (${e.certifying_executive_title})`}
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[100px_1fr_1fr_auto] gap-2 items-end">
        <Field label="Year">
          <input
            type="number"
            min="2000" max="2100"
            value={yr}
            onChange={ev => setYr(parseInt(ev.target.value, 10) || now.getFullYear() - 1)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Avg # of employees">
          <input
            type="number"
            min="0"
            value={employees}
            onChange={ev => setEmployees(Math.max(0, Number(ev.target.value) || 0))}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Total hours worked">
          <input
            type="number"
            min="0"
            value={hours}
            onChange={ev => setHours(Math.max(0, Number(ev.target.value) || 0))}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
          />
        </Field>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveYear()}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          Save
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </li>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}{required && <span className="text-rose-500"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
