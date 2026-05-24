'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  VEHICLE_TYPES, VEHICLE_TYPE_LABELS, VEHICLE_STATUSES, FUEL_TYPES,
  DOT_VEHICLE_CLASSES, validateVehicleInput, type VehicleInput, type VehicleType,
} from '@soteria/core/fleet'

// Shared create/edit form for a fleet vehicle. Identity + classification +
// comprehensive DOT fields + the hazmat flag. Placards, documents, linked
// chemicals, and the photo are managed on the detail page once the vehicle
// exists (they need its id).

type DriverOption = { id: string; label: string }

export function VehicleForm({
  initial = {}, submitLabel, drivers = [], onSubmit,
}: {
  initial?: Partial<VehicleInput>
  submitLabel: string
  drivers?: DriverOption[]
  onSubmit: (input: VehicleInput) => Promise<void>
}) {
  const [v, setV] = useState<VehicleInput>({
    vehicle_type: 'other', status: 'active', ifta_registered: false, carries_hazmat: false, ...initial,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) {
    setV(prev => ({ ...prev, [key]: value }))
  }
  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateVehicleInput(v)
    if (problem) { setError(problem); return }
    setSaving(true); setError(null)
    try { await onSubmit(v) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      <Section title="Identity">
        <Text label="Unit number" value={v.unit_number ?? ''} onChange={s => set('unit_number', s)} placeholder="T-104" />
        <Text label="VIN" value={v.vin ?? ''} onChange={s => set('vin', s)} />
        <Text label="Make" value={v.make ?? ''} onChange={s => set('make', s)} />
        <Text label="Model" value={v.model ?? ''} onChange={s => set('model', s)} />
        <Text label="Model year" type="number" value={v.model_year != null ? String(v.model_year) : ''} onChange={s => set('model_year', s.trim() ? parseInt(s, 10) : null)} />
        <Text label="License plate" value={v.license_plate ?? ''} onChange={s => set('license_plate', s)} />
        <Text label="Plate state" value={v.license_plate_state ?? ''} onChange={s => set('license_plate_state', s)} />
        <Select label="Type" value={v.vehicle_type ?? 'other'} onChange={s => set('vehicle_type', s as VehicleType)} options={VEHICLE_TYPES.map(t => ({ value: t, label: VEHICLE_TYPE_LABELS[t] }))} />
        <Select label="Status" value={v.status ?? 'active'} onChange={s => set('status', s as VehicleInput['status'])} options={VEHICLE_STATUSES.map(s => ({ value: s, label: s.replace(/_/g, ' ') }))} />
      </Section>

      <Section title="DOT & operations">
        <Text label="USDOT number" value={v.usdot_number ?? ''} onChange={s => set('usdot_number', s)} />
        <Text label="MC number" value={v.mc_number ?? ''} onChange={s => set('mc_number', s)} />
        <Text label="GVWR (lbs)" type="number" value={v.gvwr_lbs != null ? String(v.gvwr_lbs) : ''} onChange={s => set('gvwr_lbs', num(s))} />
        <Select label="DOT weight class" value={v.dot_vehicle_class ?? ''} onChange={s => set('dot_vehicle_class', (s || null) as VehicleInput['dot_vehicle_class'])} options={[{ value: '', label: '—' }, ...DOT_VEHICLE_CLASSES.map(c => ({ value: c, label: `Class ${c}` }))]} />
        <Select label="Fuel type" value={v.fuel_type ?? ''} onChange={s => set('fuel_type', (s || null) as VehicleInput['fuel_type'])} options={[{ value: '', label: '—' }, ...FUEL_TYPES.map(f => ({ value: f, label: f }))]} />
        <Text label="Odometer (mi)" type="number" value={v.odometer_miles != null ? String(v.odometer_miles) : ''} onChange={s => set('odometer_miles', num(s))} />
        <Text label="Annual DOT inspection" type="date" value={v.annual_dot_inspection_at ?? ''} onChange={s => set('annual_dot_inspection_at', s || null)} />
        <Checkbox label="IFTA registered" checked={!!v.ifta_registered} onChange={b => set('ifta_registered', b)} />
        {drivers.length > 0 && (
          <Select label="Assigned driver" value={v.assigned_driver_id ?? ''} onChange={s => set('assigned_driver_id', s || null)} options={[{ value: '', label: '— none —' }, ...drivers.map(d => ({ value: d.id, label: d.label }))]} />
        )}
        <Text label="Home location" value={v.home_location_text ?? ''} onChange={s => set('home_location_text', s)} />
      </Section>

      <Section title="Hazmat">
        <Checkbox label="Carries hazardous materials" checked={!!v.carries_hazmat} onChange={b => set('carries_hazmat', b)} />
        <Text label="Hazmat notes" value={v.hazmat_notes ?? ''} onChange={s => set('hazmat_notes', s)} wide />
        {v.carries_hazmat && <p className="col-span-full text-xs text-slate-500 dark:text-slate-400">After saving, add DOT placards and link the chemical products (SDS) this vehicle carries on the vehicle detail page.</p>}
      </Section>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</label>
        <textarea value={v.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={3} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
      </div>

      <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} {submitLabel}
      </button>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <legend className="px-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  )
}

function Text({ label, value, onChange, type = 'text', placeholder, wide }: { label: string; value: string; onChange: (s: string) => void; type?: string; placeholder?: string; wide?: boolean }) {
  return (
    <label className={'block ' + (wide ? 'sm:col-span-2 lg:col-span-3' : '')}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
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

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 self-end pb-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
      <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
    </label>
  )
}
