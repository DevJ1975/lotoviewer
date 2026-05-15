'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  HAZARDOUS_WASTE_AREA_LABEL,
  HAZARDOUS_WASTE_CONTAINER_STATUSES,
  HAZARDOUS_WASTE_VOLUME_UNITS,
  type HazardousWasteAreaType,
  type HazardousWasteContainerStatus,
  type HazardousWasteStreamRow,
  type HazardousWasteVolumeUnit,
} from '@soteria/core/hazardousWaste'

const AREA_TYPES: HazardousWasteAreaType[] = [
  'satellite_accumulation', 'central_accumulation',
  'universal_waste', 'used_oil', 'inspection_only',
]

export default function NewHazardousWasteContainerPage() {
  const router = useRouter()
  const search = useSearchParams()
  const { tenant } = useTenant()
  const prefilledStream = search?.get('stream_id') ?? ''

  const [streams, setStreams]                       = useState<HazardousWasteStreamRow[] | null>(null)
  const [streamId, setStreamId]                     = useState(prefilledStream)
  const [label, setLabel]                           = useState('')
  const [areaType, setAreaType]                     = useState<HazardousWasteAreaType>('satellite_accumulation')
  const [areaLocation, setAreaLocation]             = useState('')
  const [startDate, setStartDate]                   = useState('') // datetime-local value
  const [volumeQuantity, setVolumeQuantity]         = useState('')
  const [volumeUnit, setVolumeUnit]                 = useState<HazardousWasteVolumeUnit | ''>('')
  const [status, setStatus]                         = useState<HazardousWasteContainerStatus>('open')
  const [notes, setNotes]                           = useState('')
  const [submitting, setSubmitting]                 = useState(false)
  const [error, setError]                           = useState<string | null>(null)

  const loadStreams = useCallback(async () => {
    if (!tenant?.id) return
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch('/api/hazardous-waste/streams?status=active', { headers })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to load streams'); return }
    setStreams(json.streams ?? [])
    if (!streamId && (json.streams?.length ?? 0) > 0) {
      setStreamId(json.streams[0].id)
    }
  }, [tenant?.id, streamId])

  useEffect(() => { void loadStreams() }, [loadStreams])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!tenant?.id) { setError('No active tenant'); return }
    if (!streamId) { setError('Stream is required'); return }
    setError(null)
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'x-active-tenant': tenant.id,
      'content-type':    'application/json',
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const res = await fetch('/api/hazardous-waste/containers', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        stream_id:               streamId,
        label,
        area_type:               areaType,
        area_location:           areaLocation || null,
        accumulation_started_at: startDate ? new Date(startDate).toISOString() : null,
        volume_quantity:         volumeQuantity.trim() ? Number(volumeQuantity) : null,
        volume_unit:             volumeUnit || null,
        status,
        notes:                   notes || null,
      }),
    })
    const json = await res.json()
    setSubmitting(false)
    if (!res.ok) { setError(json.error ?? 'Failed to create'); return }
    router.push('/hazardous-waste/containers')
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste/containers" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Containers
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New container</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Connects a physical container to a waste stream and accumulation area. Set the accumulation
          start date when the container moves to central accumulation so the age clock starts ticking.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Waste stream *" hint="Only active streams appear here. Need a new one? Create the stream first.">
          <select
            value={streamId}
            onChange={e => setStreamId(e.target.value)}
            required
            className={inputCls}
          >
            <option value="">— Select a stream —</option>
            {(streams ?? []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {streams && streams.length === 0 && (
            <span className="block text-[11px] text-amber-700 dark:text-amber-300">
              No active streams yet — <Link href="/hazardous-waste/streams/new" className="underline">create a stream</Link> first.
            </span>
          )}
        </Field>

        <Field label="Container label *" hint="A label that field workers can read (e.g. drum number or barcode)">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={120}
            required
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Area type">
            <select
              value={areaType}
              onChange={e => setAreaType(e.target.value as HazardousWasteAreaType)}
              className={inputCls}
            >
              {AREA_TYPES.map(a => (
                <option key={a} value={a}>{HAZARDOUS_WASTE_AREA_LABEL[a]}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={e => setStatus(e.target.value as HazardousWasteContainerStatus)}
              className={inputCls}
            >
              {HAZARDOUS_WASTE_CONTAINER_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Area location" hint="Building, room, or accumulation area name">
          <input
            value={areaLocation}
            onChange={e => setAreaLocation(e.target.value)}
            maxLength={200}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Accumulation start" hint="Date container moved to central accumulation">
            <input
              type="datetime-local"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Volume quantity">
            <input
              type="number"
              step="0.001"
              min="0"
              value={volumeQuantity}
              onChange={e => setVolumeQuantity(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Volume unit">
            <select
              value={volumeUnit}
              onChange={e => setVolumeUnit(e.target.value as HazardousWasteVolumeUnit | '')}
              className={inputCls}
            >
              <option value="">(none)</option>
              {HAZARDOUS_WASTE_VOLUME_UNITS.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
            className={inputCls}
          />
        </Field>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create container
          </button>
          <Link
            href="/hazardous-waste/containers"
            className="text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}
