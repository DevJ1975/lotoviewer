'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import {
  fetchIncidentScorecardMetrics,
  type IncidentScorecardMetrics,
} from '@soteria/core/incidentScorecardMetrics'
import { HIERARCHY_LABEL, HIERARCHY_OF_CONTROLS } from '@soteria/core/incidentAction'
import { SEVERITY_ACTUAL_LABEL } from '@soteria/core/incident'
import IncidentSeverityHeatmap from '@/app/_components/IncidentSeverityHeatmap'

// /incidents/scorecard — full EHS scorecard view.
//
// Three sections: lagging-rate KPIs across the top, leading + care +
// investigation-quality KPIs in the middle, and trend / breakdown
// charts (recordables-by-month bar, severity distribution, hierarchy-
// of-controls mix, body-part + shift heatmaps) at the bottom.

const WINDOW_OPTIONS = [
  { label: '30 days',  days: 30  },
  { label: '90 days',  days: 90  },
  { label: '12 months', days: 365 },
] as const

export default function ScorecardPage() {
  const { tenant } = useTenant()
  const [windowDays, setWindowDays] = useState<number>(365)
  const [metrics, setMetrics] = useState<IncidentScorecardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const m = await fetchIncidentScorecardMetrics(windowDays)
      setMetrics(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [windowDays])

  useEffect(() => {
    if (!tenant?.id) return
    void load()
  }, [tenant?.id, load])

  const monthMax = useMemo(() => {
    if (!metrics) return 0
    return metrics.recordablesByMonth.reduce((m, b) => Math.max(m, b.count), 0)
  }, [metrics])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incidents
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Incident scorecard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Lagging + leading + care + investigation-quality indicators.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden">
          {WINDOW_OPTIONS.map(opt => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setWindowDays(opt.days)}
              className={
                'px-3 py-1.5 text-xs font-semibold ' +
                (windowDays === opt.days
                  ? 'bg-brand-navy text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && metrics === null && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {metrics && <ScorecardBody m={metrics} monthMax={monthMax} />}
    </div>
  )
}

function ScorecardBody({ m, monthMax }: { m: IncidentScorecardMetrics; monthMax: number }) {
  return (
    <>
      <DaysSinceBanner days={m.daysSinceLastRecordable} />

      <Section title="Lagging indicators · OSHA rates">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="TRIR"           value={fmt(m.trir)}          help="per 100 FTE" />
          <Kpi label="DART"           value={fmt(m.dart)}          help="per 100 FTE" />
          <Kpi label="LTIR"           value={fmt(m.ltir)}          help="lost-time only" />
          <Kpi label="Severity rate"  value={fmt(m.severityRate)}  help="days × 200K / hrs" />
          <Kpi label="Recordables"    value={String(m.totalRecordable)} />
          <Kpi label="Days-away cases" value={String(m.totalDaysAwayCases)} />
          <Kpi label="Restricted"     value={String(m.totalRestrictedCases)} />
          <Kpi label="Hours worked"   value={m.hoursWorked.toLocaleString()} help="annual basis" />
        </div>
      </Section>

      <Section title="Leading indicators">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Near misses"
               value={String(m.totalNearMiss)}
               help="leading signal" />
          <Kpi label="Near-miss : recordable"
               value={m.nearMissToRecordableRatio == null ? '—' : m.nearMissToRecordableRatio.toFixed(1)}
               help="↑ better" />
          <Kpi label="CAPA on time"
               value={m.actionClosureOnTimePct == null ? '—' : `${m.actionClosureOnTimePct.toFixed(0)}%`}
               help="closed on or before due" />
          <Kpi label="RCA completion"
               value={m.rcaCompletionPct == null ? '—' : `${m.rcaCompletionPct.toFixed(0)}%`}
               help={`${m.recordablesWithCompletedRca} of ${m.totalRecordable}`} />
        </div>
      </Section>

      <Section title="Care management">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Open cases"        value={String(m.openCareCases)} />
          <Kpi label="Modified-duty"     value={String(m.modifiedDutyCases)} />
          <Kpi label="Closed (window)"   value={String(m.closedCareCases)} />
          <Kpi label="Avg days to RTW"
               value={m.meanDaysToRtw == null ? '—' : m.meanDaysToRtw.toFixed(1)} />
        </div>
      </Section>

      <Section title="Investigation quality">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="RCA completion %" value={m.rcaCompletionPct == null ? '—' : `${m.rcaCompletionPct.toFixed(0)}%`} />
          <Kpi label="Time to close"
               value={m.meanTimeToCloseDays == null ? '—' : `${m.meanTimeToCloseDays.toFixed(1)} d`} />
        </div>
      </Section>

      <Section title="Recordables by month">
        <MonthlyBars buckets={m.recordablesByMonth} max={monthMax} />
      </Section>

      <Section title="Severity distribution (all incidents)">
        <SeverityBars breakdown={m.severityActualBreakdown} />
      </Section>

      <Section title="CAPA hierarchy of controls (closed actions)">
        <HierarchyMix mix={m.hierarchyOfControlsMix} />
      </Section>

      <Section title="Heatmaps">
        <IncidentSeverityHeatmap
          bodyParts={m.bodyPartHeatmap}
          shiftDay={m.shiftDayHeatmap}
        />
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────

function DaysSinceBanner({ days }: { days: number }) {
  const tone = days < 0
    ? 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50'
    : days >= 90
      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
      : days >= 30
        ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30'
        : 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30'
  return (
    <div className={`rounded-xl border p-4 flex items-center gap-3 ${tone}`}>
      {days >= 30
        ? <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0" />
        : <ShieldAlert className="h-6 w-6 text-rose-600 shrink-0" />}
      <div className="flex-1">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Days since last recordable</p>
        <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
          {days < 0 ? '—' : days}
          {days >= 0 && <span className="ml-2 text-base font-normal text-slate-500">{days === 1 ? 'day' : 'days'}</span>}
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

function Kpi({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      {help && <p className="text-[10px] text-slate-400">{help}</p>}
    </div>
  )
}

function fmt(v: number | null): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

// ──────────────────────────────────────────────────────────────────────────

function MonthlyBars({ buckets, max }: { buckets: ReadonlyArray<{ month: string; count: number }>; max: number }) {
  if (buckets.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No data in window.</p>
  }
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-end gap-1 h-32">
        {buckets.map(b => {
          const h = max ? (b.count / max) * 100 : 0
          return (
            <div key={b.month} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1">
              <div
                className="w-full rounded-t bg-rose-500 dark:bg-rose-700"
                style={{ height: `${Math.max(h, b.count > 0 ? 4 : 0)}%` }}
                title={`${b.month}: ${b.count} recordable${b.count === 1 ? '' : 's'}`}
              />
              <span className="text-[9px] text-slate-500 dark:text-slate-400 truncate w-full text-center">
                {b.month.slice(5)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SeverityBars({ breakdown }: { breakdown: IncidentScorecardMetrics['severityActualBreakdown'] }) {
  const order: Array<keyof IncidentScorecardMetrics['severityActualBreakdown']> =
    ['catastrophic', 'fatality', 'lost_time', 'medical', 'first_aid', 'none']
  const max = Math.max(1, ...order.map(k => breakdown[k]))
  const colours: Record<string, string> = {
    catastrophic: 'bg-rose-700',
    fatality:     'bg-rose-600',
    lost_time:    'bg-orange-500',
    medical:      'bg-amber-400',
    first_aid:    'bg-yellow-100',
    none:         'bg-slate-300',
  }
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
      {order.map(k => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-32 text-[11px] text-slate-700 dark:text-slate-300">{SEVERITY_ACTUAL_LABEL[k]}</span>
          <div className="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className={`h-3 ${colours[k]}`} style={{ width: `${(breakdown[k] / max) * 100}%` }} />
          </div>
          <span className="w-6 text-right text-[11px] font-mono text-slate-600 dark:text-slate-300">{breakdown[k]}</span>
        </div>
      ))}
    </div>
  )
}

function HierarchyMix({ mix }: { mix: IncidentScorecardMetrics['hierarchyOfControlsMix'] }) {
  const total = mix.reduce((s, b) => s + b.count, 0)
  if (total === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">No closed CAPAs in this window yet.</p>
      </div>
    )
  }
  const order: Array<typeof HIERARCHY_OF_CONTROLS[number] | 'unset'> = [
    ...HIERARCHY_OF_CONTROLS, 'unset',
  ]
  const labels: Record<string, string> = {
    ...HIERARCHY_LABEL,
    unset: '(no level set)',
  }
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
      {order.map(level => {
        const bucket = mix.find(b => b.level === level)
        const count = bucket?.count ?? 0
        const pct = total ? (count / total) * 100 : 0
        // Strong controls (top of hierarchy) green; weak controls amber/rose.
        const colour =
          level === 'elimination' || level === 'substitution' ? 'bg-emerald-500'
          : level === 'engineering'                            ? 'bg-emerald-300'
          : level === 'administrative'                          ? 'bg-amber-400'
          : level === 'ppe'                                     ? 'bg-rose-400'
          : 'bg-slate-300'
        return (
          <div key={level} className="flex items-center gap-2">
            <span className="w-40 text-[11px] text-slate-700 dark:text-slate-300">{labels[level]}</span>
            <div className="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className={`h-3 ${colour}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-12 text-right text-[11px] font-mono text-slate-600 dark:text-slate-300">
              {count} <span className="text-slate-400">({pct.toFixed(0)}%)</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
