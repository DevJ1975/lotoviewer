'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { HotWorkPermit } from '@soteria/core/types'
import { hotWorkState, hotWorkCountdown, type HotWorkState } from '@soteria/core/hotWorkPermitStatus'

// Big-monitor status board for hot-work permits. Mirrors the CS status
// board's structure (dark, large fonts, auto-refresh, stale-data banner,
// visibility-API resume) so a control room can swap between the two on
// the same TV. Hot-work-specific tiles surface the regulator-mandated
// concerns: fire watch active, expiry, post-watch elapsed.

const REFRESH_MS    = 30_000
const TICK_MS       = 1000
const STALE_MS      = 60_000
// Permits stay on the board while signed and not closed. Once closed
// they drop off — the audit trail still has them.

interface BoardPermit extends HotWorkPermit {
  state:                      HotWorkState
  activeMinutesRemaining:     number | null
  postWatchMinutesRemaining:  number | null
}

export default function HotWorkStatusBoard() {
  const [permits, setPermits] = useState<BoardPermit[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow]         = useState<number>(() => Date.now())
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now())

  const load = useCallback(async () => {
    // Pull every signed, not-canceled hot-work permit. The pure helpers
    // partition into active / post-watch / expired buckets.
    const { data } = await supabase
      .from('loto_hot_work_permits')
      .select('*')
      .is('canceled_at', null)
      .not('pai_signature_at', 'is', null)
      .order('expires_at', { ascending: true })

    const rows = (data ?? []) as HotWorkPermit[]
    const t = Date.now()
    setPermits(rows.map(p => {
      const c = hotWorkCountdown(p, t)
      return {
        ...p,
        state:                     hotWorkState(p, t),
        activeMinutesRemaining:    c.activeMinutesRemaining,
        postWatchMinutesRemaining: c.postWatchMinutesRemaining,
      }
    }))
    setLoading(false)
    setLastRefresh(Date.now())
  }, [])

  // Visibility-aware polling — same pattern as the CS board so iOS PWAs
  // throttling background timers don't leave stale data on screen when
  // the operator returns to the tab.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null
    function start()   { if (!id) id = setInterval(load, REFRESH_MS) }
    function stop()    { if (id) { clearInterval(id); id = null } }
    function onVisibility() {
      if (document.hidden) { stop() } else { load(); start() }
    }
    load()
    if (typeof document === 'undefined' || !document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Re-derive the per-permit state every tick so countdowns and bucket
  // transitions stay live without a server round-trip. Cheap — pure
  // helpers over an in-memory array.
  const live = useMemo(() => permits.map(p => {
    const c = hotWorkCountdown(p, now)
    return {
      ...p,
      state:                     hotWorkState(p, now),
      activeMinutesRemaining:    c.activeMinutesRemaining,
      postWatchMinutesRemaining: c.postWatchMinutesRemaining,
    }
  }), [permits, now])

  const active   = useMemo(() => live.filter(p => p.state === 'active'),
                           [live])
  const postWatch = useMemo(() => live.filter(p => p.state === 'post_work_watch'),
                            [live])
  const watchDone = useMemo(() => live.filter(p => p.state === 'post_watch_complete'),
                            [live])
  const expired  = useMemo(() => live.filter(p => p.state === 'expired'),
                           [live])

  const closeToExpiry = useMemo(
    () => active.filter(p => (p.activeMinutesRemaining ?? Infinity) <= 30).length,
    [active],
  )

  const refreshAgeMs = Math.max(0, now - lastRefresh)
  const isStale      = refreshAgeMs > STALE_MS

  // "Needs attention" — expired (forced-late close-out) and watch-complete
  // (ready to release the watcher). Both are operator-action items.
  const needsAction = [...expired, ...watchDone]

  return (
    <div className="min-h-[calc(100vh-6rem)] bg-slate-950 text-white px-4 sm:px-8 py-6 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
            Hot Work Status Board
          </h1>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
            Live status of hot-work permits · OSHA 29 CFR 1910.252 · NFPA 51B · Cal/OSHA Title 8 §6777
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl sm:text-4xl font-mono font-bold">
            {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className={`text-[11px] ${isStale ? 'text-rose-400 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
            {isStale && '⚠ STALE · '}
            Refreshed {Math.floor(refreshAgeMs / 1000)}s ago · auto every 30s
          </p>
        </div>
      </header>

      {isStale && !loading && (
        <section className="rounded-xl border-2 border-rose-500 bg-rose-950/60 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-base font-bold text-rose-200">
              Data is stale — last refresh {Math.floor(refreshAgeMs / 1000)}s ago.
            </p>
            <p className="text-xs text-rose-200/80">
              Check your network connection. The board normally refreshes every 30 seconds.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors"
          >
            Retry now →
          </button>
        </section>
      )}

      {/* Headline tiles */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Headline label="Permits Active"        value={active.length}    tone="info" />
        <Headline label="Expiring (≤30 min)"    value={closeToExpiry}    tone={closeToExpiry > 0 ? 'warning' : 'info'} />
        <Headline label="In Post-Work Watch"    value={postWatch.length} tone={postWatch.length > 0 ? 'warning' : 'info'} />
        <Headline label="Needs Action"          value={needsAction.length} tone={needsAction.length > 0 ? 'critical' : 'info'} />
      </section>

      {/* Needs-action panel — surface FIRST so an operator at a glance
          sees what's stuck. Combines expired (forced-late close-out)
          and watch-complete (ready to release the watcher). */}
      {needsAction.length > 0 && (
        <section className="rounded-xl border-4 border-rose-500 bg-rose-950/40 p-4 sm:p-6 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-black text-rose-300 flex items-center gap-3">
            <span className="inline-block w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
            Needs action — close-out or release watcher
          </h2>
          <ul className="space-y-2">
            {needsAction.map(p => (
              <li key={p.id} className="bg-slate-900/70 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-lg font-mono font-bold text-rose-200 tracking-wider">{p.serial}</p>
                  <p className="text-sm text-slate-300 truncate">{p.work_location}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-rose-300 uppercase tracking-widest font-bold">
                    {p.state === 'expired' ? 'Expired' : 'Watch complete'}
                  </p>
                  <p className="text-sm text-slate-400 dark:text-slate-500">
                    {p.state === 'expired'
                      ? new Date(p.expires_at).toLocaleString()
                      : 'Ready to close'}
                  </p>
                </div>
                <Link
                  href={`/hot-work/${p.id}`}
                  className="shrink-0 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors"
                >
                  Open permit →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Active + post-watch grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400 dark:text-slate-500">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-white rounded-full animate-spin" />
        </div>
      ) : active.length === 0 && postWatch.length === 0 ? (
        <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-12 text-center">
          <p className="text-2xl text-slate-300 font-bold">No hot work in progress</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            When a hot-work permit is signed and active, it appears here with a live countdown.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {active.map(p     => <PermitCard key={p.id} permit={p} />)}
          {postWatch.map(p  => <PermitCard key={p.id} permit={p} />)}
        </section>
      )}

      <footer className="text-[11px] text-slate-600 dark:text-slate-300 text-center pt-4">
        Soteria Field · {active.length + postWatch.length + needsAction.length} hot-work permit
        {active.length + postWatch.length + needsAction.length === 1 ? '' : 's'} on display
      </footer>
    </div>
  )
}

// ── Headline counter tile ─────────────────────────────────────────────────

function Headline({ label, value, tone }: { label: string; value: number; tone: 'info' | 'warning' | 'critical' }) {
  const cls =
    tone === 'critical' ? 'bg-rose-950/60 border-rose-500/60'
  : tone === 'warning'  ? 'bg-amber-950/60 border-amber-500/60'
  :                       'bg-slate-900/60 border-slate-700'
  const numCls =
    tone === 'critical' ? 'text-rose-200'
  : tone === 'warning'  ? 'text-amber-200'
  :                       'text-white'
  return (
    <div className={`rounded-xl border-2 ${cls} px-5 py-4`}>
      <p className="text-[11px] sm:text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold">{label}</p>
      <p className={`text-5xl sm:text-6xl font-black tabular-nums mt-1 ${numCls}`}>{value}</p>
    </div>
  )
}

// ── Per-permit card ───────────────────────────────────────────────────────

function PermitCard({ permit }: { permit: BoardPermit }) {
  const inWatch = permit.state === 'post_work_watch'
  const minutes = inWatch ? permit.postWatchMinutesRemaining : permit.activeMinutesRemaining
  const tone =
      inWatch                              ? 'watch'
    : (minutes ?? Infinity) <= 30          ? 'critical'
    : (minutes ?? Infinity) <= 120         ? 'warning'
    :                                        'safe'

  const cardCls =
      tone === 'critical' ? 'border-rose-500 bg-rose-950/30 ring-2 ring-rose-500/40'
    : tone === 'warning'  ? 'border-amber-500 bg-amber-950/30'
    : tone === 'watch'    ? 'border-blue-500 bg-blue-950/30'
    :                       'border-emerald-700 bg-emerald-950/20'

  const timerCls =
      tone === 'critical' ? 'text-rose-300'
    : tone === 'warning'  ? 'text-amber-300'
    : tone === 'watch'    ? 'text-blue-300'
    :                       'text-emerald-300'

  const timerLabel = inWatch ? 'Fire watch ends in' : 'Time remaining'

  return (
    <Link
      href={`/hot-work/${permit.id}`}
      className={`rounded-xl border-2 ${cardCls} p-4 sm:p-5 space-y-3 hover:bg-white/5 dark:hover:bg-slate-900/5 transition-colors block`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-bold tracking-wider text-slate-300 text-sm">{permit.serial}</p>
          <p className="text-lg sm:text-xl font-bold text-white mt-0.5 truncate" title={permit.work_location}>
            {permit.work_location}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate" title={permit.work_description}>
            {permit.work_description}
          </p>
        </div>
        {inWatch && (
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-blue-500/20 text-blue-200 border-blue-600">
            Fire watch
          </span>
        )}
      </header>

      <div className={`text-5xl sm:text-6xl font-black tabular-nums font-mono ${timerCls} text-center py-2`}>
        {minutes != null ? formatMinutes(minutes) : '—'}
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center uppercase tracking-widest -mt-2">
        {timerLabel}
      </p>

      <RosterRow label={`Operators (${permit.hot_work_operators.length})`} names={permit.hot_work_operators} tone="operator" />
      <RosterRow label={`Fire watch (${permit.fire_watch_personnel.length})`} names={permit.fire_watch_personnel} tone="watcher" />
    </Link>
  )
}

function RosterRow({ label, names, tone }: { label: string; names: string[]; tone: 'operator' | 'watcher' }) {
  const dotCls = tone === 'operator' ? 'bg-amber-400' : 'bg-blue-400'
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold mb-1">{label}</p>
      {names.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">— none recorded —</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((n, i) => (
            <li key={`${n}-${i}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800/80 text-sm text-slate-100">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotCls}`} />
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Mirror the format from lib/permitStatus.ts label so the two boards
// read the same. Always returns "MM:00" — minute granularity is what
// the user needs at a glance on a control-room TV.
function formatMinutes(min: number): string {
  if (min <= 0) return '0:00'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `0:${String(m).padStart(2, '0')}`
}
