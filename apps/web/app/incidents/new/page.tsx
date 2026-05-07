'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, MapPin } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABEL,
  INCIDENT_SEVERITY_ACTUAL,
  SEVERITY_ACTUAL_LABEL,
  INCIDENT_SEVERITY_POTENTIAL,
  INCIDENT_PROBABILITY,
  INCIDENT_SHIFTS,
  INCIDENT_SPILL_UNITS,
  validateCreateInput,
  type IncidentType,
  type IncidentCreateInput,
  type IncidentSeverityActual,
  type IncidentSeverityPotential,
  type IncidentProbability,
  type IncidentShift,
  type IncidentSpillUnit,
} from '@soteria/core/incident'

// /incidents/new — Mobile-first intake form. Reporting is intentionally
// low-friction: any tenant member can file. Heavy lifting (classify,
// investigate, RCA, CAPA) lives on the detail page after intake.
//
// Single-page form rather than a multi-step wizard — Soteria's existing
// pattern (near-miss, JHA, hot-work intake) uses one-page forms with
// conditional sections; less Back/Next friction on a phone.

const TYPE_HELP: Record<IncidentType, string> = {
  injury_illness:   'A worker was hurt or got sick.',
  near_miss:        'No injury — but it almost happened.',
  property_damage:  'Equipment, vehicle, or facility damaged. No injury.',
  environmental:    'Spill, release, or environmental contamination.',
}

const SEVERITY_HELP: Record<IncidentSeverityActual, string> = {
  none:         'No injury or illness',
  first_aid:    'First-aid only (band-aid, ice pack, no medical visit)',
  medical:      'Medical treatment beyond first aid',
  lost_time:    'Worker missed days of work',
  fatality:     'A worker died from the event',
  catastrophic: 'Multiple severe injuries or facility-scale damage',
}

