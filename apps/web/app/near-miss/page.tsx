'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle, Plus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ACTIVE_NEAR_MISS_STATUSES,
  compareForTriage,
  ageInDays,
  type NearMissRow,
  type NearMissSeverity,
  type NearMissStatus,
} from '@soteria/core/nearMiss'

// /near-miss — Triage list. Default view shows active reports
// (new + triaged + investigating), severity desc → oldest first.
// Toggle "Show closed" surfaces resolved + escalated rows too.
//
// State lives in component state, not the URL — single-page
// triage view doesn't benefit from shareable URLs the way the
// risk register does (every report links to its own detail page).

const SEVERITY_PILL: Record<NearMissSeverity, string> = {
  extreme:  'bg-rose-600 text-white',
  high:     'bg-orange-500 text-white',
  moderate: 'bg-amber-400 text-slate-900',
  low:      'bg-emerald-500 text-white',
}

const STATUS_LABEL: Record<NearMissStatus, string> = {
  new:                 'New',
  triaged:             'Triaged',
  investigating:       'Investigating',
  closed:              'Closed',
  escalated_to_risk:   'Escalated',
}

export default function NearMissListPage() {
  const { tenant } = useTenant()
  const [rows,    setRows]    = useState<NearMissRow[] | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const params = new URLSearchParams()
      params.set('limit', '200')
      if (!showAll) params.set('status', ACTIVE_NEAR_MISS_STATUSES.join(','))

      const res = await fetch(`/api/near-miss?${params.toString()}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRows(((body.reports ?? []) as NearMissRow[]).slice().sort(compareForTriage))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id, showAll])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const c = { extreme: 0, high: 0, moderate: 0, low: 0 }
    for (const r of rows ?? []) {
      if (r.status === 'closed' || r.status === 'escalated_to_risk') continue
      c[r.severity_potential]++
    }
    return c
  }, [rows])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Near-Miss Reports</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Capture and track events that nearly caused harm.
          </p>
        </div>
        <Link
          href="/near-miss/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" />
          Report Near-Miss
        </Link>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CountTile label="Extreme"  count={counts.extreme}  pill="bg-rose-600 text-white" />
        <CountTile label="High"     count={counts.high}     pill="bg-orange-500 text-white" />
        <CountTile label="Moderate" count={counts.moderate} pill="bg-amber-400 text-slate-900" />
        <CountTile label="Low"      count={counts.low}      pill="bg-emerald-500 text-white" />
      </section>

      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showAll}
            onChange={e => setShowAll(e.target.checked)}
            className="rounded"
          />
          Show closed + escalated
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {rows === null && !error && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No {showAll ? '' : 'open '}near-miss reports.
          </p>
          <Link href="/near-miss/new" className="mt-3 inline-block text-sm font-medium text-brand-navy hover:underline">
            File the first one →
          </Link>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Report #</th>
                <th className="px-3 py-2 text-left">Severity</th>
                <th className="px-3 py-2 text-left">Hazard</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Reported</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                    <Link href={`/near-miss/${r.id}`} className="hover:underline">
                      {r.report_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${SEVERITY_PILL[r.severity_potential]}`}>
                      {r.severity_potential}
                    </span>
                  </td>
                  <td className="px-3 py-2 capitalize text-slate-700 dark:text-slate-300">
                    {r.hazard_category}
                  </td>
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200 max-w-md truncate">
                    {r.description}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {ageInDays(r)} d ago
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {STATUS_LABEL[r.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CountTile({ label, count, pill }: { label: string; count: number; pill: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${pill}`}>{label[0]}</span>
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{count}</p>
    </div>
  )
}
