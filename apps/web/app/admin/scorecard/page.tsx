'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart, Bar,
  XAxis, YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { useAuth } from '@/components/AuthProvider'
import { fetchScorecardMetrics, type ScorecardMetrics } from '@/lib/scorecardMetrics'

// EHS scorecard — the "what does my safety program look like over time"
// view that an EHS director reads. Distinct from the home page (operational
// "what's happening right now"). Admin-gated so it doesn't pollute the
// drawer for non-admins.
//
// Window options below the KPI strip let the same page answer "this week"
// and "this quarter" without a route change.

const WINDOW_OPTIONS = [
  { value: 7,  label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
] as const

export default function ScorecardPage() {
  const { profile, loading: authLoading } = useAuth()
  const [windowDays, setWindowDays] = useState<number>(30)
  const [metrics, setMetrics] = useState<ScorecardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    fetchScorecardMetrics(windowDays)
      .then(m => { if (!cancelled) setMetrics(m) })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load scorecard.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authLoading, profile, windowDays])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            EHS Scorecard
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Trend view across permits, atmospheric tests, and equipment compliance.
          </p>
        </div>
        <select
          value={windowDays}
          onChange={e => setWindowDays(Number(e.target.value))}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          {WINDOW_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </header>

      {loadError && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 rounded-xl px-4 py-3 text-xs text-rose-900 dark:text-rose-100">
          Couldn&apos;t load scorecard: {loadError}
        </div>
      )}

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Permits"             value={metrics?.totalPermits ?? '—'} sub={`in ${windowDays} days`} />
        <Kpi label="Cancel Rate"         value={metrics ? `${metrics.cancelRate}%` : '—'}        sub="excl. task complete" tone={cancelTone(metrics?.cancelRate)} />
        <Kpi label="Avg Duration"        value={metrics ? humanizeMin(metrics.avgPermitDurationMinutes) : '—'} sub="closed permits" />
        <Kpi label="Test Failures"       value={metrics ? `${metrics.failingTestRate}%` : '—'}   sub="vs site defaults"  tone={failTone(metrics?.failingTestRate)} />
        <Kpi label="Photo Coverage"      value={metrics ? `${metrics.photoCompletionPct}%` : '—'} sub="LOTO equipment"   tone={photoTone(metrics?.photoCompletionPct)} />
      </section>

      {/* Trend charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard
          title="Permits issued per day"
          subtitle="Bars are total issued. The amber slice is non-routine cancellations (prohibited conditions, expired without close-out)."
          loading={loading}
          empty={!metrics || metrics.permitsByDay.every(b => b.total === 0)}
        >
          {metrics && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.permitsByDay} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="#64748b" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(metrics.windowDays / 10))} />
                <YAxis allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total" name="Issued" stackId="a" fill="#214488" radius={[3, 3, 0, 0]} />
                <Bar dataKey="fail"  name="Non-routine cancel" stackId="b" fill="#D97706" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Atmospheric tests per day"
          subtitle="Failing slice = readings that exceeded site-default thresholds."
          loading={loading}
          empty={!metrics || metrics.testsByDay.every(b => b.total === 0)}
        >
          {metrics && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.testsByDay} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="#64748b" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(metrics.windowDays / 10))} />
                <YAxis allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total" name="Tests" stackId="a" fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="fail"  name="Failing"  stackId="b" fill="#BF1414" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Cancellation reason breakdown */}
      <ChartCard
        title="Cancellations by reason"
        subtitle="What's driving permit closures. A growing 'expired' bar indicates supervisors not closing out on time; 'prohibited condition' means the permit was halted for a real safety reason."
        loading={loading}
        empty={!metrics || metrics.cancelReasonBreakdown.length === 0}
      >
        {metrics && (
          <ResponsiveContainer width="100%" height={Math.max(120, metrics.cancelReasonBreakdown.length * 36)}>
            <BarChart data={metrics.cancelReasonBreakdown} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="reason" width={140} stroke="#64748b" tick={{ fontSize: 11 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="count" name="Permits" radius={[0, 3, 3, 0]}>
                {metrics.cancelReasonBreakdown.map((row, i) => (
                  <Cell key={i} fill={cancelReasonColor(row.reason)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  )
}

// ── Bits ──────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone }: {
  label: string
  value: string | number
  sub:   string
  tone?: 'safe' | 'warning' | 'critical'
}) {
  const valueCls = tone === 'critical' ? 'text-rose-700 dark:text-rose-300'
                 : tone === 'warning'  ? 'text-amber-700 dark:text-amber-300'
                 : tone === 'safe'     ? 'text-emerald-700 dark:text-emerald-300'
                 :                       'text-slate-900 dark:text-slate-100'
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-2xl font-black tabular-nums mt-1 ${valueCls}`}>{value}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function ChartCard({
  title, subtitle, loading, empty, children,
}: {
  title:    string
  subtitle: string
  loading:  boolean
  empty:    boolean
  children: React.ReactNode
}) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
      <header>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : empty ? (
        <p className="py-10 text-center text-xs text-slate-400 dark:text-slate-500 italic">No data in this window yet.</p>
      ) : children}
    </section>
  )
}

function shortDate(iso: string): string {
  // 2026-04-26 → "4/26"
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function humanizeMin(min: number): string {
  if (min === 0)    return '—'
  if (min < 60)     return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function cancelTone(rate: number | undefined): 'safe' | 'warning' | 'critical' | undefined {
  if (rate == null)  return undefined
  if (rate >= 25)    return 'critical'
  if (rate >= 10)    return 'warning'
  return 'safe'
}

function failTone(rate: number | undefined): 'safe' | 'warning' | 'critical' | undefined {
  if (rate == null) return undefined
  if (rate >= 10)   return 'critical'
  if (rate >= 5)    return 'warning'
  return 'safe'
}

function photoTone(pct: number | undefined): 'safe' | 'warning' | 'critical' | undefined {
  if (pct == null) return undefined
  if (pct >= 90)   return 'safe'
  if (pct >= 70)   return 'warning'
  return 'critical'
}

function cancelReasonColor(reason: string): string {
  switch (reason) {
    case 'Task complete':         return '#059669'   // emerald
    case 'Prohibited condition':  return '#BF1414'   // red
    case 'Expired':               return '#D97706'   // amber
    default:                      return '#64748b'   // slate
  }
}
