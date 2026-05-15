'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BarChart3,
  Camera,
  ClipboardCheck,
  Gauge,
  Loader2,
  Timer,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart, Bar,
  XAxis, YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { useAuth } from '@/components/AuthProvider'
import { fetchScorecardMetrics, type DayBucket, type ScorecardMetrics } from '@soteria/core/scorecardMetrics'

// EHS scorecard - an operations-board view for safety leaders.
// The top strip intentionally reads as infographics instead of plain
// number cards: each metric carries a shape, a threshold, and a short
// program-health interpretation.

const WINDOW_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
] as const

type Tone = 'safe' | 'watch' | 'critical' | 'neutral'

const TONE_STYLES: Record<Tone, {
  accent: string
  soft: string
  text: string
  border: string
  fill: string
}> = {
  safe: {
    accent: '#059669',
    soft: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200/80 dark:border-emerald-900/70',
    fill: 'bg-emerald-600',
  },
  watch: {
    accent: '#D97706',
    soft: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200/80 dark:border-amber-900/70',
    fill: 'bg-amber-500',
  },
  critical: {
    accent: '#BE123C',
    soft: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200/80 dark:border-rose-900/70',
    fill: 'bg-rose-600',
  },
  neutral: {
    accent: '#1B3A6B',
    soft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    text: 'text-slate-900 dark:text-slate-100',
    border: 'border-slate-200 dark:border-slate-800',
    fill: 'bg-brand-navy',
  },
}

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
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="ops-surface-raised animate-panel-in rounded-lg px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/"
            className="motion-press flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-brand-navy/30 hover:bg-brand-navy/5 hover:text-brand-navy dark:border-slate-800 dark:text-slate-400 dark:hover:border-brand-yellow/30 dark:hover:bg-brand-yellow/10 dark:hover:text-brand-yellow"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-navy text-white dark:bg-brand-yellow dark:text-slate-950">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black text-slate-950 dark:text-slate-50">EHS Scorecard</h1>
                <p className="ops-muted truncate text-sm">
                  Program health across permits, atmospheric tests, and equipment readiness.
                </p>
              </div>
            </div>
          </div>
          <select
            value={windowDays}
            onChange={e => setWindowDays(Number(e.target.value))}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {WINDOW_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </header>

      {loadError && (
        <div className="animate-panel-in rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100">
          Could not load scorecard: {loadError}
        </div>
      )}

      {metrics ? (
        <ScorecardInfographics key={windowDays} metrics={metrics} windowDays={windowDays} loading={loading} />
      ) : (
        <ScorecardSkeleton />
      )}
    </div>
  )
}

