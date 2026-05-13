'use client'

import { Camera, HardHat, UsersRound, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import type { HomeMetrics } from '@soteria/core/homeMetrics'
import { InfographicMetricCard, type InfographicTone } from './InfographicMetricCard'

// 4-tile KPI strip plus a freshness/refresh row underneath. The wrapper
// owns the error-banner-with-retry path; each Kpi is a dumb display tile.

export function KpiRow({
  metrics, error, loadedAt, refreshing, now, onRefresh,
}: {
  metrics:    HomeMetrics | null
  error:      string | null
  loadedAt:   number | null
  refreshing: boolean
  now:        Date
  onRefresh:  () => void
}) {
  if (error) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 dark:text-amber-100 flex items-center justify-between gap-3">
        <span>Couldn&apos;t load live metrics: {error}. Check your connection or that migrations 009-011 are applied.</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="shrink-0 px-3 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold disabled:opacity-50 hover:bg-amber-700 transition-colors"
        >
          {refreshing ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }
  const cards = buildKpiCards(metrics)

  return (
    <section className="space-y-2">
      {cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {cards.map(card => (
            <InfographicMetricCard key={card.label} {...card} />
          ))}
        </div>
      )}
      <FreshnessIndicator loadedAt={loadedAt} refreshing={refreshing} now={now} onRefresh={onRefresh} />
    </section>
  )
}

function buildKpiCards(metrics: HomeMetrics | null): Array<{
  label:    string
  value:    string | number
  caption:  string
  detail?:  string
  href:     string
  tone:     InfographicTone
  icon:     ReactNode
  percent:  number
}> {
  if (!metrics) {
    return [
      { label: 'Permits active', value: '—', caption: 'Loading confined-space status', href: '/confined-spaces/status', tone: 'neutral', icon: <HardHat className="h-4 w-4" />, percent: 0 },
      { label: 'People in spaces', value: '—', caption: 'Loading entrant headcount', href: '/confined-spaces/status', tone: 'neutral', icon: <UsersRound className="h-4 w-4" />, percent: 0 },
      { label: 'LOTO equipment', value: '—', caption: 'Loading equipment register', href: '/loto', tone: 'neutral', icon: <Workflow className="h-4 w-4" />, percent: 0 },
      { label: 'Photo coverage', value: '—', caption: 'Loading placard evidence', href: '/loto', tone: 'neutral', icon: <Camera className="h-4 w-4" />, percent: 0 },
    ]
  }

  const cards: ReturnType<typeof buildKpiCards> = []
  if (metrics.modules.confinedSpaces) {
    cards.push({
      label:   'Permits active',
      value:   metrics.activePermitCount,
      caption: metrics.activePermitCount > 0 ? 'Authorized entries in progress' : 'No active entries',
      detail:  metrics.expiredPermitCount > 0 ? `${metrics.expiredPermitCount} expired permit${metrics.expiredPermitCount === 1 ? '' : 's'} need closure` : 'Expiry queue clear',
      href:    '/confined-spaces/status',
      tone:    metrics.expiredPermitCount > 0 ? 'critical' : metrics.activePermitCount > 0 ? 'attention' : 'safe',
      icon:    <HardHat className="h-4 w-4" />,
      percent: Math.min(100, metrics.activePermitCount * 12.5),
    })
    cards.push({
      label:   'People in spaces',
      value:   metrics.peopleInSpaces,
      caption: metrics.peopleInSpaces > 0 ? 'Entrants currently covered by permits' : 'No entrants signed in',
      href:    '/confined-spaces/status',
      tone:    metrics.peopleInSpaces > 0 ? 'attention' : 'safe',
      icon:    <UsersRound className="h-4 w-4" />,
      percent: Math.min(100, metrics.peopleInSpaces * 4),
    })
  }

  if (metrics.modules.loto) {
    cards.push({
      label:   'LOTO equipment',
      value:   metrics.totalEquipment,
      caption: `${metrics.photoCompleteCount} complete · ${metrics.photoPartialCount + metrics.photoMissingCount} need photos`,
      href:    '/loto',
      tone:    'neutral',
      icon:    <Workflow className="h-4 w-4" />,
      percent: metrics.totalEquipment > 0 ? 100 : 0,
    })
    cards.push({
      label:   'Photo coverage',
      value:   `${metrics.photoCompletionPct}%`,
      caption: 'Placard photo evidence completeness',
      detail:  `${metrics.photoMissingCount} missing · ${metrics.photoPartialCount} partial`,
      href:    '/loto',
      tone:    metrics.photoCompletionPct >= 90 ? 'safe' : metrics.photoCompletionPct >= 70 ? 'warning' : 'critical',
      icon:    <Camera className="h-4 w-4" />,
      percent: metrics.photoCompletionPct,
    })
  }

  return cards
}

// "Updated 23s ago · ↻" line so a supervisor knows the metrics aren't stuck.
// The clock tick that drives the rest of the home page also drives this —
// `now` is passed in so the relative label ticks live without a separate
// interval. Tap to force a refresh.
function FreshnessIndicator({
  loadedAt, refreshing, now, onRefresh,
}: {
  loadedAt:   number | null
  refreshing: boolean
  now:        Date
  onRefresh:  () => void
}) {
  const label = loadedAt == null
    ? (refreshing ? 'Loading…' : '—')
    : refreshing ? 'Updating…' : `Updated ${formatAgo(now.getTime() - loadedAt)}`
  return (
    <div className="flex items-center justify-end gap-2 text-[11px] text-slate-500 dark:text-slate-400">
      <span aria-live="polite">{label}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh metrics"
        className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40 disabled:opacity-50 transition-colors"
      >
        ↻
      </button>
    </div>
  )
}

function formatAgo(ms: number): string {
  if (ms < 5_000)        return 'just now'
  if (ms < 60_000)       return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000)    return `${Math.floor(ms / 60_000)}m ago`
  return `${Math.floor(ms / 3_600_000)}h ago`
}
