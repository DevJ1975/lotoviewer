'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Archive, ArchiveRestore, Loader2, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  HAZARDOUS_WASTE_AREA_LABEL,
  type HazardousWasteAreaRow,
  type HazardousWasteAreaType,
} from '@soteria/core/hazardousWaste'

// /hazardous-waste/areas — tenant-admin surface to list, add, rename,
// retune cadence, and archive accumulation areas. Read access is open
// to every tenant member but the write controls only render for
// admins / superadmins (the API enforces this independently).

interface AreaRow extends HazardousWasteAreaRow {
  last_inspected_at: string | null
}

const AREA_TYPE_OPTIONS: ReadonlyArray<{ value: HazardousWasteAreaType; label: string }> = (
  Object.entries(HAZARDOUS_WASTE_AREA_LABEL) as Array<[HazardousWasteAreaType, string]>
).map(([value, label]) => ({ value, label }))

export default function HazardousWasteAreasPage() {
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canWrite = !!profile?.is_admin || !!profile?.is_superadmin

  const [areas,        setAreas]       = useState<AreaRow[] | null>(null)
  const [error,        setError]       = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const url = `/api/hazardous-waste/areas${showArchived ? '?include_archived=true' : ''}`
      const res = await fetch(url, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setAreas(body.areas ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id, showArchived])

  useEffect(() => { void load() }, [load])

  async function patchArea(id: string, patch: Record<string, unknown>) {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant.id,
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(`/api/hazardous-waste/areas/${id}`, {
      method:  'PATCH',
      headers,
      body:    JSON.stringify(patch),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    await load()
  }

  async function deleteArea(id: string, name: string) {
    if (!tenant?.id) return
    if (!confirm(`Delete "${name}"? Inspections recorded for this area will also be removed.`)) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(`/api/hazardous-waste/areas/${id}`, { method: 'DELETE', headers })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    await load()
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/hazardous-waste"
            aria-label="Back to Hazardous Waste hub"
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Accumulation Areas</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Define each accumulation, universal-waste, used-oil, and inspection-only location
              so technicians can log walk-throughs against them.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Show archived
        </label>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      {canWrite && <NewAreaForm onCreated={load} setError={setError} />}

      {areas === null ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : areas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
          No areas yet. {canWrite ? 'Add one using the form above.' : 'Ask a tenant admin to add one.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {areas.map(area => (
            <li
              key={area.id}
              className={
                'rounded-lg border p-4 flex flex-wrap items-start justify-between gap-3 ' +
                (area.archived_at
                  ? 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40'
                  : 'border-slate-200 dark:border-slate-800')
              }
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{area.name}</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {HAZARDOUS_WASTE_AREA_LABEL[area.area_type]}
                  </span>
                  {area.archived_at && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cadence every {area.weekly_cadence_days} day{area.weekly_cadence_days === 1 ? '' : 's'}
                  {area.location_notes ? ` · ${area.location_notes}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {!area.archived_at && (
                  <Link
                    href={`/hazardous-waste/inspections/new?area=${encodeURIComponent(area.id)}`}
                    className="text-xs font-semibold text-brand-navy hover:underline"
                  >
                    Inspect
                  </Link>
                )}
                {canWrite && (
                  <>
                    <button
                      type="button"
                      onClick={() => void patchArea(area.id, { archived: !area.archived_at })}
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      title={area.archived_at ? 'Restore' : 'Archive'}
                    >
                      {area.archived_at ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      {area.archived_at ? 'Restore' : 'Archive'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteArea(area.id, area.name)}
                      className="inline-flex items-center gap-1 text-xs text-rose-700 hover:text-rose-900 dark:text-rose-300 dark:hover:text-rose-100"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function NewAreaForm({
  onCreated, setError,
}: {
  onCreated: () => void | Promise<void>
  setError:  (msg: string | null) => void
}) {
  const { tenant } = useTenant()
  const [name,    setName]    = useState('')
  const [areaType, setAreaType] = useState<HazardousWasteAreaType>('central_accumulation')
  const [cadence, setCadence] = useState(7)
  const [notes,   setNotes]   = useState('')
  const [busy,    setBusy]    = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id || busy) return
    setBusy(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/hazardous-waste/areas', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name:                 name.trim(),
          area_type:            areaType,
          weekly_cadence_days:  cadence,
          location_notes:       notes.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setName(''); setNotes(''); setCadence(7); setAreaType('central_accumulation')
      await onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const valid = name.trim().length > 0 && cadence >= 1 && cadence <= 90

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 grid grid-cols-1 md:grid-cols-[1.5fr_1fr_0.6fr_2fr_auto] gap-3 items-end"
    >
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</span>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Central accumulation — Bldg 4"
          maxLength={120}
          required
          className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</span>
        <select
          value={areaType}
          onChange={e => setAreaType(e.target.value as HazardousWasteAreaType)}
          className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        >
          {AREA_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cadence (days)</span>
        <input
          type="number"
          value={cadence}
          onChange={e => setCadence(Number.parseInt(e.target.value, 10) || 0)}
          min={1}
          max={90}
          className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Location notes</span>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional"
          className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={!valid || busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-brand-navy/90"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add area
      </button>
    </form>
  )
}
