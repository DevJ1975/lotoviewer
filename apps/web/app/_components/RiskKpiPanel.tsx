'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Loader2, ShieldAlert } from 'lucide-react'
import { fetchRiskMetrics, type RiskMetrics } from '@/lib/riskMetrics'
import { RiskBandPill } from '@/components/ui/RiskBandPill'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@/lib/moduleVisibility'

// Risk Assessment intelligence panel for the home dashboard.
//
// Conditionally rendered: only mounts when the active tenant has
// risk-assessment visible (per moduleVisibility resolver). Tenants
// without the module never see this section, regardless of whether
// risks exist in their DB.
//
// Three KPI tiles + a "top risks" mini-list. Each tile links to a
// pre-filtered /risk/list view so the user can jump straight from
// "you have N overdue reviews" to the list showing them.

const REFRESH_MS = 5 * 60 * 1000   // 5-minute background refresh

export default function RiskKpiPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(
    () => isModuleVisible('risk-assessment', tenant?.modules),
    [tenant?.modules],
  )

  const [metrics, setMetrics] = useState<RiskMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const m = await fetchRiskMetrics()
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

  // Hide the entire panel when the tenant doesn't have the module
  // — keeps the dashboard quiet for single-module tenants.
  if (tenantLoading || !visible) return null

  // Hide on first-load error too. The panel is purely informational;
  // a transient query failure shouldn't break the dashboard for the
  // user. Sentry already captured it from the helper.
  if (error && !metrics) return null

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Risk Assessment · ISO 45001 6.1
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Risk intelligence
          </h2>
        </div>
        <Link
          href="/risk"
          className="text-xs font-semibold text-brand-navy hover:underline inline-flex items-center gap-1"
        >
          Heat map <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      {loading && metrics === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : metrics === null ? (
        <p className="text-xs italic text-slate-400 py-2">No risks yet for this tenant.</p>
      ) : (
        <Inner metrics={metrics} />
      )}
    </section>
  )
}

function Inner({ metrics }: { metrics: RiskMetrics }) {
  const { byEffectiveBand, totalActive, overdueReviewCount, highOrExtremeWithoutPlan, topResidualRisks } = metrics
  const highCount = byEffectiveBand.high + byEffectiveBand.extreme

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile
          label="Active risks"
          value={totalActive}
          href="/risk/list"
        />
        <KpiTile
          label="High + Extreme"
          value={highCount}
          tone={highCount > 0 ? 'warn' : 'neutral'}
          icon={<ShieldAlert className="h-3.5 w-3.5" />}
          href="/risk/list?band=high"
        />
        <KpiTile
          label="Needs controls"
          value={highOrExtremeWithoutPlan}
          subtitle="High/Extreme open"
          tone={highOrExtremeWithoutPlan > 0 ? 'alert' : 'neutral'}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          href="/risk/list?status=open&band=high"
        />
        <KpiTile
          label="Overdue reviews"
          value={overdueReviewCount}
          tone={overdueReviewCount > 0 ? 'warn' : 'neutral'}
          href="/risk/list?sort=next_review_date&dir=asc"
        />
      </div>

      {topResidualRisks.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
            Top risks by residual score
          </div>
          <ul className="space-y-1">
            {topResidualRisks.map(r => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 w-28 shrink-0">
                  {r.risk_number}
                </span>
                <Link
                  href={`/risk/${r.id}`}
                  className="flex-1 truncate text-slate-800 dark:text-slate-200 hover:underline"
                  title={r.title}
                >
                  {r.title}
                </Link>
                <RiskBandPill
                  band={r.effective_band}
                  score={r.effective_score}
                  compact
                />
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
