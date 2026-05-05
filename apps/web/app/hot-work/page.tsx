'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Flame, Monitor, Plus, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { HotWorkPermit } from '@soteria/core/types'
import { HOT_WORK_TYPE_LABELS } from '@soteria/core/types'
import {
  hotWorkState,
  hotWorkCountdown,
  type HotWorkState,
} from '@soteria/core/hotWorkPermitStatus'

// Hot Work permit list. Mirrors the layout of /confined-spaces but
// operates on permits directly (there's no inventory parent for hot
// work — the location is free text on each permit). Default scope is
// "anything still requiring attention" — pending, active, post-watch,
// or expired-uncancelled. Closed permits drop off the default view but
// surface via the state filter for audit lookups.

const STATE_FILTERS: Array<{ value: HotWorkState | 'all' | 'open'; label: string }> = [
  { value: 'open',                label: 'Open' },          // pending + active + post_work_watch + post_watch_complete
  { value: 'pending_signature',   label: 'Pending sig' },
  { value: 'active',              label: 'Active' },
  { value: 'post_work_watch',     label: 'Post-watch' },
  { value: 'expired',             label: 'Expired' },
  { value: 'canceled',            label: 'Closed' },
  { value: 'all',                 label: 'All' },
]

const STATE_BADGE: Record<HotWorkState, string> = {
  pending_signature:   'bg-amber-100 dark:bg-amber-900/40   text-amber-800 dark:text-amber-200   ring-amber-200',
  active:              'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 ring-emerald-200',
  post_work_watch:     'bg-blue-100 dark:bg-blue-900/40    text-blue-800 dark:text-blue-200    ring-blue-200',
  post_watch_complete: 'bg-emerald-50 dark:bg-emerald-950/40  text-emerald-700 dark:text-emerald-300 ring-emerald-200',
  expired:             'bg-rose-100 dark:bg-rose-900/40    text-rose-800 dark:text-rose-200    ring-rose-200',
  canceled:            'bg-slate-100 dark:bg-slate-800   text-slate-700 dark:text-slate-300   ring-slate-200 dark:ring-slate-700',
}

const STATE_LABEL: Record<HotWorkState, string> = {
  pending_signature:   'Pending signature',
  active:              'Active',
  post_work_watch:     'Post-work watch',
  post_watch_complete: 'Ready to close',
  expired:             'Expired',
  canceled:            'Closed',
}

