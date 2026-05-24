'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Camera,
  ClipboardCheck,
  FileDown,
  Gauge,
  HeartPulse,
  Loader2,
  Mail,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Timer,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart, Bar,
  ComposedChart, Line,
  XAxis, YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { fetchScorecardMetrics, type DayBucket, type ScorecardMetrics } from '@soteria/core/scorecardMetrics'
import { fetchIncidentScorecardMetrics, type IncidentScorecardMetrics } from '@soteria/core/incidentScorecardMetrics'
import type { IncidentRiskResult, IncidentRiskBand } from '@soteria/core/incidentRiskModel'

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

  const { tenantId } = useTenant()
  const [presentation, setPresentation] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Keep presentation mode in sync with the browser fullscreen state, so the
  // Esc key (which exits fullscreen) also drops the clean layout.
  useEffect(() => {
    function onFsChange() { if (!document.fullscreenElement) setPresentation(false) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  async function togglePresentation() {
    if (!presentation) {
      try { await document.documentElement.requestFullscreen?.() } catch { /* fullscreen optional */ }
      setPresentation(true)
    } else {
      if (document.fullscreenElement) { try { await document.exitFullscreen?.() } catch { /* ignore */ } }
      setPresentation(false)
    }
  }

  async function exportPdf() {
    if (!tenantId || !metrics) return
    setExporting(true); setExportError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/scorecard/export', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-active-tenant': tenantId,
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ metrics, windowDays }),
      })
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ehs-scorecard-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not export PDF')
    } finally {
      setExporting(false)
    }
  }

  // Injury & OSHA recordkeeping metrics — trailing 12 months, RLS-scoped
  // client-side fetch (same pattern as fetchScorecardMetrics). Independent of
  // the permit window selector since TRIR/DART are annual by definition.
  const [incidentMetrics, setIncidentMetrics] = useState<IncidentScorecardMetrics | null>(null)
  useEffect(() => {
    if (authLoading || !profile?.is_admin) return
    let cancelled = false
    fetchIncidentScorecardMetrics(365)
      .then(m => { if (!cancelled && m) setIncidentMetrics(m) })
      .catch(() => { /* non-fatal — section just stays hidden */ })
    return () => { cancelled = true }
  }, [authLoading, profile])

  // Year-over-year history from saved OSHA 300A annual summaries (imported
  // prior-year data + posted current year). RLS-scoped client-side read; the
  // current calendar year is overlaid live from incidentMetrics.
  const [annualHistory, setAnnualHistory] = useState<YearMetric[] | null>(null)
  useEffect(() => {
    if (authLoading || !profile?.is_admin) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('osha_annual_summaries')
        .select('year, totals_json, total_hours_worked')
      if (error || !data) return
      if (!cancelled) setAnnualHistory(aggregateAnnualHistory(data as AnnualSummaryRow[]))
    })()
    return () => { cancelled = true }
  }, [authLoading, profile])

  // Data-driven incident-risk score (deterministic, computed server-side).
  const [risk, setRisk] = useState<IncidentRiskResult | null>(null)
  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch('/api/insights/incident-risk', {
          headers: {
            'x-active-tenant': tenantId,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        })
        if (!res.ok) return
        const j = (await res.json()) as IncidentRiskResult
        if (!cancelled) setRisk(j)
      } catch { /* non-fatal — the card just stays hidden */ }
    })()
    return () => { cancelled = true }
  }, [tenantId])

  // Open the weekly weather-report email exactly as it will send, in a new
  // tab — so an admin can see it before it goes out. Auth needs the bearer +
  // tenant header, so fetch the HTML and open it as a blob.
  async function previewWeather() {
    if (!tenantId) return
    setPreviewing(true); setExportError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/scorecard/weather-preview', {
        headers: {
          'x-active-tenant': tenantId,
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      })
      if (!res.ok) throw new Error(`Preview failed (${res.status})`)
      const html = await res.text()
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not preview the weekly email')
    } finally {
      setPreviewing(false)
    }
  }

  if (authLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className={presentation
      ? 'fixed inset-0 z-50 space-y-5 overflow-y-auto bg-white p-6 dark:bg-slate-950'
      : 'mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8'}>
      <header className="ops-surface-raised animate-panel-in rounded-lg px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {!presentation && (
            <Link
              href="/"
              className="motion-press flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-brand-navy/30 hover:bg-brand-navy/5 hover:text-brand-navy dark:border-slate-800 dark:text-slate-400 dark:hover:border-brand-yellow/30 dark:hover:bg-brand-yellow/10 dark:hover:text-brand-yellow"
              aria-label="Back to home"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-navy text-white dark:bg-brand-yellow dark:text-slate-950">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black text-slate-950 dark:text-slate-50">EHS Scorecard</h1>
                <p className="ops-muted truncate text-sm">
                  Recordable trend, TRIR/DART, predicted risk, and year-over-year performance — your whole safety program at a glance.
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={windowDays}
              onChange={e => setWindowDays(Number(e.target.value))}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {WINDOW_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={exportPdf}
              disabled={exporting || !metrics}
              className="motion-press flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-brand-navy/30 hover:text-brand-navy disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              aria-label="Download PDF report"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              <span className="hidden sm:inline">PDF</span>
            </button>
            <button
              onClick={previewWeather}
              disabled={previewing}
              className="motion-press flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-brand-navy/30 hover:text-brand-navy disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              aria-label="Preview the weekly email"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              <span className="hidden sm:inline">Preview email</span>
            </button>
            <button
              onClick={togglePresentation}
              className="motion-press flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-brand-navy/30 hover:text-brand-navy dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              aria-label={presentation ? 'Exit presentation mode' : 'Enter presentation mode'}
            >
              {presentation ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{presentation ? 'Exit' : 'Present'}</span>
            </button>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="animate-panel-in rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100">
          Could not load scorecard: {loadError}
        </div>
      )}
      {exportError && (
        <div className="animate-panel-in rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100">
          {exportError}
        </div>
      )}

      {risk && <PredictedRiskCard risk={risk} />}

      {incidentMetrics && <IncidentScorecardSection metrics={incidentMetrics} annualHistory={annualHistory} />}

      <div className="flex items-center gap-2 pt-1">
        <span className="ops-section-title text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Permits &amp; LOTO</span>
        <span aria-hidden="true" className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>
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
          href="/confined-spaces"
        />
        <InfographicTile
          label="Cancel Pressure"
          display={`${cancelRate}%`}
          unit="non-routine"
          narrative={riskNarrative(metrics.cancelRate, 'cancel')}
          tone={cancelTone(metrics.cancelRate)}
          icon={Gauge}
          visual={<RadialGauge percent={metrics.cancelRate} tone={cancelTone(metrics.cancelRate)} inverse />}
          href="/confined-spaces"
        />
        <InfographicTile
          label="Permit Cycle"
          display={humanizeMin(permitDuration)}
          unit="closed average"
          narrative={durationNarrative(metrics.avgPermitDurationMinutes)}
          tone={durationTone(metrics.avgPermitDurationMinutes)}
          icon={Timer}
          visual={<DurationTimeline minutes={metrics.avgPermitDurationMinutes} />}
          href="/confined-spaces"
        />
        <InfographicTile
          label="Atmospheric Control"
          display={`${failingTestRate}%`}
          unit="failed tests"
          narrative={riskNarrative(metrics.failingTestRate, 'test')}
          tone={failTone(metrics.failingTestRate)}
          icon={Wind}
          visual={<SensorStack percent={metrics.failingTestRate} tone={failTone(metrics.failingTestRate)} />}
          href="/confined-spaces"
        />
        <InfographicTile
          label="LOTO Photo Readiness"
          display={`${photoCompletion}%`}
          unit="complete"
          narrative={photoNarrative(metrics.photoCompletionPct)}
          tone={photoTone(metrics.photoCompletionPct)}
          icon={Camera}
          visual={<RadialGauge percent={metrics.photoCompletionPct} tone={photoTone(metrics.photoCompletionPct)} />}
          href="/equipment-readiness"
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
  href,
}: {
  label: string
  display: string
  unit: string
  narrative: string
  tone: Tone
  icon: LucideIcon
  visual: ReactNode
  href?: string
}) {
  const style = TONE_STYLES[tone]
  const className = `ops-surface-interactive ops-surface animate-panel-in block rounded-lg p-4 outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/40 dark:focus-visible:ring-brand-yellow/40 ${style.border}`
  const title = `${label}: ${display} ${unit} — ${narrative}`
  const body = (
    <>
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
    </>
  )
  return href
    ? <Link href={href} title={title} className={className}>{body}</Link>
    : <article tabIndex={0} title={title} className={className}>{body}</article>
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
    <div className="flex cursor-help items-center gap-3" title={`${Math.round(clamped)}% · ${targetLabel}`}>
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
    <div className="cursor-help rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50" title={`Average closure: ${humanizeMin(minutes)}`}>
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
    <div className="grid cursor-help grid-cols-5 gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/50" title={`${Math.round(clamp(percent, 0, 100))}% failing readings`}>
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
  title, subtitle, loading, empty, children, href,
}: {
  title: string
  subtitle: string
  loading: boolean
  empty: boolean
  children: ReactNode
  href?: string
}) {
  return (
    <section className="ops-surface animate-panel-in rounded-lg p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="ops-section-title text-sm font-black">{title}</h2>
          <p className="ops-muted text-xs">{subtitle}</p>
        </div>
        {href && <Link href={href} className="shrink-0 text-[11px] font-bold text-brand-navy hover:underline dark:text-brand-yellow">View &rarr;</Link>}
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

const RISK_BAND_STYLE: Record<IncidentRiskBand, { ring: string; chip: string; bar: string; label: string }> = {
  low:      { ring: 'border-emerald-200 dark:border-emerald-900/70', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200', bar: 'bg-emerald-500', label: 'Low' },
  moderate: { ring: 'border-amber-200 dark:border-amber-900/70',     chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',         bar: 'bg-amber-500',   label: 'Moderate' },
  high:     { ring: 'border-orange-200 dark:border-orange-900/70',   chip: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',     bar: 'bg-orange-500',  label: 'High' },
  extreme:  { ring: 'border-rose-200 dark:border-rose-900/70',       chip: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',             bar: 'bg-rose-600',    label: 'Extreme' },
}

// Predicted incident-risk card — the deterministic score + the ranked drivers
// ("where to work"). Each driver links to the module where the work happens.
function PredictedRiskCard({ risk }: { risk: IncidentRiskResult }) {
  const style = RISK_BAND_STYLE[risk.band]
  const topDrivers = risk.drivers.filter(d => d.contribution > 0).slice(0, 4)
  return (
    <section className={`animate-panel-in rounded-xl border bg-white p-4 dark:bg-slate-900 ${style.ring}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="sm:w-48 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Predicted incident risk</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-4xl font-black tabular-nums text-slate-900 dark:text-slate-50">{Math.round(risk.score)}</span>
            <span className="mb-1 text-sm text-slate-400">/ 100</span>
            <span className={`mb-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${style.chip}`}>{style.label}</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={`h-full ${style.bar}`} style={{ width: `${clamp(risk.score, 0, 100)}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Data-driven from leading + lagging indicators. Not a compliance determination.</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Where to work to lower it</p>
          {topDrivers.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No elevated drivers — program indicators are healthy.</p>
          ) : (
            <ul className="space-y-1.5">
              {topDrivers.map(d => (
                <li key={d.key}>
                  <Link href={d.href} className="group flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 hover:border-brand-navy/30 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800 group-hover:text-brand-navy dark:text-slate-100">{d.label}</span>
                      <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{d.value} · target {d.target}</span>
                    </span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">+{d.contribution}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

// Injury & OSHA recordkeeping — the lagging/leading safety metrics an EHS
// director reads first: the recordable-free streak, OSHA rates (TRIR/DART/
// LTIR), the 300A recordkeeping roll-up, this-week momentum, the recordable +
// near-miss trend, and where on the body people are getting hurt. All from the
// trailing-12-month IncidentScorecardMetrics.
function IncidentScorecardSection({ metrics: m, annualHistory }: {
  metrics: IncidentScorecardMetrics
  annualHistory: YearMetric[] | null
}) {
  const streak = m.daysSinceLastRecordable
  const monthly = mergeMonthly(m.recordablesByMonth, m.nearMissByMonth)
  const bodyParts = m.bodyPartHeatmap.slice(0, 8).map(b => ({ name: humanizeBodyPart(b.body_part), count: b.count }))
  const injuryNatures = m.injuryNatureBreakdown.slice(0, 8).map(b => ({ name: humanizeNature(b.injury_nature), count: b.count }))
  const yoy = buildYearOverYear(annualHistory, m)

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="ops-section-title text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Injury &amp; OSHA recordkeeping · trailing 12 months</span>
        <span aria-hidden="true" className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <IncidentStatCard icon={CalendarClock} label="Days since last recordable"
          value={streak < 0 ? '—' : String(streak)}
          sub={streak < 0 ? 'none on file' : streak === 1 ? 'day' : 'days'}
          accent={streak < 0 || streak >= 30 ? 'safe' : 'neutral'} href="/incidents" />
        <IncidentStatCard icon={Activity} label="TRIR" value={fmtRate(m.trir)} sub="per 100 FTE" accent="neutral" href="/osha" />
        <IncidentStatCard icon={Activity} label="DART" value={fmtRate(m.dart)} sub="per 100 FTE" accent="neutral" href="/osha" />
        <IncidentStatCard icon={Activity} label="LTIR" value={fmtRate(m.ltir)} sub="per 100 FTE" accent="neutral" href="/osha" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <IncidentStatCard icon={Gauge} label="Severity rate" value={fmtRate(m.severityRate)} sub="days × 200K / hrs" accent="neutral" href="/osha" />
        <IncidentStatCard icon={ClipboardCheck} label="CAPA on time" value={fmtPct(m.actionClosureOnTimePct)} sub="closed by due date" accent={pctTone(m.actionClosureOnTimePct)} href="/incidents" />
        <IncidentStatCard icon={ShieldCheck} label="RCA completion" value={fmtPct(m.rcaCompletionPct)} sub={`${m.recordablesWithCompletedRca} of ${m.totalRecordable} recordable`} accent={pctTone(m.rcaCompletionPct)} href="/incidents" />
        <IncidentStatCard icon={Timer} label="Time to close" value={m.meanTimeToCloseDays === null ? '—' : m.meanTimeToCloseDays.toFixed(1)} sub="avg days, reported→closed" accent="neutral" href="/incidents" />
      </div>

      {yoy.length >= 2 && (
        <ChartCard
          title="Year over year — TRIR & recordables"
          subtitle={`${yoy[0]!.year}–${yoy[yoy.length - 1]!.year} · imported history + live current year`}
          loading={false}
          empty={false}
          href="/osha"
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={yoy} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ee" vertical={false} />
              <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" stroke="#1D3ECF" tick={{ fontSize: 10 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} cursor={{ fill: 'rgba(27, 58, 107, 0.06)' }} />
              <Bar yAxisId="left" dataKey="recordables" name="Recordables" fill="#cbd5e1" radius={[3, 3, 0, 0]} animationDuration={600} />
              <Line yAxisId="right" type="monotone" dataKey="trir" name="TRIR" stroke="#1D3ECF" strokeWidth={2.5} dot={{ r: 2 }} animationDuration={700} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="ops-surface animate-panel-in rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/15 dark:text-brand-yellow"><ShieldCheck className="h-4 w-4" /></span>
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">OSHA recordkeeping</h3>
            <Link href="/osha" className="ml-auto text-[11px] font-bold text-brand-navy hover:underline dark:text-brand-yellow">300 log &rarr;</Link>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <RecordkeepingStat label="Total recordable" value={m.totalRecordable} />
            <RecordkeepingStat label="Days-away cases" value={m.totalDaysAwayCases} />
            <RecordkeepingStat label="Restricted/xfer" value={m.totalRestrictedCases} />
            <RecordkeepingStat label="Other recordable" value={m.totalOtherRecordable} />
            <RecordkeepingStat label="Days away (total)" value={m.totalDaysAwayCount} />
            <RecordkeepingStat label="Fatalities" value={m.totalDeaths} critical />
          </div>
        </div>

        <div className="ops-surface animate-panel-in rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/15 dark:text-brand-yellow"><HeartPulse className="h-4 w-4" /></span>
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">This week vs last</h3>
            <Link href="/incidents" className="ml-auto text-[11px] font-bold text-brand-navy hover:underline dark:text-brand-yellow">Incidents &rarr;</Link>
          </div>
          <div className="space-y-3">
            <WowRow label="Recordable injuries" current={m.weekOverWeek.recordables.current} previous={m.weekOverWeek.recordables.previous} higherIsBetter={false} />
            <WowRow label="Near-miss reports" current={m.weekOverWeek.nearMiss.current} previous={m.weekOverWeek.nearMiss.previous} higherIsBetter={true} />
            <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Near-miss-to-recordable ratio:&nbsp;
              <span className="font-bold text-slate-700 dark:text-slate-200">{m.nearMissToRecordableRatio === null ? '—' : `${m.nearMissToRecordableRatio.toFixed(1)} : 1`}</span>
              &nbsp;· higher = stronger reporting culture
            </p>
          </div>
        </div>
      </div>

      <ChartCard title="Recordable & near-miss trend" subtitle="Monthly counts across the trailing 12 months." loading={false} empty={monthly.every(d => d.recordables === 0 && d.nearMiss === 0)} href="/incidents">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthly} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ee" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthShort} stroke="#64748b" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
            <Tooltip wrapperStyle={{ fontSize: 11 }} labelFormatter={(label) => monthShort(String(label))} cursor={{ fill: 'rgba(27, 58, 107, 0.08)' }} />
            <Bar dataKey="nearMiss" name="Near-miss" fill="#059669" radius={[4, 4, 0, 0]} animationDuration={600} />
            <Bar dataKey="recordables" name="Recordable" fill="#BE123C" radius={[4, 4, 0, 0]} animationDuration={600} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard title="Where people are getting hurt" subtitle="Injuries by body part — top reported." loading={false} empty={bodyParts.length === 0} href="/incidents">
          <ResponsiveContainer width="100%" height={Math.max(160, bodyParts.length * 34)}>
            <BarChart data={bodyParts} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ee" horizontal={false} />
              <XAxis type="number" allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={132} stroke="#64748b" tick={{ fontSize: 11 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }} />
              <Bar dataKey="count" name="Injuries" fill="#1B3A6B" radius={[0, 4, 4, 0]} animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="How people are getting hurt" subtitle="Injuries by nature — top reported." loading={false} empty={injuryNatures.length === 0} href="/incidents">
          <ResponsiveContainer width="100%" height={Math.max(160, injuryNatures.length * 34)}>
            <BarChart data={injuryNatures} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ee" horizontal={false} />
              <XAxis type="number" allowDecimals={false} stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={132} stroke="#64748b" tick={{ fontSize: 11 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }} />
              <Bar dataKey="count" name="Injuries" fill="#0F766E" radius={[0, 4, 4, 0]} animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="When incidents happen" subtitle="Incident count by shift and weekday." loading={false} empty={m.shiftDayHeatmap.every(b => b.count === 0)} href="/incidents">
        <ShiftHeatmapGrid buckets={m.shiftDayHeatmap} />
      </ChartCard>
    </section>
  )
}

const HEATMAP_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const HEATMAP_SHIFTS = ['day', 'swing', 'night', 'unknown'] as const
const HEATMAP_SHIFT_LABEL: Record<typeof HEATMAP_SHIFTS[number], string> = {
  day: 'Day', swing: 'Swing', night: 'Night', unknown: 'Unknown',
}

// Day-of-week × shift heatmap. The summarizer pre-fills all 28 cells, so
// the grid always renders complete; intensity scales each cell's alpha
// against the busiest cell.
function ShiftHeatmapGrid({ buckets }: { buckets: IncidentScorecardMetrics['shiftDayHeatmap'] }) {
  const countByKey = new Map<string, number>()
  for (const b of buckets) countByKey.set(`${b.shift}|${b.weekday}`, b.count)
  const max = buckets.reduce((acc, b) => Math.max(acc, b.count), 0)
  return (
    <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] gap-1">
      <div />
      {HEATMAP_WEEKDAYS.map(d => (
        <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{d}</div>
      ))}
      {HEATMAP_SHIFTS.map(shift => (
        <div key={shift} className="contents">
          <div className="self-center text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{HEATMAP_SHIFT_LABEL[shift]}</div>
          {HEATMAP_WEEKDAYS.map((weekdayLabel, weekday) => {
            const count = countByKey.get(`${shift}|${weekday}`) ?? 0
            const intensity = max ? Math.min(1, count / max) : 0
            const background = count === 0
              ? 'rgba(148, 163, 184, 0.15)'
              : `rgba(190, 18, 60, ${0.15 + intensity * 0.7})`
            return (
              <div
                key={shift + weekday}
                title={count > 0 ? `${HEATMAP_SHIFT_LABEL[shift]} · ${weekdayLabel}: ${count} incident${count === 1 ? '' : 's'}` : `${HEATMAP_SHIFT_LABEL[shift]} · ${weekdayLabel}: no incidents`}
                className="flex aspect-square items-center justify-center rounded text-[10px] font-mono tabular-nums text-slate-700 dark:text-slate-200"
                style={{ backgroundColor: background }}
              >
                {count > 0 ? count : ''}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function IncidentStatCard({ icon: Icon, label, value, sub, accent, href }: {
  icon: LucideIcon; label: string; value: string; sub: string; accent: Tone; href: string
}) {
  const style = TONE_STYLES[accent]
  return (
    <Link href={href} className={`ops-surface-interactive ops-surface animate-panel-in block rounded-lg p-4 outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/40 dark:focus-visible:ring-brand-yellow/40 ${style.border}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-black uppercase leading-tight text-slate-500 dark:text-slate-400">{label}</p>
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${style.soft}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className={`mt-2 text-3xl font-black tabular-nums leading-none ${style.text}`}>{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{sub}</p>
    </Link>
  )
}

function RecordkeepingStat({ label, value, critical = false }: { label: string; value: number; critical?: boolean }) {
  const color = critical && value > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100'
  return (
    <div>
      <p className={`text-2xl font-black tabular-nums leading-none ${color}`}>{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}

function WowRow({ label, current, previous, higherIsBetter }: {
  label: string; current: number; previous: number; higherIsBetter: boolean
}) {
  const delta = current - previous
  const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const good = dir === 'flat' ? null : (dir === 'up' ? higherIsBetter : !higherIsBetter)
  const color = good === null ? 'text-slate-400'
    : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '—'
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-lg font-black tabular-nums text-slate-900 dark:text-slate-100">{current}</span>
        <span className="text-[11px] text-slate-400">was {previous}</span>
        <span className={`text-xs font-bold ${color}`}>{dir === 'flat' ? '—' : `${arrow} ${Math.abs(delta)}`}</span>
      </span>
    </div>
  )
}

function mergeMonthly(
  rec: ReadonlyArray<{ month: string; count: number }>,
  nm: ReadonlyArray<{ month: string; count: number }>,
): Array<{ month: string; recordables: number; nearMiss: number }> {
  const map = new Map<string, { month: string; recordables: number; nearMiss: number }>()
  for (const b of rec) map.set(b.month, { month: b.month, recordables: b.count, nearMiss: 0 })
  for (const b of nm) {
    const e = map.get(b.month) ?? { month: b.month, recordables: 0, nearMiss: 0 }
    e.nearMiss = b.count
    map.set(b.month, e)
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

function monthShort(ym: string): string {
  const [y, mo] = ym.split('-').map(Number)
  if (!y || !mo) return ym
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: 'short' })
}

function humanizeBodyPart(slug: string): string {
  const parts = slug.split(/[_\s]+/).filter(Boolean)
  if (parts.length === 0) return slug
  const side = parts[parts.length - 1]
  if (side === 'left' || side === 'right') {
    return `${parts.slice(0, -1).map(capitalize).join(' ')} (${side})`
  }
  return parts.map(capitalize).join(' ')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function fmtRate(v: number | null): string {
  return v === null ? '—' : v.toFixed(2)
}

function fmtPct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}%`
}

// Percentage indicators where higher is better (CAPA on-time, RCA
// completion). Null (no data) stays neutral rather than alarming.
function pctTone(v: number | null): Tone {
  if (v === null) return 'neutral'
  if (v >= 90) return 'safe'
  if (v >= 70) return 'watch'
  return 'critical'
}

// Nature of injury is free text; render it in sentence case for the chart.
function humanizeNature(nature: string): string {
  return nature.charAt(0).toUpperCase() + nature.slice(1)
}

// ── Year-over-year history (from saved OSHA 300A annual summaries) ──────────

interface AnnualSummaryRow {
  year:              number
  total_hours_worked: number | null
  totals_json: {
    total_deaths?:           number
    total_days_away?:        number
    total_restricted?:       number
    total_other_recordable?: number
  } | null
}

export interface YearMetric {
  year:        number
  recordables: number
  trir:        number | null
  dart:        number | null
}

const OSHA_RATE = 200_000

// Blend imported prior-year summaries with the live current calendar year
// (from the trailing-12-month incident metrics) into one sorted YoY series.
function buildYearOverYear(history: YearMetric[] | null, live: IncidentScorecardMetrics): YearMetric[] {
  const currentYear = new Date(live.nowMs).getUTCFullYear()
  const past = (history ?? []).filter(h => h.year < currentYear)
  const liveYear: YearMetric = {
    year:        currentYear,
    recordables: live.totalRecordable,
    trir:        live.trir,
    dart:        live.dart,
  }
  return [...past, liveYear].sort((a, b) => a.year - b.year)
}

// Roll establishment-year rows up to one row per year for the tenant, then
// derive TRIR/DART. A year with no logged hours yields null rates (renders "—").
function aggregateAnnualHistory(rows: AnnualSummaryRow[]): YearMetric[] {
  const byYear = new Map<number, { recordable: number; dartCases: number; hours: number }>()
  for (const r of rows) {
    const t = r.totals_json ?? {}
    const recordable = (t.total_deaths ?? 0) + (t.total_days_away ?? 0) + (t.total_restricted ?? 0) + (t.total_other_recordable ?? 0)
    const dartCases  = (t.total_deaths ?? 0) + (t.total_days_away ?? 0) + (t.total_restricted ?? 0)
    const e = byYear.get(r.year) ?? { recordable: 0, dartCases: 0, hours: 0 }
    e.recordable += recordable
    e.dartCases  += dartCases
    e.hours      += r.total_hours_worked ?? 0
    byYear.set(r.year, e)
  }
  return [...byYear.entries()]
    .map(([year, e]) => ({
      year,
      recordables: e.recordable,
      trir: e.hours ? (e.recordable * OSHA_RATE) / e.hours : null,
      dart: e.hours ? (e.dartCases * OSHA_RATE) / e.hours : null,
    }))
    .sort((a, b) => a.year - b.year)
}