function isoLocalNow() {
  // <input type="datetime-local"> wants 'YYYY-MM-DDTHH:mm' in *local*
  // time. Adjust for offset so default value matches what the user
  // sees on their wall clock.
  const d = new Date()
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

export default function NewIncidentPage() {
  const router = useRouter()
  const { tenant } = useTenant()

  const [incidentType, setIncidentType] = useState<IncidentType | ''>('')
  const [occurredAt,   setOccurredAt]   = useState<string>(isoLocalNow())
  const [shift,        setShift]        = useState<IncidentShift | ''>('')
  const [location,     setLocation]     = useState<string>('')
  const [description,  setDescription]  = useState<string>('')
  const [immediate,    setImmediate]    = useState<string>('')

  const [severityActual,    setSeverityActual]    = useState<IncidentSeverityActual>('none')
  const [severityPotential, setSeverityPotential] = useState<IncidentSeverityPotential | ''>('')
  const [probability,       setProbability]       = useState<IncidentProbability | ''>('')

  // Environmental-only fields.
  const [spillSubstance, setSpillSubstance] = useState<string>('')
  const [spillQty,       setSpillQty]       = useState<string>('')   // string for input control
  const [spillUnit,      setSpillUnit]      = useState<IncidentSpillUnit | ''>('')

  // GPS — captured on demand via the button below.
  const [locationGeo,   setLocationGeo]   = useState<string | null>(null)
  const [gpsBusy,       setGpsBusy]       = useState(false)
  const [gpsError,      setGpsError]      = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const isInjury = incidentType === 'injury_illness'
  const isEnvironmental = incidentType === 'environmental'
  const isNearMiss = incidentType === 'near_miss'

  function captureGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocation not supported on this device.')
      return
    }
    setGpsBusy(true); setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Postgres point is "(x,y)" = "(lon,lat)".
        const lon = pos.coords.longitude.toFixed(6)
        const lat = pos.coords.latitude.toFixed(6)
        setLocationGeo(`(${lon},${lat})`)
        setGpsBusy(false)
      },
      (err) => {
        setGpsError(err.message || 'Unable to read location.')
        setGpsBusy(false)
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id) { setError('No active tenant — refresh and try again.'); return }
    if (!incidentType) { setError('Please pick an incident type.'); return }

    const occurredIso = new Date(occurredAt).toISOString()

    const input: Partial<IncidentCreateInput> = {
      incident_type:           incidentType,
      occurred_at:             occurredIso,
      description,
      location_text:           location.trim() || null,
      shift:                   shift || null,
      immediate_action_taken:  immediate.trim() || null,
      severity_actual:         isNearMiss ? 'none' : severityActual,
      severity_potential:      severityPotential || null,
      probability:             probability || null,
      location_geo:            locationGeo,
      spill_substance:         isEnvironmental ? (spillSubstance.trim() || null) : null,
      spill_quantity:          isEnvironmental && spillQty ? Number(spillQty) : null,
      spill_quantity_unit:     isEnvironmental ? (spillUnit || null) : null,
    }

    const validationError = validateCreateInput(input)
    if (validationError) { setError(validationError); return }

    setSubmitting(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/incidents/${body.report.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link
        href="/incidents"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to incidents
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Report an incident</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          File quickly — corrections, classification, and investigation happen on the next screen.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">

        {/* ── Type picker ──────────────────────────────────────────── */}
        <Field label="What kind of incident?" required>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {INCIDENT_TYPES.map(t => (
              <label
                key={t}
                className={
                  'flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ' +
                  (incidentType === t
                    ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600')
                }
              >
                <input
                  type="radio"
                  name="incident_type"
                  value={t}
                  checked={incidentType === t}
                  onChange={() => setIncidentType(t)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{INCIDENT_TYPE_LABEL[t]}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{TYPE_HELP[t]}</p>
                </div>
              </label>
            ))}
          </div>
        </Field>

        {/* ── When + Shift ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="When did it happen?" required>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={e => setOccurredAt(e.target.value)}
              max={isoLocalNow()}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Shift" hint="Optional">
            <select
              value={shift}
              onChange={e => setShift(e.target.value as IncidentShift)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm capitalize"
            >
              <option value="">—</option>
              {INCIDENT_SHIFTS.map(s => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* ── Location text + GPS ─────────────────────────────────── */}
        <Field label="Location" hint="Free text + optional GPS pin">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Loading dock B, Line 3 packaging"
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={captureGps}
              disabled={gpsBusy}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <MapPin className="h-3.5 w-3.5" />
              {locationGeo ? 'GPS captured' : (gpsBusy ? 'Locating…' : 'Tag GPS')}
            </button>
          </div>
          {locationGeo && (
            <p className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">{locationGeo}</p>
          )}
          {gpsError && (
            <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{gpsError}</p>
          )}
        </Field>

        {/* ── Description ──────────────────────────────────────────── */}
        <Field label="What happened?" required>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the event in plain language. What was the worker doing? What went wrong?"
            rows={5}
            required
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Immediate action taken" hint="What was done in the moments after">
          <textarea
            value={immediate}
            onChange={e => setImmediate(e.target.value)}
            placeholder="e.g. Equipment de-energized, area cordoned off, EMS called…"
            rows={2}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        {/* ── Severity (skip for near-miss) ─────────────────────────── */}
        {!isNearMiss && incidentType !== '' && (
          <Field label="Severity (actual)" required={isInjury} hint="Best guess at intake — refine on the classify tab">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {INCIDENT_SEVERITY_ACTUAL.map(s => (
                <label
                  key={s}
                  className={
                    'flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ' +
                    (severityActual === s
                      ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600')
                  }
                >
                  <input
                    type="radio"
                    name="severity_actual"
                    value={s}
                    checked={severityActual === s}
                    onChange={() => setSeverityActual(s)}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{SEVERITY_ACTUAL_LABEL[s]}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{SEVERITY_HELP[s]}</p>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        )}

        {/* ── Severity potential (always shown) ────────────────────── */}
        {incidentType !== '' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Severity potential" hint="What's the worst that could have happened?">
              <select
                value={severityPotential}
                onChange={e => setSeverityPotential(e.target.value as IncidentSeverityPotential)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm capitalize"
              >
                <option value="">—</option>
                {INCIDENT_SEVERITY_POTENTIAL.map(s => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </Field>

            <Field label="Probability" hint="If conditions repeated, how likely?">
              <select
                value={probability}
                onChange={e => setProbability(e.target.value as IncidentProbability)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm capitalize"
              >
                <option value="">—</option>
                {INCIDENT_PROBABILITY.map(p => (
                  <option key={p} value={p} className="capitalize">{p.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {/* ── Environmental-only fields ────────────────────────────── */}
        {isEnvironmental && (
          <fieldset className="space-y-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Spill / release detail
            </legend>
            <Field label="Substance">
              <input
                type="text"
                value={spillSubstance}
                onChange={e => setSpillSubstance(e.target.value)}
                placeholder="e.g. Hydraulic oil, Diesel, Sodium hydroxide"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={spillQty}
                  onChange={e => setSpillQty(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Unit">
                <select
                  value={spillUnit}
                  onChange={e => setSpillUnit(e.target.value as IncidentSpillUnit)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {INCIDENT_SPILL_UNITS.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
              EPA reportable-quantity check runs in Phase 6.
            </p>
          </fieldset>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/incidents"
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
          >
            {submitting ? 'Filing…' : 'File incident'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, hint, required, children }: {
  label:    string
  hint?:    string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}{required && <span className="text-rose-500"> *</span>}
        {hint && <span className="ml-2 text-[11px] font-normal text-slate-400">{hint}</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
