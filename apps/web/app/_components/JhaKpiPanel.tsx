'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ClipboardCheck, Clock, ShieldAlert } from 'lucide-react'
import { fetchJhaMetrics, type JhaMetrics } from '@soteria/core/jhaMetrics'
import { DashboardPanel, PanelEyebrow, PanelLink } from '@/components/DashboardPanel'
import OpsSpinner from '@/components/OpsSpinner'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { SEVERITY_TW } from '@soteria/core/severityColors'
import { InfographicMetricCard, type InfographicTone } from './InfographicMetricCard'

// JHA intelligence panel for the Control Center home dashboard.
// Same gating + render pattern as RiskKpiPanel + NearMissKpiPanel.

const REFRESH_MS = 5 * 60 * 1000

export default function JhaKpiPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(
    () => isModuleVisible('jha', tenant?.modules),
    [tenant?.modules],
  )

  const [metrics, setMetrics] = useState<JhaMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const m = await fetchJhaMetrics()
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
    <DashboardPanel
      eyebrow="Job Hazard Analysis · ISO 45001 6.1.2.2"
      title="JHA intelligence"
      action={<PanelLink href="/jha">All JHAs</PanelLink>}
    >
      {loading && metrics === null ? (
        <div className="flex items-center justify-center py-6">
          <OpsSpinner size="sm" label={null} />
        </div>
      ) : metrics === null || metrics.totalAll === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          <p className="text-xs italic text-slate-400">No JHAs yet for this tenant.</p>
          <Link href="/jha/new" className="mt-2 inline-block text-xs font-medium text-brand-navy hover:underline">
            Create the first one →
          </Link>
        </div>
      ) : (
        <Inner metrics={metrics} />
      )}
    </DashboardPanel>
  )
}

function Inner({ metrics }: { metrics: JhaMetrics }) {
  const { totalActive, awaitingApproval, overdueReview, highOrExtremeHazards, ppeAloneWarnings, topByWorstCase } = metrics

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile
          label="Active JHAs"
          value={totalActive}
          href="/jha"
        />
        <KpiTile
          label="Awaiting approval"
          value={awaitingApproval}
          tone={awaitingApproval > 0 ? 'warn' : 'neutral'}
          icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          href="/jha?status=in_review"
        />
        <KpiTile
          label="Overdue review"
          value={overdueReview}
          tone={overdueReview > 0 ? 'alert' : 'neutral'}
          icon={<Clock className="h-3.5 w-3.5" />}
          href="/jha?status=approved"
        />
        <KpiTile
          label="High/Extreme hazards"
          value={highOrExtremeHazards}
          subtitle={ppeAloneWarnings > 0 ? `${ppeAloneWarnings} PPE-alone` : 'across active JHAs'}
          tone={ppeAloneWarnings > 0 ? 'alert' : highOrExtremeHazards > 0 ? 'warn' : 'neutral'}
          icon={<ShieldAlert className="h-3.5 w-3.5" />}
          href="/jha"
        />
      </div>

      {topByWorstCase.length > 0 && (
        <div>
          <PanelEyebrow className="mb-2">Top by worst-case severity</PanelEyebrow>
          <ul className="space-y-1">
            {topByWorstCase.map(r => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 w-28 shrink-0">
                  {r.job_number}
                </span>
                <Link
                  href={`/jha/${r.id}`}
                  className="flex-1 truncate text-slate-800 dark:text-slate-200 hover:underline"
                  title={r.title}
                >
                  {r.title}
                </Link>
                {r.worst_case ? (
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_TW[r.worst_case]}`}>
                    {r.worst_case}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-slate-400 italic">no hazards</span>
                )}
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
  icon?:    ReactNode
  href?:    string
}

function KpiTile({ label, value, subtitle, tone = 'neutral', icon, href }: TileProps) {
  return (
    <InfographicMetricCard
      label={label}
      value={value}
      caption={subtitle}
      href={href}
      tone={tileTone(tone)}
      icon={icon}
      percent={Math.min(100, value * 12.5)}
      compact
    />
  )
}

function tileTone(tone: TileProps['tone']): InfographicTone {
  if (tone === 'alert') return 'critical'
  if (tone === 'warn') return 'warning'
  return 'neutral'
}
