'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2, ShieldCheck, ShieldAlert, TrendingUp, Activity } from 'lucide-react'
import {
  fetchIncidentScorecardMetrics,
  type IncidentScorecardMetrics,
} from '@soteria/core/incidentScorecardMetrics'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { InfographicMetricCard } from './InfographicMetricCard'

// Incident-program intelligence panel for the home Control Center.
// Same posture as NearMissKpiPanel: gated by isModuleVisible('incidents'),
// auto-refreshes on a 5-minute cadence, mounts only when the active
// tenant has the module turned on.
//
// Six tiles + a "days since last recordable" champion strip + the
// near-miss-to-recordable ratio (a leading indicator the EHS director
// wants high — not low — so we annotate with a target hint).

const REFRESH_MS = 5 * 60 * 1000

export default function IncidentKpiPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(
    () => isModuleVisible('incidents', tenant?.modules),
    [tenant?.modules],
  )

  const [metrics, setMetrics] = useState<IncidentScorecardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const m = await fetchIncidentScorecardMetrics(365)
      setMetrics(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tenantLoading || !visible) return
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [tenantLoading, visible, load])

  if (tenantLoading || !visible) return null
  if (error && !metrics) return null

  const total = metrics
    ? metrics.totalRecordable + metrics.totalNearMiss + metrics.openCareCases
    : 0

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Incident program · OSHA 1904 / ISO 45001
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Incident scorecard <span className="text-xs font-normal text-slate-500">· last 12 months</span>
          </h2>
        </div>
        <Link
          href="/incidents/scorecard"
          className="text-xs font-semibold text-brand-navy hover:underline inline-flex items-center gap-1"
        >
          Full scorecard <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      {loading && metrics === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : metrics === null || total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          <p className="text-xs italic text-slate-400">
            No incidents in the last 12 months. File one to start tracking trends.
          </p>
          <Link href="/incidents/new" className="mt-2 inline-block text-xs font-medium text-brand-navy hover:underline">
            Report an incident →
          </Link>
        </div>
      ) : (
        <Inner metrics={metrics} />
      )}
    </section>
  )
}

function Inner({ metrics }: { metrics: IncidentScorecardMetrics }) {
  const m = metrics
  const dsr = m.daysSinceLastRecordable
  return (
    <>
      <InfographicMetricCard
        label="Days since last recordable"
        value={dsr < 0 ? '—' : dsr}
        caption={dsr < 0 ? 'No recordable history yet' : dsr === 1 ? '1 day recordable-free' : `${dsr} days recordable-free`}
        tone={dsr < 0 ? 'neutral' : dsr >= 90 ? 'safe' : dsr >= 30 ? 'warning' : 'critical'}
        icon={dsr >= 30 ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        percent={dsr < 0 ? 0 : Math.min(100, (dsr / 90) * 100)}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile label="TRIR"          value={fmt(m.trir)}          help="per 100 FTE" />
        <KpiTile label="DART"          value={fmt(m.dart)}          help="per 100 FTE" />
        <KpiTile label="LTIR"          value={fmt(m.ltir)}          help="lost-time only" />
        <KpiTile label="Severity rate" value={fmt(m.severityRate)}  help="days × 200K / hrs" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile label="Near-miss : recordable"
                 value={m.nearMissToRecordableRatio == null ? '—' : m.nearMissToRecordableRatio.toFixed(1)}
                 help="↑ better"
                 highlight={m.nearMissToRecordableRatio != null && m.nearMissToRecordableRatio >= 10} />
        <KpiTile label="CAPA on time"
                 value={m.actionClosureOnTimePct == null ? '—' : `${m.actionClosureOnTimePct.toFixed(0)}%`}
                 help="closed on or before due"
                 highlight={m.actionClosureOnTimePct != null && m.actionClosureOnTimePct >= 90} />
        <KpiTile label="RCA completion"
                 value={m.rcaCompletionPct == null ? '—' : `${m.rcaCompletionPct.toFixed(0)}%`}
                 help="recordables w/ RCA closed"
                 highlight={m.rcaCompletionPct != null && m.rcaCompletionPct >= 90} />
        <KpiTile label="Open care cases"
                 value={String(m.openCareCases)}
                 help="modified-duty + open" />
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          {m.totalRecordable} recordable · {m.totalNearMiss} near miss · {m.totalDeaths} fatalit{m.totalDeaths === 1 ? 'y' : 'ies'}
        </div>
        <Link
          href="/incidents"
          className="text-[11px] font-semibold text-brand-navy hover:underline inline-flex items-center gap-1"
        >
          All incidents <TrendingUp className="h-3 w-3" />
        </Link>
      </div>
    </>
  )
}

function fmt(v: number | null): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

function KpiTile({ label, value, help, highlight }: {
  label: string; value: string; help?: string; highlight?: boolean
}) {
  return (
    <InfographicMetricCard
      label={label}
      value={value}
      caption={help}
      tone={highlight ? 'safe' : 'neutral'}
      percent={percentFromValue(value)}
      compact
    />
  )
}

function percentFromValue(value: string): number {
  if (value === '—') return 0
  if (value.endsWith('%')) return Math.max(0, Math.min(100, Number(value.slice(0, -1))))
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, numeric * 10))
}