export default function HotWorkListPage() {
  const [permits, setPermits]     = useState<HotWorkPermit[]>([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery]         = useState('')
  const [stateFilter, setStateFilter] = useState<HotWorkState | 'all' | 'open'>('open')
  // Tick once per second so the countdown columns stay live without a
  // full re-fetch. We re-render via setNow; permit data stays stable.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('loto_hot_work_permits')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(200)
    if (error) {
      console.error('[hot-work] load failed', error)
      setLoadError(true)
      setPermits([])
    } else {
      setLoadError(false)
      setPermits((data ?? []) as HotWorkPermit[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Headline tile counts. Computed off `now` so they tick if a permit
  // crosses an expiry boundary while the user is staring at the list.
  const counts = useMemo(() => {
    const c: Record<HotWorkState, number> = {
      pending_signature: 0, active: 0, post_work_watch: 0,
      post_watch_complete: 0, expired: 0, canceled: 0,
    }
    for (const p of permits) c[hotWorkState(p, now)] += 1
    return c
  }, [permits, now])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return permits.filter(p => {
      const s = hotWorkState(p, now)
      // State filter
      if (stateFilter === 'open') {
        if (s === 'expired' || s === 'canceled') return false
      } else if (stateFilter !== 'all' && s !== stateFilter) {
        return false
      }
      // Free-text search
      if (q) {
        const haystack = [
          p.serial, p.work_location, p.work_description,
          ...(p.hot_work_operators ?? []),
          ...(p.fire_watch_personnel ?? []),
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [permits, now, stateFilter, query])

  if (loadError) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 text-center">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Could not load hot work permits.</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Migration 019 may not be applied yet — check the Supabase SQL Editor.
        </p>
        <button
          type="button"
          onClick={() => { setLoading(true); setLoadError(false); load() }}
          className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Flame className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            Hot Work Permits
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Welding · cutting · grinding · brazing · soldering · torch-applied work · OSHA 29 CFR 1910.252 + NFPA 51B
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <Link
            href="/hot-work/status"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
          >
            <Monitor className="h-4 w-4" />
            Status board
          </Link>
          <Link
            href="/hot-work/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New permit
          </Link>
        </div>
      </header>

      {/* Headline tiles */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Pending signature" value={counts.pending_signature} tone={counts.pending_signature > 0 ? 'amber' : 'slate'} />
        <Tile label="Active"            value={counts.active}            tone={counts.active > 0           ? 'emerald' : 'slate'} />
        <Tile label="Post-work watch"   value={counts.post_work_watch}   tone={counts.post_work_watch > 0  ? 'blue' : 'slate'} />
        <Tile label="Expired"           value={counts.expired}           tone={counts.expired > 0          ? 'rose' : 'slate'} />
      </section>

      {/* Filters */}
      {permits.length > 0 && (
        <>
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by serial, location, description, or person…"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-sm px-1"
              >×</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATE_FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStateFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  stateFilter === f.value
                    ? 'bg-brand-navy text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >{f.label}</button>
            ))}
          </div>
        </>
      )}

      {/* Permit list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          {permits.length === 0 ? (
            <>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No hot work permits yet.</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Issue your first permit to start the audit trail.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No permits match your filter.</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Try a different search term or state filter.</p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
          {visible.map(p => {
            const s = hotWorkState(p, now)
            const c = hotWorkCountdown(p, now)
            return (
              <li key={p.id}>
                <Link
                  href={`/hot-work/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{p.serial}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ring-1 tracking-wider ${STATE_BADGE[s]}`}>
                        {STATE_LABEL[s]}
                      </span>
                      {p.work_types.slice(0, 3).map(t => (
                        <span key={t} className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {HOT_WORK_TYPE_LABELS[t]}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 truncate mt-0.5">{p.work_location}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{p.work_description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {s === 'active' && c.activeMinutesRemaining != null && (
                      <p className="text-xs font-mono text-slate-700 dark:text-slate-300">{formatMinutes(c.activeMinutesRemaining)} left</p>
                    )}
                    {s === 'post_work_watch' && c.postWatchMinutesRemaining != null && (
                      <p className="text-xs font-mono text-blue-700 dark:text-blue-300">watch {formatMinutes(c.postWatchMinutesRemaining)}</p>
                    )}
                    {s === 'post_watch_complete' && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Ready to close</p>
                    )}
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{new Date(p.started_at).toLocaleString()}</p>
                  </div>
                  <span className="text-slate-300 text-lg shrink-0">›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function Tile({ label, value, tone }: {
  label: string
  value: number
  tone:  'slate' | 'amber' | 'emerald' | 'blue' | 'rose'
}) {
  const toneCls =
    tone === 'amber'   ? 'border-amber-200   bg-amber-50 dark:bg-amber-950/40   text-amber-900 dark:text-amber-100'
  : tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100'
  : tone === 'blue'    ? 'border-blue-200    bg-blue-50 dark:bg-blue-950/40    text-blue-900 dark:text-blue-100'
  : tone === 'rose'    ? 'border-rose-200    bg-rose-50 dark:bg-rose-950/40    text-rose-900 dark:text-rose-100'
  :                      'border-slate-200 dark:border-slate-700   bg-white dark:bg-slate-900      text-slate-700 dark:text-slate-300'
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-black tabular-nums">{value}</p>
    </div>
  )
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}
