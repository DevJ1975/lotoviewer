'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { timeOfDayGreeting } from '@/components/Greeting'
import { fetchHomeMetrics, type HomeMetrics } from '@/lib/homeMetrics'
import ThemeToggle from '@/components/ThemeToggle'
import { Hero }                 from './Hero'
import { CriticalAlertBanner }  from './CriticalAlertBanner'
import { MeterAlertsBanner }    from './MeterAlertsBanner'
import { PermitAlertsCard }     from './PermitAlertsCard'
import { QuickActions }         from './QuickActions'
import { KpiRow }               from './KpiRow'
import { ActivePermitsPanel }   from './ActivePermitsPanel'
import { RecentActivityPanel }  from './RecentActivityPanel'
import { ComingSoonStrip }      from './ComingSoonStrip'
import { ModulesGrid }          from './ModulesGrid'

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
    setRefreshing(true)
    try {
      const m = await fetchHomeMetrics()
      setMetrics(m)
      setMetricsError(null)
      setMetricsLoadedAt(Date.now())
    } catch (err) {
      console.error('[home] metrics fetch failed', err)
      setMetricsError(err instanceof Error ? err.message : 'Could not load metrics')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadMetrics()
    const id = setInterval(loadMetrics, METRICS_REFRESH_MS)
    return () => clearInterval(id)
  }, [loadMetrics])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Hero greeting={greeting} firstName={firstName} dateLabel={dateLabel} timeLabel={timeLabel} />

      {/* Theme switch — right-aligned strip directly under the hero so
          it's easy to find without crowding the greeting band. The
          toggle component handles its own light/dark coloring. */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Theme</span>
        <ThemeToggle />
      </div>

      {metrics && metrics.expiredPermitCount > 0 && (
        <CriticalAlertBanner count={metrics.expiredPermitCount} />
      )}

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

      <ComingSoonStrip />
      <ModulesGrid />
    </div>
  )
}