function ScorecardInfographics({
  metrics,
  windowDays,
  loading,
}: {
  metrics: ScorecardMetrics
  windowDays: number
  loading: boolean
}) {
  const permitMax = Math.max(1, ...metrics.permitsByDay.map(day => day.total))
  const permitCount = useCountUp(metrics.totalPermits)
  const cancelRate = useCountUp(metrics.cancelRate)
  const permitDuration = useCountUp(metrics.avgPermitDurationMinutes)
  const failingTestRate = useCountUp(metrics.failingTestRate)
  const photoCompletion = useCountUp(metrics.photoCompletionPct)

  return (
    <>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <InfographicTile
          label="Permit Load"
          display={String(permitCount)}
          unit="permits"
          narrative={permitNarrative(metrics.totalPermits, windowDays)}
          tone="neutral"
          icon={ClipboardCheck}
          visual={<ActivityBars buckets={metrics.permitsByDay} max={permitMax} tone="neutral" />}
        />
        <InfographicTile
          label="Cancel Pressure"
          display={`${cancelRate}%`}
          unit="non-routine"
          narrative={riskNarrative(metrics.cancelRate, 'cancel')}
          tone={cancelTone(metrics.cancelRate)}
          icon={Gauge}
          visual={<RadialGauge percent={metrics.cancelRate} tone={cancelTone(metrics.cancelRate)} inverse />}
        />
        <InfographicTile
          label="Permit Cycle"
          display={humanizeMin(permitDuration)}
          unit="closed average"
          narrative={durationNarrative(metrics.avgPermitDurationMinutes)}
          tone={durationTone(metrics.avgPermitDurationMinutes)}
          icon={Timer}
          visual={<DurationTimeline minutes={metrics.avgPermitDurationMinutes} />}
        />
        <InfographicTile
          label="Atmospheric Control"
          display={`${failingTestRate}%`}
          unit="failed tests"
          narrative={riskNarrative(metrics.failingTestRate, 'test')}
          tone={failTone(metrics.failingTestRate)}
          icon={Wind}
          visual={<SensorStack percent={metrics.failingTestRate} tone={failTone(metrics.failingTestRate)} />}
        />
        <InfographicTile
          label="LOTO Photo Readiness"
          display={`${photoCompletion}%`}
          unit="complete"
          narrative={photoNarrative(metrics.photoCompletionPct)}
          tone={photoTone(metrics.photoCompletionPct)}
          icon={Camera}
          visual={<RadialGauge percent={metrics.photoCompletionPct} tone={photoTone(metrics.photoCompletionPct)} />}
        />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard
          title="Permit issue pattern"
          subtitle="Daily starts with non-routine cancellations overlaid."
          loading={loading}
          empty={metrics.permitsByDay.every(b => b.total === 0)}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={metrics.permitsByDay} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ee" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} stroke="#64748b" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(metrics.windowDays / 10))} />
              <YAxis allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} cursor={{ fill: 'rgba(27, 58, 107, 0.08)' }} />
              <Bar dataKey="total" name="Issued" stackId="a" fill="#1B3A6B" radius={[4, 4, 0, 0]} animationDuration={650} />
              <Bar dataKey="fail" name="Non-routine cancel" stackId="b" fill="#D97706" radius={[4, 4, 0, 0]} animationDuration={650} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Atmospheric test pattern"
          subtitle="Total readings with failures against site-default thresholds."
          loading={loading}
          empty={metrics.testsByDay.every(b => b.total === 0)}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={metrics.testsByDay} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ee" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} stroke="#64748b" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(metrics.windowDays / 10))} />
              <YAxis allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} cursor={{ fill: 'rgba(5, 150, 105, 0.08)' }} />
              <Bar dataKey="total" name="Tests" stackId="a" fill="#059669" radius={[4, 4, 0, 0]} animationDuration={650} />
              <Bar dataKey="fail" name="Failing" stackId="b" fill="#BE123C" radius={[4, 4, 0, 0]} animationDuration={650} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Cancellation drivers"
        subtitle="Reason mix for permit closures in the selected window."
        loading={loading}
        empty={metrics.cancelReasonBreakdown.length === 0}
      >
        <ResponsiveContainer width="100%" height={Math.max(132, metrics.cancelReasonBreakdown.length * 40)}>
          <BarChart data={metrics.cancelReasonBreakdown} layout="vertical" margin={{ top: 8, right: 28, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ee" horizontal={false} />
            <XAxis type="number" allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="reason" width={148} stroke="#64748b" tick={{ fontSize: 11 }} />
            <Tooltip wrapperStyle={{ fontSize: 11 }} cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }} />
            <Bar dataKey="count" name="Permits" radius={[0, 4, 4, 0]} animationDuration={650}>
              {metrics.cancelReasonBreakdown.map((row, i) => (
                <Cell key={i} fill={cancelReasonColor(row.reason)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <section className="ops-surface animate-panel-in rounded-lg p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ProgramSignal label="Permit volume" value={metrics.totalPermits > 0 ? 'Active' : 'Quiet'} tone={metrics.totalPermits > 0 ? 'neutral' : 'safe'} />
          <ProgramSignal label="Controls" value={metrics.cancelRate >= 10 || metrics.failingTestRate >= 5 ? 'Watch' : 'Stable'} tone={metrics.cancelRate >= 25 || metrics.failingTestRate >= 10 ? 'critical' : metrics.cancelRate >= 10 || metrics.failingTestRate >= 5 ? 'watch' : 'safe'} />
          <ProgramSignal label="Equipment evidence" value={metrics.photoCompletionPct >= 90 ? 'Ready' : 'Gap'} tone={photoTone(metrics.photoCompletionPct)} />
        </div>
      </section>
    </>
  )
}

function InfographicTile({
  label,
  display,
  unit,
  narrative,
  tone,
  icon: Icon,
  visual,
}: {
  label: string
  display: string
  unit: string
  narrative: string
  tone: Tone
  icon: LucideIcon
  visual: ReactNode
}) {
  const style = TONE_STYLES[tone]
  return (
    <article className={`ops-surface-interactive ops-surface animate-panel-in rounded-lg p-4 ${style.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">{label}</p>
          <div className="mt-1 flex items-end gap-2">
            <p className={`text-3xl font-black tabular-nums leading-none ${style.text}`}>{display}</p>
            <p className="pb-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{unit}</p>
          </div>
        </div>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-md ${style.soft}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 min-h-20">{visual}</div>
      <p className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
        {narrative}
      </p>
    </article>
  )
}

function ActivityBars({ buckets, max, tone }: { buckets: DayBucket[]; max: number; tone: Tone }) {
  const style = TONE_STYLES[tone]
  const condensed = useMemo(() => downsampleBuckets(buckets, 18), [buckets])
  return (
    <div className="flex h-20 items-end gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/50">
      {condensed.map(bucket => {
        const height = Math.max(8, Math.round((bucket.total / max) * 100))
        return (
          <div key={bucket.date} className="flex min-w-0 flex-1 items-end">
            <div
              className={`animate-meter-fill w-full rounded-t-sm ${style.fill}`}
              style={{ height: `${height}%` }}
              title={`${bucket.date}: ${bucket.total}`}
            />
          </div>
        )
      })}
    </div>
  )
}

function RadialGauge({ percent, tone, inverse = false }: { percent: number; tone: Tone; inverse?: boolean }) {
  const style = TONE_STYLES[tone]
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const clamped = clamp(percent, 0, 100)
  const offset = circumference - (clamped / 100) * circumference
  const targetLabel = inverse ? 'lower is better' : 'target 90%+'
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 92 92" className="h-20 w-20 shrink-0 -rotate-90">
        <circle cx="46" cy="46" r={radius} fill="none" stroke="rgba(148, 163, 184, 0.24)" strokeWidth="9" />
        <circle
          className="animate-gauge-sweep"
          cx="46"
          cy="46"
          r={radius}
          fill="none"
          stroke={style.accent}
          strokeLinecap="round"
          strokeWidth="9"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ '--gauge-empty': circumference } as CSSProperties}
        />
      </svg>
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{targetLabel}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className={`animate-meter-fill h-full ${style.fill}`} style={{ width: `${clamped}%` }} />
        </div>
      </div>
    </div>
  )
}

function DurationTimeline({ minutes }: { minutes: number }) {
  const clamped = clamp(minutes / 240 * 100, 0, 100)
  const tone = durationTone(minutes)
  const style = TONE_STYLES[tone]
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="flex justify-between text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
        <span>0m</span>
        <span>2h</span>
        <span>4h+</span>
      </div>
      <div className="mt-3 h-3 rounded-full bg-slate-200 dark:bg-slate-800">
        <div className={`animate-meter-fill h-full rounded-full ${style.fill}`} style={{ width: `${clamped}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={`h-1 rounded-full ${i * 25 <= clamped ? style.fill : 'bg-slate-200 dark:bg-slate-800'}`} />
        ))}
      </div>
    </div>
  )
}

