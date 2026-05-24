'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  LICENSE_CLASSES, LICENSE_CLASS_LABELS, DRIVER_STATUSES, KNOWN_ENDORSEMENTS,
  validateDriverInput, type DriverInput, type LicenseClass,
} from '@soteria/core/fleetDriver'
import { searchWorkers, type WorkerOption } from '@/lib/fleet/client'

// Shared create/edit form for a driver profile. On create it includes a
// worker picker (the roster link is required); on edit the worker is fixed.

export function DriverForm({
  tenantId, initial = {}, submitLabel, includeWorkerPicker, workerName, onSubmit,
}: {
  tenantId: string
  initial?: Partial<DriverInput>
  submitLabel: string
  includeWorkerPicker: boolean
  workerName?: string
  onSubmit: (input: DriverInput) => Promise<void>
}) {
  const [d, setD] = useState<DriverInput>({ status: 'active', hazmat_endorsement: false, endorsements: [], ...initial })
  const [worker, setWorker] = useState<WorkerOption | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<WorkerOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof DriverInput>(k: K, v: DriverInput[K]) { setD(prev => ({ ...prev, [k]: v })) }

  useEffect(() => {
    if (!includeWorkerPicker || !q.trim()) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(() => { void searchWorkers(tenantId, q).then(r => { if (!cancelled) setResults(r) }).catch(() => {}) }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, includeWorkerPicker, tenantId])

  function toggleEndorsement(e: string) {
    const cur = d.endorsements ?? []
    set('endorsements', cur.includes(e) ? cur.filter(x => x !== e) : [...cur, e])
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    const problem = validateDriverInput(d, includeWorkerPicker)
    if (problem) { setError(problem); return }
    setSaving(true); setError(null)
    try { await onSubmit(d) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      <fieldset className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <legend className="px-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Driver</legend>
        {includeWorkerPicker ? (
          <div className="relative">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Roster worker</span>
            {worker ? (
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <span>{worker.full_name}{worker.employee_id ? ` · ${worker.employee_id}` : ''}</span>
                <button type="button" onClick={() => { setWorker(null); set('worker_id', undefined) }} className="text-xs text-slate-500 hover:underline">Change</button>
              </div>
            ) : (
              <>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the worker roster…" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
                {results.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {results.map(w => <li key={w.id}><button type="button" onClick={() => { setWorker(w); set('worker_id', w.id); setResults([]); setQ('') }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">{w.full_name}{w.employee_id ? ` · ${w.employee_id}` : ''}</button></li>)}
                  </ul>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">Worker: <span className="font-medium text-slate-900 dark:text-slate-100">{workerName ?? '—'}</span></p>
        )}
      </fieldset>

      <fieldset className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <legend className="px-2 text-sm font-semibold text-slate-700 dark:text-slate-300">License & medical</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Text label="License number" value={d.license_number ?? ''} onChange={s => set('license_number', s)} />
          <Select label="License class" value={d.license_class ?? ''} onChange={s => set('license_class', (s || null) as LicenseClass | null)} options={[{ value: '', label: '—' }, ...LICENSE_CLASSES.map(c => ({ value: c, label: LICENSE_CLASS_LABELS[c] }))]} />
          <Text label="License state" value={d.license_state ?? ''} onChange={s => set('license_state', s)} />
          <Text label="License expires" type="date" value={d.license_expires_at ?? ''} onChange={s => set('license_expires_at', s || null)} />
          <Text label="DOT medical card expires" type="date" value={d.medical_card_expires_at ?? ''} onChange={s => set('medical_card_expires_at', s || null)} />
          <Text label="Defensive training date" type="date" value={d.defensive_training_at ?? ''} onChange={s => set('defensive_training_at', s || null)} />
          <Select label="Status" value={d.status ?? 'active'} onChange={s => set('status', s as DriverInput['status'])} options={DRIVER_STATUSES.map(s => ({ value: s, label: s }))} />
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <legend className="px-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Endorsements</legend>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!d.hazmat_endorsement} onChange={e => set('hazmat_endorsement', e.target.checked)} className="h-4 w-4 rounded border-slate-300" /><span className="text-sm">Hazmat endorsement (HME)</span></label>
        {d.hazmat_endorsement && <div className="mt-2 max-w-xs"><Text label="HME expires" type="date" value={d.hazmat_endorsement_expires_at ?? ''} onChange={s => set('hazmat_endorsement_expires_at', s || null)} /></div>}
        <div className="mt-3 flex flex-wrap gap-2">
          {KNOWN_ENDORSEMENTS.map(e => {
            const on = (d.endorsements ?? []).includes(e)
            return <button key={e} type="button" onClick={() => toggleEndorsement(e)} className={'rounded-full border px-3 py-1 text-xs font-semibold capitalize ' + (on ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400')}>{e.replace(/_/g, ' ')}</button>
          })}
        </div>
      </fieldset>

      <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />} {submitLabel}</button>
    </form>
  )
}

function Text({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (s: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
    </label>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (s: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm capitalize dark:border-slate-700 dark:bg-slate-900">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
