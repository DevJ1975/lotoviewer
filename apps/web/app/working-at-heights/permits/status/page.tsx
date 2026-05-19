'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

// Big-monitor status board for Working-at-Heights permits. Mirrors the
// hot-work board's structure (dark, large fonts, auto-refresh, stale
// banner, visibility-aware polling) so a control room can swap between
// the two on the same TV. WAH-specific buckets: active in-shift, expired
// (forced close-out), suspended (work paused), recently closed.

const REFRESH_MS = 30_000
const TICK_MS    = 1000
const STALE_MS   = 60_000

interface PermitRow {
  id:             string
  permit_number:  string
  work_location:  string
  task_description: string | null
  status:         'active' | 'completed' | 'suspended' | 'cancelled'
  valid_from:     string
  valid_until:    string
  closed_at:      string | null
  worker:         { display_name: string } | null
  cp:             { display_name: string } | null
}

interface LivePermit extends PermitRow {
  minutesRemaining: number
}

function minutesUntil(iso: string, now: number): number {
  return Math.round((new Date(iso).getTime() - now) / 60_000)
}

function formatMinutes(min: number): string {
  if (min <= 0) return '0:00'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `0:${String(m).padStart(2, '0')}`
}

export default function PermitStatusBoard() {
  const { tenantId } = useTenant()
  const [permits, setPermits]         = useState<PermitRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [now, setNow]                 = useState<number>(() => Date.now())
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now())

  const load = useCallback(async () => {
    if (!tenantId) return
    const { data } = await supabase
      .from('wah_permits')
      .select('id, permit_number, work_location, task_description, status, valid_from, valid_until, closed_at, worker:members!worker_id(display_name), cp:members!cp_id(display_name)')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'suspended'])
      .order('valid_until', { ascending: true })
      .returns<PermitRow[]>()
    setPermits(data ?? [])
    setLoading(false)
    setLastRefresh(Date.now())
  }, [tenantId])

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null
    function start() { if (!id) id = setInterval(load, REFRESH_MS) }
    function stop()  { if (id) { clearInterval(id); id = null } }
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

  const live: LivePermit[] = useMemo(() => permits.map(p => ({
    ...p,
    minutesRemaining: minutesUntil(p.valid_until, now),
  })), [permits, now])

  const active    = live.filter(p => p.status === 'active'    && p.minutesRemaining >  0)
  const expired   = live.filter(p => p.status === 'active'    && p.minutesRemaining <= 0)
  const suspended = live.filter(p => p.status === 'suspended')

  const expiringSoon = active.filter(p => p.minutesRemaining <= 30).length

  const refreshAgeMs = Math.max(0, now - lastRefresh)
  const isStale      = refreshAgeMs > STALE_MS

  const needsAction = expired

  return (
    <div className="min-h-[calc(100vh-6rem)] bg-slate-950 text-white px-4 sm:px-8 py-6 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
            Working-at-Heights Permits — Status Board
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Live status · 29 CFR 1910 Subpart D · 29 CFR 1926 Subpart M · Cal/OSHA Title 8 §1670
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl sm:text-4xl font-mono font-bold">
            {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className={`text-[11px] ${isStale ? 'text-rose-400 font-bold' : 'text-slate-500'}`}>
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
            <p className="text-xs text-rose-200/80">Check your network. The board refreshes every 30 seconds.</p>
          </div>
          <button type="button" onClick={() => load()} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm">
            Retry now →
          </button>
        </section>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Headline label="Permits Active"     value={active.length}    tone="info" />
        <Headline label="Expiring (≤30 min)" value={expiringSoon}     tone={expiringSoon > 0 ? 'warning' : 'info'} />
        <Headline label="Suspended"          value={suspended.length} tone={suspended.length > 0 ? 'warning' : 'info'} />
        <Headline label="Needs Action"       value={needsAction.length} tone={needsAction.length > 0 ? 'critical' : 'info'} />
      </section>

      {needsAction.length > 0 && (
        <section className="rounded-xl border-4 border-rose-500 bg-rose-950/40 p-4 sm:p-6 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-black text-rose-300 flex items-center gap-3">
            <span className="inline-block w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
            Needs action — close out or re-issue
          </h2>
          <ul className="space-y-2">
            {needsAction.map(p => (
              <li key={p.id} className="bg-slate-900/70 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-lg font-mono font-bold text-rose-200 tracking-wider">{p.permit_number}</p>
                  <p className="text-sm text-slate-300 truncate">{p.work_location}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-rose-300 uppercase tracking-widest font-bold">Expired</p>
                  <p className="text-sm text-slate-400">{new Date(p.valid_until).toLocaleString()}</p>
                </div>
                <Link
                  href={`/admin/working-at-heights/permits/${p.id}`}
                  className="shrink-0 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm"
                >
                  Open permit →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-white rounded-full animate-spin" />
        </div>
      ) : active.length === 0 && suspended.length === 0 ? (
        <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-12 text-center">
          <p className="text-2xl text-slate-300 font-bold">No at-height work in progress</p>
          <p className="text-sm text-slate-500 mt-2">
            When a permit is issued, it appears here with a live countdown to its valid-until time.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {active.map(p    => <PermitCard key={p.id} permit={p} />)}
          {suspended.map(p => <PermitCard key={p.id} permit={p} />)}
        </section>
      )}

      <footer className="text-[11px] text-slate-600 text-center pt-4">
        SoteriaField · {active.length + suspended.length + needsAction.length} working-at-heights permit
        {active.length + suspended.length + needsAction.length === 1 ? '' : 's'} on display
      </footer>
    </div>
  )
}

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
      <p className="text-[11px] sm:text-xs uppercase tracking-widest text-slate-400 font-bold">{label}</p>
      <p className={`text-5xl sm:text-6xl font-black tabular-nums mt-1 ${numCls}`}>{value}</p>
    </div>
  )
}

function PermitCard({ permit }: { permit: LivePermit }) {
  const isSuspended = permit.status === 'suspended'
  const minutes = permit.minutesRemaining
  const tone =
      isSuspended                ? 'suspended'
    : minutes <= 30              ? 'critical'
    : minutes <= 120             ? 'warning'
    :                              'safe'

  const cardCls =
      tone === 'critical'  ? 'border-rose-500 bg-rose-950/30 ring-2 ring-rose-500/40'
    : tone === 'warning'   ? 'border-amber-500 bg-amber-950/30'
    : tone === 'suspended' ? 'border-blue-500 bg-blue-950/30'
    :                        'border-emerald-700 bg-emerald-950/20'

  const timerCls =
      tone === 'critical'  ? 'text-rose-300'
    : tone === 'warning'   ? 'text-amber-300'
    : tone === 'suspended' ? 'text-blue-300'
    :                        'text-emerald-300'

  return (
    <Link
      href={`/admin/working-at-heights/permits/${permit.id}`}
      className={`rounded-xl border-2 ${cardCls} p-4 sm:p-5 space-y-3 hover:bg-white/5 transition-colors block`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-bold tracking-wider text-slate-300 text-sm">{permit.permit_number}</p>
          <p className="text-lg sm:text-xl font-bold text-white mt-0.5 truncate" title={permit.work_location}>
            {permit.work_location}
          </p>
          {permit.task_description && (
            <p className="text-xs text-slate-400 truncate" title={permit.task_description}>
              {permit.task_description}
            </p>
          )}
        </div>
        {isSuspended && (
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-blue-500/20 text-blue-200 border-blue-600">
            Suspended
          </span>
        )}
      </header>

      <div className={`text-5xl sm:text-6xl font-black tabular-nums font-mono ${timerCls} text-center py-2`}>
        {formatMinutes(minutes)}
      </div>
      <p className="text-[10px] text-slate-500 text-center uppercase tracking-widest -mt-2">
        Time remaining
      </p>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <RosterCell label="Worker" name={permit.worker?.display_name ?? '—'} tone="worker" />
        <RosterCell label="CP"     name={permit.cp?.display_name ?? '—'}     tone="cp" />
      </div>
    </Link>
  )
}

function RosterCell({ label, name, tone }: { label: string; name: string; tone: 'worker' | 'cp' }) {
  const dotCls = tone === 'worker' ? 'bg-amber-400' : 'bg-blue-400'
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{label}</p>
      <p className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800/80 text-sm text-slate-100">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotCls}`} />
        {name}
      </p>
    </div>
  )
}
