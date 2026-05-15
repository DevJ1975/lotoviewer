'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  HAZARDOUS_WASTE_STREAM_STATUSES,
  type HazardousWasteStreamRow,
  type HazardousWasteStreamStatus,
} from '@soteria/core/hazardousWaste'

const STATUS_LABEL: Record<HazardousWasteStreamStatus, string> = {
  draft:    'Draft',
  active:   'Active',
  archived: 'Archived',
}

const CATEGORY_LABEL: Record<HazardousWasteStreamRow['generator_category'], string> = {
  lqg:  'LQG — 90-day accumulation',
  sqg:  'SQG — 180-day accumulation',
  vsqg: 'VSQG — no federal limit',
}

export default function HazardousWasteStreamDetailPage() {
  const params = useParams<{ id: string }>()
  const { tenant } = useTenant()
  const [stream, setStream] = useState<HazardousWasteStreamRow | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [busy, setBusy]     = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id || !params?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(`/api/hazardous-waste/streams/${params.id}`, { headers })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to load'); return }
    setStream(json.stream)
  }, [tenant?.id, params?.id])

  useEffect(() => { void load() }, [load])

  async function changeStatus(next: HazardousWasteStreamStatus) {
    if (!tenant?.id || !stream) return
    setBusy(true)
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'x-active-tenant': tenant.id,
      'content-type':    'application/json',
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(`/api/hazardous-waste/streams/${stream.id}`, {
      method:  'PATCH',
      headers,
      body:    JSON.stringify({ status: next }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setError(json.error ?? 'Failed to update'); return }
    setStream(json.stream)
  }

  if (error) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      </main>
    )
  }
  if (!stream) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </main>
    )
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste/streams" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Waste streams
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stream.name}</h1>
        {stream.generating_process && (
          <p className="text-sm text-slate-600 dark:text-slate-300">{stream.generating_process}</p>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5">{STATUS_LABEL[stream.status]}</span>
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5">{CATEGORY_LABEL[stream.generator_category]}</span>
          {stream.long_haul && <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5">Long-haul</span>}
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</h2>
        <div className="flex flex-wrap gap-2">
          {HAZARDOUS_WASTE_STREAM_STATUSES.map(s => (
            <button
              key={s}
              type="button"
              disabled={busy || s === stream.status}
              onClick={() => changeStatus(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${
                s === stream.status
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              } disabled:opacity-60`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </section>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {stream.description && <Detail label="Description" value={stream.description} wide />}
        {stream.physical_state && <Detail label="Physical state" value={stream.physical_state} />}
        {stream.hazards.length > 0 && <Detail label="Hazards" value={stream.hazards.join(', ')} />}
        {stream.waste_codes.length > 0 && <Detail label="Waste codes" value={stream.waste_codes.join(', ')} />}
        {stream.determination_basis && <Detail label="Determination basis" value={stream.determination_basis} wide />}
        {stream.review_due_date && <Detail label="Review due" value={stream.review_due_date} />}
        {stream.notes && <Detail label="Notes" value={stream.notes} wide />}
      </dl>

      <div className="pt-2">
        <Link
          href={`/hazardous-waste/containers?stream_id=${stream.id}`}
          className="text-sm text-brand-navy underline"
        >
          View containers on this stream →
        </Link>
      </div>
    </main>
  )
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{value}</dd>
    </div>
  )
}
