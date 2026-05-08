'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Loader2, Filter } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  BBS_KIND_LABEL,
  BBS_STATUS_LABEL,
  ACTIVE_BBS_STATUSES,
  type BBSKind,
  type BBSStatus,
} from '@soteria/core/bbs'
import { KindBadge, RiskScoreBadge } from './_components/KindBadge'
import { Leaderboard } from './_components/Leaderboard'
import type { BBSLeaderboardRow } from '@soteria/core/bbsMetrics'

interface ObservationRow {
  id:               string
  report_number:    string
  kind:             BBSKind
  status:           BBSStatus
  description:      string
  risk_score:       number | null
  location_text:    string | null
  department:       string | null
  observed_at:      string
  created_at:       string
  submitted_name:   string | null
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return `${d}d ago`
}

export default function BBSListPage() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<ObservationRow[] | null>(null)
  const [leaderboard, setLeaderboard] = useState<BBSLeaderboardRow[]>([])
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    const params = new URLSearchParams()
    params.set('limit', '100')
    if (!showAll) params.set('status', ACTIVE_BBS_STATUSES.join(','))

    const [obsRes, lbRes] = await Promise.all([
      fetch(`/api/bbs/observations?${params.toString()}`, { headers }),
      fetch(`/api/bbs/leaderboard?limit=5`, { headers }),
    ])
    const obsBody = await obsRes.json()
    if (!obsRes.ok) {
      setError(obsBody.error ?? `HTTP ${obsRes.status}`)
      return
    }
    setRows(obsBody.observations ?? [])
    if (lbRes.ok) {
      const lbBody = await lbRes.json()
      setLeaderboard(lbBody.leaderboard ?? [])
    }
  }, [tenant?.id, showAll])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const c = { unsafe_act: 0, unsafe_condition: 0, safe_behavior: 0 }
    for (const r of rows ?? []) {
      if (r.status === 'closed' || r.status === 'invalid') continue
      c[r.kind]++
    }
    return c
  }, [rows])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Behavior-Based Safety
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Capture unsafe acts, unsafe conditions, and safe behaviors observed in the field.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/bbs/leaderboard"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Leaderboard
          </Link>
          <Link
            href="/bbs/new"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-teal-600 hover:bg-teal-700 text-white font-medium"
          >
            <Plus className="w-4 h-4" />
            New observation
          </Link>
        </div>
      </header>

      {/* Top counts + leaderboard preview */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4">
            <div className="text-xs text-amber-700 dark:text-amber-300 uppercase font-medium">Unsafe acts</div>
            <div className="text-3xl font-bold text-amber-900 dark:text-amber-100 mt-1">{counts.unsafe_act}</div>
            <div className="text-xs text-slate-500">active</div>
          </div>
          <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 p-4">
            <div className="text-xs text-rose-700 dark:text-rose-300 uppercase font-medium">Unsafe conditions</div>
            <div className="text-3xl font-bold text-rose-900 dark:text-rose-100 mt-1">{counts.unsafe_condition}</div>
            <div className="text-xs text-slate-500">active</div>
          </div>
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
            <div className="text-xs text-emerald-700 dark:text-emerald-300 uppercase font-medium">Safe behaviors</div>
            <div className="text-3xl font-bold text-emerald-900 dark:text-emerald-100 mt-1">{counts.safe_behavior}</div>
            <div className="text-xs text-slate-500">recognized</div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Top contributors</h2>
            <Link href="/bbs/leaderboard" className="text-xs text-teal-600 hover:underline">View all</Link>
          </div>
          <Leaderboard rows={leaderboard} />
        </div>
      </section>

      {/* Filters */}
      <div className="flex items-center gap-3 text-sm">
        <Filter className="w-4 h-4 text-slate-400" />
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="rounded" />
          Show closed / invalid
        </label>
      </div>

      {/* List */}
      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}
      {rows === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No observations yet. <Link href="/bbs/new" className="text-teal-600 hover:underline">File the first one</Link>.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {rows.map(row => (
            <li key={row.id}>
              <Link
                href={`/bbs/${row.id}`}
                className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs text-slate-500">{row.report_number}</span>
                  <KindBadge kind={row.kind} />
                  <RiskScoreBadge score={row.risk_score} />
                  <span className="text-xs text-slate-500 ml-auto">{timeAgo(row.created_at)}</span>
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2">{row.description}</p>
                <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
                  {row.location_text && <span>📍 {row.location_text}</span>}
                  {row.department && <span>🏷 {row.department}</span>}
                  <span>Status: {BBS_STATUS_LABEL[row.status]}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
