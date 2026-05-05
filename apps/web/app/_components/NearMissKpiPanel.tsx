'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Clock, Loader2, TrendingUp } from 'lucide-react'
import { fetchNearMissMetrics, type NearMissMetrics } from '@soteria/core/nearMissMetrics'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { SEVERITY_TW } from '@soteria/core/severityColors'

// Near-Miss intelligence panel for the Control Center home dashboard.
// Same pattern as RiskKpiPanel: gated by isModuleVisible, mounts only
// when the active tenant has the module turned on.
//
// Three KPI tiles plus a "top 5 unresolved" mini-list. Each tile
// links into the /near-miss list view so the user can drill down.

const REFRESH_MS = 5 * 60 * 1000

export default function NearMissKpiPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(
    () => isModuleVisible('near-miss', tenant?.modules),
    [tenant?.modules],
  )

  const [metrics, setMetrics] = useState<NearMissMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const m = await fetchNearMissMetrics()
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

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Near-Miss Reporting · ISO 45001 9.1
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Near-miss intelligence
          </h2>
        </div>
        <Link
          href="/near-miss"
          className="text-xs font-semibold text-brand-navy hover:underline inline-flex items-center gap-1"
        >
          All reports <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      {loading && metrics === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : metrics === null || metrics.totalAll === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          <p className="text-xs italic text-slate-400">No near-miss reports filed yet.</p>
          <Link href="/near-miss/new" className="mt-2 inline-block text-xs font-medium text-brand-navy hover:underline">
            File the first one →
          </Link>
        </div>
      ) : (
        <Inner metrics={metrics} />
      )}
    </section>
  )
}

function Inner({ metrics }: { metrics: NearMissMetrics }) {
  const { totalActive, bySeverity, newLast30Days, agingActive, topUnresolved } = metrics
  const highCount = bySeverity.high + bySeverity.extreme

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile
          label="Active reports"
          value={totalActive}
          href="/near-miss"
        />
        <KpiTile
          label="High + Extreme"
          value={highCount}
          tone={highCount > 0 ? 'warn' : 'neutral'}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          href="/near-miss"
        />
        <KpiTile
          label="New (30 d)"
          value={newLast30Days}
          subtitle="trend signal"
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          href="/near-miss"
        />
        <KpiTile
          label="Stuck in triage"
          value={agingActive}
          subtitle=">30 d open"
          tone={agingActive > 0 ? 'alert' : 'neutral'}
          icon={<Clock className="h-3.5 w-3.5" />}
          href="/near-miss"
        />
      </div>

      {topUnresolved.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
            Top unresolved
          </div>
          <ul className="space-y-1">
            {topUnresolved.map(r => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 w-28 shrink-0">
                  {r.report_number}
                </span>
                <Link
                  href={`/near-miss/${r.id}`}
                  className="flex-1 truncate text-slate-800 dark:text-slate-200 hover:underline"
                  title={r.description}
                >
                  {r.description}
                </Link>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_TW[r.severity_potential]}`}>
                  {r.severity_potential}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

interface TileProps {
  label:    string
  value:    number
  subtitle?: string
  tone?:    'neutral' | 'warn' | 'alert'
  icon?:    React.ReactNode
  href?:    string
}

function KpiTile({ label, value, subtitle, tone = 'neutral', icon, href }: TileProps) {
  const toneClass =
    tone === 'alert' ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20' :
    tone === 'warn'  ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20' :
                       'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'

  const valueClass =
    tone === 'alert' ? 'text-rose-700 dark:text-rose-300' :
    tone === 'warn'  ? 'text-amber-700 dark:text-amber-400' :
                       'text-slate-900 dark:text-slate-100'

  const inner = (
    <div className={`rounded-xl border p-3 ${toneClass} transition-colors hover:shadow-sm`}>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</div>
      {subtitle && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
