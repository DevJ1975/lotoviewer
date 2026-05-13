'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { UserRoundCog } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { timeOfDayGreeting } from '@/components/Greeting'
import { fetchHomeMetrics, type HomeMetrics } from '@soteria/core/homeMetrics'
import ThemeToggle from '@/components/ThemeToggle'
import { Hero }                 from './Hero'
import { CriticalAlertBanner }  from './CriticalAlertBanner'
import { MeterAlertsBanner }    from './MeterAlertsBanner'
import { PermitAlertsCard }     from './PermitAlertsCard'
import { CommandCenterPanel }   from './CommandCenterPanel'
import { SafetyAlertTicker }    from './SafetyAlertTicker'
import { QuickActions }         from './QuickActions'
import { KpiRow }               from './KpiRow'
import { ActivePermitsPanel }   from './ActivePermitsPanel'
import { RecentActivityPanel }  from './RecentActivityPanel'
import { ComingSoonStrip }      from './ComingSoonStrip'
import { ModulesGrid }          from './ModulesGrid'
import RiskKpiPanel             from './RiskKpiPanel'
import NearMissKpiPanel         from './NearMissKpiPanel'
import JhaKpiPanel              from './JhaKpiPanel'
import IncidentKpiPanel         from './IncidentKpiPanel'
import BBSKpiPanel              from './BBSKpiPanel'
import OpenActionsPanel         from './OpenActionsPanel'

// Multi-module dashboard — the legacy default home rendered by
// app/page.tsx for tenants who use more than one safety module.
// Single-module tenants are redirected straight to their module
// home (see lib/landing.ts + the dispatcher in app/page.tsx).
//
// Information hierarchy (top → bottom):
//   1. Hero band (greeting + clock + weather)
//   2. Critical alert banner — only when expired permits > 0
//   3. Permit alerts (CS + hot-work, mixed grid) — only when any present
//   4. Quick actions — common one-tap workflows
//   5. KPI tiles — at-a-glance counts
//   6. Active Permits + Recent Activity (2-col on desktop)
//   7. Coming Soon advert strip
//   8. Module nav grid (deemphasized — drawer is primary nav)
//
// All numbers are real reads via lib/homeMetrics.ts. Coming-soon
// modules render as advertisements only — no fake metrics on a real
// safety dashboard.

const CLOCK_TICK_MS      = 1000        // every second so active-permit countdowns tick visibly
const METRICS_REFRESH_MS = 60 * 1000   // permits / equipment / activity: every minute

export default function MultiModuleDashboard() {
  const { profile, email } = useAuth()
  const { tenant, loading: tenantLoading } = useTenant()
  const tenantModules = tenant?.modules ?? null
  const firstName = (profile?.full_name?.trim().split(/\s+/)[0]) || (email?.split('@')[0]) || 'there'

  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const greeting = useMemo(() => timeOfDayGreeting(now), [now])
  const dateLabel = useMemo(() =>
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  [now])
  const timeLabel = useMemo(() =>
    now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  [now])

  const [metrics, setMetrics] = useState<HomeMetrics | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [metricsLoadedAt, setMetricsLoadedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadMetrics = useCallback(async () => {
    if (tenantLoading) return
    setRefreshing(true)
    try {
      const m = await fetchHomeMetrics(tenantModules)
      setMetrics(m)
      setMetricsError(null)
      setMetricsLoadedAt(Date.now())
    } catch (err) {
      console.error('[home] metrics fetch failed', err)
      setMetricsError(err instanceof Error ? err.message : 'Could not load metrics')
    } finally {
      setRefreshing(false)
    }
  }, [tenantLoading, tenantModules])

  useEffect(() => {
    if (tenantLoading) return
    loadMetrics()
    const id = setInterval(loadMetrics, METRICS_REFRESH_MS)
    return () => clearInterval(id)
  }, [tenantLoading, loadMetrics])

  return (
    <div className="animate-panel-in mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <Hero greeting={greeting} firstName={firstName} dateLabel={dateLabel} timeLabel={timeLabel} />

      {/* Theme switch — right-aligned strip directly under the hero so
          it's easy to find without crowding the greeting band. The
          toggle component handles its own light/dark coloring. */}
      <div className="flex items-center justify-end gap-2">
        <Link
          href="/settings/profile"
          className="motion-press inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-brand-navy/30 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-yellow/30 dark:hover:bg-slate-800"
        >
          <UserRoundCog className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
          My Profile
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Theme</span>
        <ThemeToggle />
      </div>

      {metrics && metrics.expiredPermitCount > 0 && (
        <CriticalAlertBanner count={metrics.expiredPermitCount} />
      )}

      {metrics && (
        <SafetyAlertTicker alerts={metrics.commandCenterSafetyAlerts} />
      )}

      <CommandCenterPanel metrics={metrics} error={metricsError} />

      {/* Bump-test reminders. Sits below the critical permit banner
          (expired permits are higher severity) but above other alerts.
          Renders nothing when no meters need attention. */}
      <MeterAlertsBanner />

      {metrics && (
        metrics.expiringSoonPermits.length > 0
        || metrics.pendingStalePermits.length > 0
        || metrics.hotWorkExpiringSoon.length > 0
        || metrics.hotWorkInPostWatch.length > 0
      ) && (
        <PermitAlertsCard
          expiringSoon={metrics.expiringSoonPermits}
          pendingStale={metrics.pendingStalePermits}
          hotWorkExpiring={metrics.hotWorkExpiringSoon}
          hotWorkInPostWatch={metrics.hotWorkInPostWatch}
        />
      )}

      <QuickActions />

      <KpiRow
        metrics={metrics}
        error={metricsError}
        loadedAt={metricsLoadedAt}
        refreshing={refreshing}
        now={now}
        onRefresh={loadMetrics}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ActivePermitsPanel permits={metrics?.activePermits ?? null} now={now} />
        <RecentActivityPanel events={metrics?.recentActivity ?? null} />
      </div>

      {/* Risk Intelligence — visibility-gated; no-op when the
          tenant's modules.risk-assessment is false. */}
      <RiskKpiPanel />

      {/* Near-Miss Intelligence — same gating pattern, mounts only
          when the tenant has near-miss visible. */}
      <NearMissKpiPanel />

      {/* JHA Intelligence — same gating pattern, mounts only when
          the tenant has jha visible. */}
      <JhaKpiPanel />

      {/* Incident program scorecard + per-user CAPA list — both
          gated by isModuleVisible('incidents'). The CAPA panel
          self-hides when the user has no open actions, so it's
          a no-op for new users. */}
      <IncidentKpiPanel />

      {/* Behavior-Based Safety — QR-driven observation program with
          gamification leaderboard. Self-gates via isModuleVisible. */}
      <BBSKpiPanel />

      <OpenActionsPanel />

      <ComingSoonStrip />
      <ModulesGrid />
    </div>
  )
}