function SensorStack({ percent, tone }: { percent: number; tone: Tone }) {
  const style = TONE_STYLES[tone]
  const active = Math.ceil(clamp(percent, 0, 100) / 20)
  return (
    <div className="grid grid-cols-5 gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/50">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="flex h-20 flex-col-reverse gap-1">
          {[0, 1, 2, 3].map(j => {
            const filled = i < active && j <= i % 4
            return (
              <span
                key={j}
                className={`h-full rounded-sm transition-colors ${filled ? style.fill : 'bg-slate-200 dark:bg-slate-800'}`}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ProgramSignal({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const style = TONE_STYLES[tone]
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/50">
      <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`rounded-md px-2 py-1 text-xs font-black ${style.soft}`}>{value}</span>
    </div>
  )
}

function ScorecardSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="ops-surface animate-pulse rounded-lg p-4">
          <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-3 h-8 w-20 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-5 h-20 rounded bg-slate-100 dark:bg-slate-900" />
        </div>
      ))}
    </section>
  )
}

function ChartCard({
  title, subtitle, loading, empty, children,
}: {
  title: string
  subtitle: string
  loading: boolean
  empty: boolean
  children: ReactNode
}) {
  return (
    <section className="ops-surface animate-panel-in rounded-lg p-4">
      <header className="mb-3">
        <h2 className="ops-section-title text-sm font-black">{title}</h2>
        <p className="ops-muted text-xs">{subtitle}</p>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : empty ? (
        <p className="py-10 text-center text-xs text-slate-400 dark:text-slate-500">No data in this window yet.</p>
      ) : children}
    </section>
  )
}

