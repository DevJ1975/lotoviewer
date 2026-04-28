'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { ConfinedSpace, ConfinedSpacePermit, AtmosphericTest } from '@/lib/types'
import {
  permitCountdown,
  summarize,
} from '@/lib/permitStatus'
import {
  effectiveThresholds,
  evaluateTest,
  type ReadingStatus,
} from '@/lib/confinedSpaceThresholds'

// Big-monitor status board for active permits. Designed for a 55"+ TV
// hung in a control room — dark background, large fonts, high-contrast
// counters. Auto-refreshes data every 30 seconds and ticks the per-permit
// countdown every second so the timer is always live.
//
// Pertinent at-a-glance info (top headline tiles):
//   • PERMITS ACTIVE — total signed, not expired, not canceled
//   • CLOSE TO EXPIRY — ≤ 2 hours remaining
//   • PEOPLE IN SPACES — sum of entrants across active permits
//
// Per-permit card:
//   • Serial (huge mono)
//   • Space ID + description
//   • Live countdown (huge, color-coded by remaining time)
//   • Entrants list with count
//   • Attendant(s)
//   • Latest atmospheric reading status
//
// A separate "EXPIRED — NEEDS CANCELLATION" panel surfaces signed permits
// past expires_at but not yet canceled. Per OSHA §1910.146(e)(5),
// expiration alone isn't a cancellation — the supervisor must verify
// evacuation and formally cancel. Putting these on the board makes that
// task visible.

const REFRESH_MS = 30_000   // data refetch
const TICK_MS    = 1000     // countdown tick
// "Stale" threshold: if the last successful refresh is older than this,
// the timestamp banner turns rose and labels itself STALE. iOS PWAs
// aggressively throttle background timers, so a 60s gap on a live board
// usually means we missed at least one tick — not a number to ignore.
const STALE_MS   = 60_000
// Bound on how far back atmospheric-test rows are pulled. The 8-hour
// permit cap means every test on an active permit is within 8h, but
// we leave 24h of headroom for shift handoffs and post-cancel review.
const TEST_WINDOW_MS = 24 * 60 * 60 * 1000

interface PermitWithSpace extends ConfinedSpacePermit {
  space?: ConfinedSpace
  latestTest?: AtmosphericTest | null
}

