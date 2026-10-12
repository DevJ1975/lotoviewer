'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { MANIFEST_STATUSES, type ManifestStatus } from '@soteria/core/hazardousWasteManifest'
import {
  MANIFEST_STAGE_TONE, MANIFEST_STATUS_LABEL, formatDay, type ManifestListItem,
} from '@/lib/hazardousWasteManifestView'
import { ManifestClockChip } from './_components/ManifestClockChip'
import { listManifests } from './_lib/manifestClient'

// Manifests: one row per shipment, newest first, with the stage of the return clock beside each so
// the one waiting on a signed copy is the one you see. Cancelled manifests are filed under their
// own filter rather than cluttering the list.

type Filter = 'active' | ManifestStatus

const FILTERS: readonly Filter[] = ['active', ...MANIFEST_STATUSES]

export default function HazardousWasteManifestsPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id

  const [filter, setFilter]         = useState<Filter>('active')
  const [items, setItems]           = useState<ManifestListItem[] | null>(null)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [total, setTotal]           = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async (offset: number) => {
    if (!tenantId) return
    setError(null)
    try {
      const page = await listManifests(tenantId, { status: filter === 'active' ? undefined : filter, offset })
      setItems(previous => (offset === 0 || previous === null ? page.manifests : [...previous, ...page.manifests]))
      setNextOffset(page.nextOffset)
      setTotal(page.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setItems(previous => previous ?? [])
    }
  }, [tenantId, filter])

  useEffect(() => {
    setItems(null)
    void load(0)
  }, [load])

  const needsAction = useMemo(() => {
    const open = items ?? []
    return {
      exceptionDue: open.filter(i => i.clock.stage === 'exception_report_due').length,
      followUpDue:  open.filter(i => i.clock.stage === 'follow_up_due').length,
    }
  }, [items])

  async function loadMore() {
    if (nextOffset === null) return
    setLoadingMore(true)
    await load(nextOffset)
    setLoadingMore(false)
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Hazardous Waste
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Manifests</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Each shipment of closed containers, and the clock for getting the signed copy back from the receiving
            facility. The day the transporter accepts the waste is day 0.
          </p>
        </div>
        <Link
          href="/hazardous-waste/manifests/new"
          className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> New manifest
        </Link>
      </header>

      {(needsAction.exceptionDue > 0 || needsAction.followUpDue > 0) && (
        <div className="flex flex-wrap gap-2" role="status">
          {needsAction.exceptionDue > 0 && (
            <span className={`rounded-md px-3 py-1 text-xs font-semibold ${MANIFEST_STAGE_TONE.exception_report_due}`}>
              {needsAction.exceptionDue} exception report{needsAction.exceptionDue === 1 ? '' : 's'} due
            </span>
          )}
          {needsAction.followUpDue > 0 && (
            <span className={`rounded-md px-3 py-1 text-xs font-semibold ${MANIFEST_STAGE_TONE.follow_up_due}`}>
              {needsAction.followUpDue} to follow up
            </span>
          )}
        </div>
      )}

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2 text-xs">
        {FILTERS.map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`px-3 py-1.5 rounded-md border ${
              filter === value
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {value === 'active' ? 'All but cancelled' : MANIFEST_STATUS_LABEL[value]}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {items === null && (
        <div role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}

      {items && items.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {filter === 'active'
            ? <>No manifests yet. Close a container, then <Link href="/hazardous-waste/manifests/new" className="text-brand-navy underline">start the first manifest</Link>.</>
            : <>No {MANIFEST_STATUS_LABEL[filter].toLowerCase()} manifests.</>}
        </div>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="space-y-2" aria-label="Manifests">
            {items.map(item => <ManifestRow key={item.id} item={item} />)}
          </ul>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Showing {items.length} of {total}</span>
            {nextOffset !== null && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </>
      )}
    </main>
  )
}

function ManifestRow({ item }: { item: ManifestListItem }) {
  const labels = item.containers.map(c => c.label)
  const shown = labels.slice(0, 3).join(', ')
  const more = labels.length > 3 ? ` and ${labels.length - 3} more` : ''
  return (
    <li className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">
            <Link href={`/hazardous-waste/manifests/${item.id}`} className="underline-offset-2 hover:underline">
              {item.manifest_tracking_number ?? 'Draft, no tracking number yet'}
            </Link>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {item.containers.length} container{item.containers.length === 1 ? '' : 's'}
            {labels.length > 0 && <>: {shown}{more}</>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ManifestClockChip item={item} />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {MANIFEST_STATUS_LABEL[item.status]}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-400">
        {item.shipped_on && <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">Shipped {formatDay(item.shipped_on)}</span>}
        {item.transporter_name && <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">Transporter: {item.transporter_name}</span>}
        {item.tsdf_name && <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">To: {item.tsdf_name}</span>}
        {item.clock.exceptionReportDueOn && item.status === 'shipped' && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">Exception report by {formatDay(item.clock.exceptionReportDueOn)}</span>
        )}
      </div>
    </li>
  )
}