function useCountUp(value: number): number {
  const [displayed, setDisplayed] = useState(0)
  const displayedRef = useRef(0)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayed(value)
      displayedRef.current = value
      return
    }

    const start = performance.now()
    const from = displayedRef.current
    const delta = value - from
    const duration = 620
    let frame = 0

    function tick(now: number) {
      const progress = clamp((now - start) / duration, 0, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = Math.round(from + delta * eased)
      displayedRef.current = next
      setDisplayed(next)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return displayed
}

function downsampleBuckets(buckets: DayBucket[], maxCount: number): DayBucket[] {
  if (buckets.length <= maxCount) return buckets
  const step = Math.ceil(buckets.length / maxCount)
  const out: DayBucket[] = []
  for (let i = 0; i < buckets.length; i += step) {
    const slice = buckets.slice(i, i + step)
    out.push({
      date: slice[0]?.date ?? '',
      total: slice.reduce((sum, bucket) => sum + bucket.total, 0),
      fail: slice.reduce((sum, bucket) => sum + bucket.fail, 0),
    })
  }
  return out
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function humanizeMin(min: number): string {
  if (min === 0) return '0m'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function permitNarrative(total: number, windowDays: number): string {
  if (total === 0) return 'Quiet window: no permits started.'
  const perDay = total / windowDays
  if (perDay >= 4) return 'High throughput: watch closure discipline.'
  if (perDay >= 1) return 'Normal operating cadence.'
  return 'Low activity: confirm reporting is complete.'
}

function riskNarrative(rate: number, kind: 'cancel' | 'test'): string {
  if (kind === 'cancel') {
    if (rate >= 25) return 'Critical: cancellations are dominating the window.'
    if (rate >= 10) return 'Watch: non-routine cancels need review.'
    return 'Contained: cancellations are below threshold.'
  }
  if (rate >= 10) return 'Critical: failing readings exceed control limits.'
  if (rate >= 5) return 'Watch: atmospheric failures are elevated.'
  return 'Stable: readings are within expected range.'
}

function durationNarrative(minutes: number): string {
  if (minutes === 0) return 'No closed permits to benchmark yet.'
  if (minutes > 240) return 'Long cycles: verify permit closeout timing.'
  if (minutes > 120) return 'Extended work: monitor handoff quality.'
  return 'Efficient closure pattern.'
}

function photoNarrative(pct: number): string {
  if (pct >= 90) return 'Ready: evidence coverage supports placard quality.'
  if (pct >= 70) return 'Watch: photo gaps can slow review cycles.'
  return 'Critical: photo evidence needs cleanup.'
}

function cancelTone(rate: number): Tone {
  if (rate >= 25) return 'critical'
  if (rate >= 10) return 'watch'
  return 'safe'
}

function failTone(rate: number): Tone {
  if (rate >= 10) return 'critical'
  if (rate >= 5) return 'watch'
  return 'safe'
}

function photoTone(pct: number): Tone {
  if (pct >= 90) return 'safe'
  if (pct >= 70) return 'watch'
  return 'critical'
}

function durationTone(minutes: number): Tone {
  if (minutes === 0) return 'neutral'
  if (minutes > 240) return 'critical'
  if (minutes > 120) return 'watch'
  return 'safe'
}

function cancelReasonColor(reason: string): string {
  switch (reason) {
    case 'Task complete': return '#059669'
    case 'Prohibited condition': return '#BE123C'
    case 'Expired': return '#D97706'
    default: return '#64748b'
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