export default function PermitStatusBoard() {
  const [permits, setPermits] = useState<PermitWithSpace[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow]         = useState<number>(() => Date.now())
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now())

  const load = useCallback(async () => {
    // Pull every signed, not-canceled permit. We filter expired ones
    // client-side so we can still surface them on the "needs cancellation"
    // panel below. canceled rows are dropped at the DB layer.
    const { data: permitRows } = await supabase
      .from('loto_confined_space_permits')
      .select('*')
      .is('canceled_at', null)
      .not('entry_supervisor_signature_at', 'is', null)
      .order('expires_at', { ascending: true })

    const ps = (permitRows ?? []) as ConfinedSpacePermit[]

    if (ps.length === 0) {
      setPermits([])
      setLoading(false)
      setLastRefresh(Date.now())
      return
    }

    const spaceIds = [...new Set(ps.map(p => p.space_id))]
    const permitIds = ps.map(p => p.id)

    // Cutoff bounds the test pull at TEST_WINDOW_MS. Without this,
    // a long-running site accumulates atmospheric_tests rows linearly
    // and the per-refresh payload grows unbounded. 24h is comfortably
    // larger than the permit duration cap (8h) so we never miss a
    // relevant test for an active permit.
    const testCutoffIso = new Date(Date.now() - TEST_WINDOW_MS).toISOString()
    const [spacesRes, testsRes] = await Promise.all([
      supabase.from('loto_confined_spaces').select('*').in('space_id', spaceIds),
      supabase
        .from('loto_atmospheric_tests')
        .select('*')
        .in('permit_id', permitIds)
        .gte('tested_at', testCutoffIso)
        .order('tested_at', { ascending: false }),
    ])

    const spaces = (spacesRes.data ?? []) as ConfinedSpace[]
    const tests  = (testsRes.data  ?? []) as AtmosphericTest[]

    const spaceById = new Map(spaces.map(s => [s.space_id, s]))
    const latestTestByPermit = new Map<string, AtmosphericTest>()
    for (const t of tests) {
      // tests are sorted desc — first hit per permit_id wins
      if (!latestTestByPermit.has(t.permit_id)) latestTestByPermit.set(t.permit_id, t)
    }

    setPermits(ps.map(p => ({
      ...p,
      space:      spaceById.get(p.space_id),
      latestTest: latestTestByPermit.get(p.id) ?? null,
    })))
    setLoading(false)
    setLastRefresh(Date.now())
  }, [])

  // Initial load + 30s refetch with visibility-API pause/resume.
  //
  // iOS PWAs (and most desktop browsers) throttle background timers —
  // a setInterval running while the tab is hidden may fire at 1/min
  // or not at all. Pausing on `document.hidden` and forcing an
  // immediate fetch on resume means the operator sees fresh data
  // the moment they return, not up to 30s later. The active-board
  // mode (visible) keeps its 30s cadence.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null
    function start() {
      if (id) return
      id = setInterval(load, REFRESH_MS)
    }
    function stop() {
      if (id) { clearInterval(id); id = null }
    }
    function onVisibility() {
      if (document.hidden) {
        stop()
      } else {
        load()        // immediate refresh on resume
        start()
      }
    }
    load()
    if (typeof document === 'undefined' || !document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  // 1s tick for the live countdowns. Cheap — just bumps `now` so the
  // memoized derived state recomputes.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const summary = useMemo(() => summarize(permits, now), [permits, now])

  const active = useMemo(
    () => permits
      .filter(p => !permitCountdown(p, now).expired)
      .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()),
    [permits, now],
  )
  const expired = useMemo(
    () => permits.filter(p => permitCountdown(p, now).expired),
    [permits, now],
  )

  // "How stale is the displayed data?" Drives both the discreet
  // header readout and the prominent banner that appears when the
  // last successful refresh is far enough behind to suggest a missed
  // tick or network hiccup.
  const refreshAgeMs = Math.max(0, now - lastRefresh)
  const isStale      = refreshAgeMs > STALE_MS

  return (
    <div className="min-h-[calc(100vh-6rem)] bg-slate-950 text-white px-4 sm:px-8 py-6 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
            Permit Status Board
          </h1>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
            Live status of permit-required confined-space entries · OSHA 29 CFR 1910.146
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

      {/* Loud banner when the data is very stale — the discreet header
          readout is easy to miss across a control room, and an
          operator counting on this board needs to know when the
          numbers are NOT live. */}
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
        <Headline label="Permits Active"        value={summary.active}        tone="info" />
        <Headline label="Close to Expiry (≤2h)" value={summary.closeToExpiry} tone={summary.closeToExpiry > 0 ? 'warning' : 'info'} />
        <Headline label="People in Spaces"      value={summary.totalEntrants} tone="info" />
        <Headline label="Expired — Verify Evac" value={summary.expired}       tone={summary.expired > 0 ? 'critical' : 'info'} />
      </section>

      {/* Expired-not-canceled — surface FIRST so it grabs attention */}
      {expired.length > 0 && (
        <section className="rounded-xl border-4 border-rose-500 bg-rose-950/40 p-4 sm:p-6 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-black text-rose-300 flex items-center gap-3">
            <span className="inline-block w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
            Expired permits — verify evacuation and cancel
          </h2>
          <ul className="space-y-2">
            {expired.map(p => (
              <li key={p.id} className="bg-slate-900/70 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-lg font-mono font-bold text-rose-200 tracking-wider">{p.serial}</p>
                  <p className="text-sm text-slate-300 truncate">
                    <span className="font-semibold">{p.space_id}</span>
                    {p.space?.description && <> · {p.space.description}</>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-rose-300 uppercase tracking-widest font-bold">Expired</p>
                  <p className="text-sm text-slate-400 dark:text-slate-500">{new Date(p.expires_at).toLocaleString()}</p>
                </div>
                <Link
                  href={`/confined-spaces/${encodeURIComponent(p.space_id)}/permits/${p.id}`}
                  className="shrink-0 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors"
                >
                  Open permit →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Active permit grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400 dark:text-slate-500">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-white rounded-full animate-spin" />
        </div>
      ) : active.length === 0 ? (
        <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-12 text-center">
          <p className="text-2xl text-slate-300 font-bold">No active permits</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            When a permit is signed and active, it appears here with a live countdown.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {active.map(p => <PermitCard key={p.id} permit={p} now={now} />)}
        </section>
      )}

      <footer className="text-[11px] text-slate-600 dark:text-slate-300 text-center pt-4">
        Soteria Field · {active.length + expired.length} permit{active.length + expired.length === 1 ? '' : 's'} on display
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

function PermitCard({ permit, now }: { permit: PermitWithSpace; now: number }) {
  const countdown = permitCountdown(permit, now)
  const t = effectiveThresholds(permit, permit.space ?? null)
  const reading = permit.latestTest ? evaluateTest(permit.latestTest, t) : null

  const cardCls =
    countdown.tone === 'critical' ? 'border-rose-500 bg-rose-950/30 ring-2 ring-rose-500/40'
  : countdown.tone === 'warning'  ? 'border-amber-500 bg-amber-950/30'
  :                                 'border-emerald-700 bg-emerald-950/20'

  const timerCls =
    countdown.tone === 'critical' ? 'text-rose-300'
  : countdown.tone === 'warning'  ? 'text-amber-300'
  :                                 'text-emerald-300'

  return (
    <Link
      href={`/confined-spaces/${encodeURIComponent(permit.space_id)}/permits/${permit.id}`}
      className={`rounded-xl border-2 ${cardCls} p-4 sm:p-5 space-y-3 hover:bg-white/5 dark:hover:bg-slate-900/5 transition-colors block`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-bold tracking-wider text-slate-300 text-sm">{permit.serial}</p>
          <p className="text-lg sm:text-xl font-bold text-white mt-0.5">{permit.space_id}</p>
          {permit.space?.description && (
            <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{permit.space.description}</p>
          )}
        </div>
        {reading && <ReadingPill status={reading.status} />}
      </header>

      <div className={`text-5xl sm:text-6xl font-black tabular-nums font-mono ${timerCls} text-center py-2`}>
        {countdown.label}
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center uppercase tracking-widest -mt-2">
        Time remaining · expires {new Date(permit.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>

      <RosterRow label={`Entrants (${permit.entrants.length})`} names={permit.entrants} tone="entrant" />
      <RosterRow label={`Attendant${permit.attendants.length === 1 ? '' : 's'}`} names={permit.attendants} tone="attendant" />

      <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate" title={permit.purpose}>
        <span className="font-semibold text-slate-300">Purpose:</span> {permit.purpose}
      </p>
    </Link>
  )
}

function RosterRow({ label, names, tone }: { label: string; names: string[]; tone: 'entrant' | 'attendant' }) {
  const dotCls = tone === 'entrant' ? 'bg-sky-400' : 'bg-violet-400'
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

function ReadingPill({ status }: { status: ReadingStatus }) {
  const cls = status === 'pass' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-600'
            : status === 'fail' ? 'bg-rose-500/20 text-rose-300 border-rose-500 animate-pulse'
            :                     'bg-slate-700/50 text-slate-300 border-slate-600'
  const label = status === 'pass' ? 'Atmos OK'
              : status === 'fail' ? 'Atmos FAIL'
              :                     'Atmos —'
  return (
    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cls}`}>
      {label}
    </span>
  )
}

