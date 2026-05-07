'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle, Plus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ACTIVE_INCIDENT_STATUSES,
  compareForTriage,
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  STATUS_LABEL,
  type IncidentRow,
  type IncidentSeverityActual,
} from '@soteria/core/incident'

// /incidents — Triage list. Default view shows active incidents
// (everything except 'closed'), severity desc → oldest-first via the
// shared compareForTriage helper.

const SEVERITY_PILL: Record<IncidentSeverityActual, string> = {
  catastrophic: 'bg-rose-700 text-white',
  fatality:     'bg-rose-600 text-white',
  lost_time:    'bg-orange-500 text-white',
  medical:      'bg-amber-400 text-slate-900',
  first_aid:    'bg-yellow-100 text-yellow-900',
  none:         'bg-slate-200 text-slate-700',
}

export default function IncidentListPage() {
  const { tenant } = useTenant()
  const [rows,    setRows]    = useState<IncidentRow[] | null>(null)
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
      if (!showAll) params.set('status', ACTIVE_INCIDENT_STATUSES.join(','))

      const res = await fetch(`/api/incidents?${params.toString()}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRows(((body.reports ?? []) as IncidentRow[]).slice().sort(compareForTriage))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant, showAll])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const c = { catastrophic: 0, fatality: 0, lost_time: 0, medical: 0, first_aid: 0, none: 0 }
    for (const r of rows ?? []) {
      if (r.status === 'closed') continue
      c[r.severity_actual]++
    }
    return c
  }, [rows])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Incidents</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Injuries, near-misses, property damage, and environmental events.
          </p>
        </div>
        <Link
          href="/incidents/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" />
          Report incident
        </Link>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <CountTile label="Catastrophic" count={counts.catastrophic} pill={SEVERITY_PILL.catastrophic} />
        <CountTile label="Fatality"     count={counts.fatality}     pill={SEVERITY_PILL.fatality} />
        <CountTile label="Lost-time"    count={counts.lost_time}    pill={SEVERITY_PILL.lost_time} />
        <CountTile label="Medical"      count={counts.medical}      pill={SEVERITY_PILL.medical} />
        <CountTile label="First-aid"    count={counts.first_aid}    pill={SEVERITY_PILL.first_aid} />
        <CountTile label="No injury"    count={counts.none}         pill={SEVERITY_PILL.none} />
      </section>

      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showAll}
            onChange={e => setShowAll(e.target.checked)}
            className="rounded"
          />
          Show closed
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
            No {showAll ? '' : 'open '}incidents.
          </p>
          <Link href="/incidents/new" className="mt-3 inline-block text-sm font-medium text-brand-navy hover:underline">
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
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Severity</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Reported</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                    <Link href={`/incidents/${r.id}`} className="hover:underline">
                      {r.report_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {INCIDENT_TYPE_LABEL[r.incident_type]}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_PILL[r.severity_actual]}`}>
                      {SEVERITY_ACTUAL_LABEL[r.severity_actual]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-md truncate">
                    {r.description}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    {new Date(r.reported_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 text-xs">
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
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill}`}>{count}</span>
      </div>
    </div>
  )
}
