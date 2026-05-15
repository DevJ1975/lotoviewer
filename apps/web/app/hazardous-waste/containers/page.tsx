'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ageStatusForContainer,
  HAZARDOUS_WASTE_AREA_LABEL,
  HAZARDOUS_WASTE_CONTAINER_STATUSES,
  type ContainerAgeStatus,
  type HazardousWasteContainerRow,
  type HazardousWasteContainerStatus,
  type HazardousWasteStreamRow,
} from '@soteria/core/hazardousWaste'

// Container list — surfaces accumulation aging using the containerAgeStatus
// helper. Open containers with an old start date appear first so the
// operator's eye lands on the highest-risk drum.

type ContainerWithStream = HazardousWasteContainerRow & {
  stream: Pick<HazardousWasteStreamRow, 'id' | 'name' | 'generator_category' | 'long_haul' | 'waste_codes'> | null
}

const STATUS_LABEL: Record<HazardousWasteContainerStatus, string> = {
  open:        'Open',
  closed:      'Closed',
  in_shipment: 'In shipment',
  disposed:    'Disposed',
}

const AGE_TONE: Record<ContainerAgeStatus, string> = {
  ok:          'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  approaching: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  over_limit:  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  unknown:     'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

const AGE_LABEL: Record<ContainerAgeStatus, string> = {
  ok:          'OK',
  approaching: 'Approaching',
  over_limit:  'OVER LIMIT',
  unknown:     'No start date',
}

export default function HazardousWasteContainersPage() {
  const { tenant } = useTenant()
  const search = useSearchParams()
  const streamId = search?.get('stream_id') ?? ''

  const [rows, setRows]     = useState<ContainerWithStream[] | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | HazardousWasteContainerStatus>('all')
  const [now, setNow]       = useState<Date>(() => new Date())

  // Refresh "now" every minute so age status flips on day boundaries
  // without requiring a page reload.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const params = new URLSearchParams()
    if (filter !== 'all') params.set('status', filter)
    if (streamId) params.set('stream_id', streamId)

    const res = await fetch(`/api/hazardous-waste/containers?${params}`, { headers })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to load'); setRows([]); return }
    setRows(json.containers ?? [])
  }, [tenant?.id, filter, streamId])

  useEffect(() => { void load() }, [load])

  const enriched = useMemo(() => {
    if (!rows) return null
    return rows.map(c => {
      const ageStatus = c.stream
        ? ageStatusForContainer(c, c.stream, now)
        : { ageDays: null, limitDays: null, daysUntilLimit: null, status: 'unknown' as const }
      return { container: c, age: ageStatus }
    })
  }, [rows, now])

  const overLimitCount = enriched?.filter(e => e.age.status === 'over_limit').length ?? 0
  const approachingCount = enriched?.filter(e => e.age.status === 'approaching').length ?? 0

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Hazardous Waste
        </Link>
        {streamId && (
          <>
            <span aria-hidden="true">/</span>
            <Link href="/hazardous-waste/streams" className="hover:text-slate-700 dark:hover:text-slate-200">Streams</Link>
            <span aria-hidden="true">/</span>
            <span>Containers for stream</span>
          </>
        )}
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Containers</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Physical hazardous waste containers across accumulation areas. Age status is computed against
            the stream&apos;s generator category.
          </p>
        </div>
        <Link
          href={`/hazardous-waste/containers/new${streamId ? `?stream_id=${streamId}` : ''}`}
          className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" /> New container
        </Link>
      </header>

      {(overLimitCount > 0 || approachingCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {overLimitCount > 0 && (
            <span className={`px-3 py-1 rounded-md text-xs font-semibold ${AGE_TONE.over_limit}`}>
              {overLimitCount} over limit
            </span>
          )}
          {approachingCount > 0 && (
            <span className={`px-3 py-1 rounded-md text-xs font-semibold ${AGE_TONE.approaching}`}>
              {approachingCount} approaching
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {(['all', ...HAZARDOUS_WASTE_CONTAINER_STATUSES] as const).map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`px-3 py-1.5 rounded-md border ${
              filter === value
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {value === 'all' ? 'All' : STATUS_LABEL[value]}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {enriched === null && (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}

      {enriched && enriched.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No containers yet. <Link href="/hazardous-waste/containers/new" className="text-brand-navy underline">Add the first one</Link>.
        </div>
      )}

      {enriched && enriched.length > 0 && (
        <ul className="space-y-2">
          {enriched.map(({ container, age }) => (
            <li key={container.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{container.label}</h3>
                  {container.stream && (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Stream:{' '}
                      <Link href={`/hazardous-waste/streams/${container.stream.id}`} className="underline">
                        {container.stream.name}
                      </Link>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${AGE_TONE[age.status]}`}>
                    {AGE_LABEL[age.status]}
                    {age.ageDays != null ? ` · ${age.ageDays}d` : ''}
                    {age.limitDays != null && age.daysUntilLimit != null
                      ? age.daysUntilLimit >= 0
                        ? ` · ${age.daysUntilLimit}d left`
                        : ` · ${Math.abs(age.daysUntilLimit)}d over`
                      : ''}
                  </span>
                  <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    {STATUS_LABEL[container.status]}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                  {HAZARDOUS_WASTE_AREA_LABEL[container.area_type]}
                </span>
                {container.area_location && (
                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                    {container.area_location}
                  </span>
                )}
                {container.volume_quantity != null && container.volume_unit && (
                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                    {container.volume_quantity} {container.volume_unit}
                  </span>
                )}
                {container.accumulation_started_at && (
                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                    Started {new Date(container.accumulation_started_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
