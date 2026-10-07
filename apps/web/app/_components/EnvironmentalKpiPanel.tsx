'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ClipboardCheck, FileWarning, Scale } from 'lucide-react'
import { DashboardPanel, PanelLink } from '@/components/DashboardPanel'
import OpsSpinner from '@/components/OpsSpinner'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { needsAttention } from '@soteria/core/environmental/metrics'
import { fetchEnvironmentalKpis, type EnvironmentalPanelData } from '@/lib/environmental/kpiFetch'
import { InfographicMetricCard, type InfographicTone } from './InfographicMetricCard'

// Environmental compliance on the Control Center. Same self-gating pattern as the
// other module panels: it mounts only when the tenant has the module, and stays out
// of the way (renders nothing) when its numbers cannot be read.

const REFRESH_MS = 5 * 60 * 1000

export default function EnvironmentalKpiPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(() => isModuleVisible('environmental', tenant?.modules), [tenant?.modules])
  const [data, setData] = useState<EnvironmentalPanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try { setData(await fetchEnvironmentalKpis()); setFailed(false) }
    catch { setFailed(true) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (tenantLoading || !visible) return
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [tenantLoading, visible, load])

  if (tenantLoading || !visible) return null
  if (failed && !data) return null

  return (
    <DashboardPanel
      eyebrow="Environmental compliance · ISO 14001 6.1.3 · 9.1.2"
      title="Environmental compliance"
      action={<PanelLink href="/environmental/compliance">Open</PanelLink>}
    >
      {loading && data === null ? (
        <div className="flex items-center justify-center py-6"><OpsSpinner size="sm" label={null} /></div>
      ) : data === null || !data.hasData ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center dark:border-slate-700">
          <p className="text-xs italic text-slate-400">No environmental compliance records yet.</p>
          <Link href="/environmental/compliance" className="mt-2 inline-block text-xs font-medium text-brand-navy hover:underline">
            Set up your sites →
          </Link>
        </div>
      ) : (
        <Tiles data={data} />
      )}
    </DashboardPanel>
  )
}

function tone(count: number, level: 'warning' | 'critical'): InfographicTone {
  return count > 0 ? level : 'safe'
}

function Tiles({ data }: { data: EnvironmentalPanelData }) {
  const { kpis, legalNonCompliant } = data
  const permitTrouble = kpis.permitsExpired + kpis.permitsExpiring
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <InfographicMetricCard
          compact label="Overdue deadlines" value={kpis.obligationsOverdue} caption={`${kpis.obligationsDueSoon} due soon`}
          href="/environmental/compliance/calendar" tone={tone(kpis.obligationsOverdue, 'critical')} icon={<CalendarClock className="h-3.5 w-3.5" />}
          percent={Math.min(100, kpis.obligationsOverdue * 20)}
        />
        <InfographicMetricCard
          compact label="Permits to renew" value={permitTrouble} caption={kpis.permitsExpired > 0 ? `${kpis.permitsExpired} expired` : 'in the renewal window'}
          href="/environmental/compliance/permits" tone={tone(kpis.permitsExpired, 'critical') === 'critical' ? 'critical' : tone(kpis.permitsExpiring, 'warning')} icon={<FileWarning className="h-3.5 w-3.5" />}
          percent={Math.min(100, permitTrouble * 25)}
        />
        <InfographicMetricCard
          compact label="Non-compliant" value={legalNonCompliant} caption={`${kpis.legalReviewsOverdue} reviews overdue`}
          href="/environmental/compliance/legal" tone={tone(legalNonCompliant, 'critical')} icon={<Scale className="h-3.5 w-3.5" />}
          percent={Math.min(100, legalNonCompliant * 25)}
        />
        <InfographicMetricCard
          compact label="Open findings" value={kpis.openFindings} caption="from checklists"
          href="/environmental/nonconformities" tone={tone(kpis.openFindings, 'warning')} icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          percent={Math.min(100, kpis.openFindings * 12.5)}
        />
      </div>
      {needsAttention(kpis) && (
        <p role="status" className="text-xs text-rose-700 dark:text-rose-300">Something needs attention today.</p>
      )}
    </div>
  )
}
