'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react'
import type { HomeMetrics } from '@soteria/core/homeMetrics'
import { InfographicMetricCard, type InfographicTone } from './InfographicMetricCard'

export type CommandCenterTone = 'critical' | 'warning' | 'attention' | 'ok'

export interface CommandCenterItem {
  id:              string
  tone:            CommandCenterTone
  label:           string
  value:           string
  detail:          string
  suggestedAction: string
  href:            string
  percent:         number
}

const TONE_RANK: Record<CommandCenterTone, number> = {
  ok:        0,
  attention: 1,
  warning:   2,
  critical:  3,
}

export function deriveCommandCenterItems(metrics: HomeMetrics): CommandCenterItem[] {
  const items: CommandCenterItem[] = []

  if (metrics.commandCenterSafetyAlerts.length > 0) {
    const firstAlert = metrics.commandCenterSafetyAlerts[0]
    const tone = firstAlert?.severity_tone ?? 'attention'
    items.push({
      id:              'incident-safety-alerts',
      tone,
      label:           'Incident alerts',
      value:           String(metrics.commandCenterSafetyAlerts.length),
      detail:          firstAlert ? `${firstAlert.report_number}: ${firstAlert.title}` : 'Unresolved command-center safety alerts.',
      suggestedAction: 'Triage the alert, assign ownership, and document the response.',
      href:            firstAlert ? `/incidents/${firstAlert.incident_id}` : '/incidents',
      percent:         tonePercent(tone),
    })
  }

  if (metrics.modules.confinedSpaces && metrics.expiredPermitCount > 0) {
    items.push({
      id:     'expired-confined-space-permits',
      tone:   'critical',
      label:  'Expired permits',
      value:  String(metrics.expiredPermitCount),
      detail: 'Evacuate or cancel expired confined-space entries.',
      suggestedAction: 'Confirm entrants are out, then cancel or close each permit.',
      href:   '/confined-spaces/status',
      percent: 100,
    })
  }

  if (metrics.modules.hotWork && metrics.hotWorkExpiringSoon.length > 0) {
    items.push({
      id:     'hot-work-expiring',
      tone:   'critical',
      label:  'Hot work expiring',
      value:  String(metrics.hotWorkExpiringSoon.length),
      detail: 'Finish, extend, or cancel before authorization lapses.',
      suggestedAction: 'Contact the permit authorizer before work continues.',
      href:   '/hot-work/status',
      percent: 100,
    })
  }

  if (metrics.modules.confinedSpaces && metrics.expiringSoonPermits.length > 0) {
    items.push({
      id:     'confined-space-expiring',
      tone:   'warning',
      label:  'CS permits expiring',
      value:  String(metrics.expiringSoonPermits.length),
      detail: 'Less than 2 hours left on active entries.',
      suggestedAction: 'Check entrant status and prepare renewal or cancellation.',
      href:   '/confined-spaces/status',
      percent: 82,
    })
  }

  if (metrics.modules.confinedSpaces && metrics.pendingStalePermits.length > 0) {
    items.push({
      id:     'stale-permit-drafts',
      tone:   'warning',
      label:  'Stale permit drafts',
      value:  String(metrics.pendingStalePermits.length),
      detail: 'Open drafts should be signed or abandoned.',
      suggestedAction: 'Have supervisors sign active drafts or abandon stale work.',
      href:   '/confined-spaces/status',
      percent: 70,
    })
  }

  if (metrics.modules.hotWork && metrics.hotWorkInPostWatch.length > 0) {
    items.push({
      id:     'fire-watch-active',
      tone:   'attention',
      label:  'Fire watch active',
      value:  String(metrics.hotWorkInPostWatch.length),
      detail: 'Post-work watch is still in progress.',
      suggestedAction: 'Keep watchers assigned until the watch timer is complete.',
      href:   '/hot-work/status',
      percent: 55,
    })
  }

  if (metrics.modules.loto && metrics.totalEquipment > 0 && metrics.photoCompletionPct < 90) {
    items.push({
      id:     'loto-photo-coverage',
      tone:   metrics.photoCompletionPct < 70 ? 'warning' : 'attention',
      label:  'LOTO photo coverage',
      value:  `${metrics.photoCompletionPct}%`,
      detail: 'Bring placard photo evidence above the 90% target.',
      suggestedAction: 'Prioritize missing equipment and isolation-point photos.',
      href:   '/loto',
      percent: metrics.photoCompletionPct,
    })
  }

  if (metrics.modules.confinedSpaces && metrics.activePermitCount > 0) {
    items.push({
      id:     'active-confined-space-permits',
      tone:   'attention',
      label:  'Active CS permits',
      value:  String(metrics.activePermitCount),
      detail: `${metrics.peopleInSpaces} entrant${metrics.peopleInSpaces === 1 ? '' : 's'} currently in spaces.`,
      suggestedAction: 'Keep attendant coverage and atmospheric checks current.',
      href:   '/confined-spaces/status',
      percent: Math.min(100, metrics.activePermitCount * 12.5),
    })
  }

  if (items.length === 0) {
    items.push({
      id:     'all-clear',
      tone:   'ok',
      label:  'Program queues stable',
      value:  'OK',
      detail: 'No permit, fire-watch, or photo-coverage queue signals.',
      suggestedAction: 'Review scorecard trends or continue routine field checks.',
      href:   '/?dashboard=1',
      percent: 100,
    })
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const toneDelta = TONE_RANK[b.item.tone] - TONE_RANK[a.item.tone]
      return toneDelta || a.index - b.index
    })
    .map(({ item }) => item)
}

function tonePercent(tone: CommandCenterTone): number {
  if (tone === 'critical') return 100
  if (tone === 'warning') return 82
  if (tone === 'attention') return 58
  return 100
}

export function highestCommandCenterTone(items: CommandCenterItem[]): CommandCenterTone {
  return items.reduce<CommandCenterTone>((highest, item) => (
    TONE_RANK[item.tone] > TONE_RANK[highest] ? item.tone : highest
  ), 'ok')
}

export function CommandCenterPanel({ metrics, error = null }: {
  metrics: HomeMetrics | null
  error?:  string | null
}) {
  if (!metrics) {
    if (error) {
      return (
        <section className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            EHS Command Center
          </p>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Live signals unavailable</h2>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">
            Check the live metrics error below, then retry the dashboard refresh.
          </p>
        </section>
      )
    }

    return (
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              EHS Command Center
            </p>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Loading live signals</h2>
          </div>
          <div className="h-9 w-9 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      </section>
    )
  }

  const items = deriveCommandCenterItems(metrics)
  const highestTone = highestCommandCenterTone(items)
  const visibleItems = items.slice(0, 4)
  const hiddenCount = Math.max(0, items.length - visibleItems.length)
  const signalLabel = items.length === 1 && items[0]?.tone === 'ok'
    ? 'No queue signals'
    : `${items.length} live signal${items.length === 1 ? '' : 's'}`

  return (
    <section className={`rounded-xl border p-4 ${sectionClass(highestTone)}`}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            EHS Command Center
          </p>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {highestTone === 'ok' ? 'Program queues stable' : 'Items needing attention'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="rounded-full border border-slate-200 dark:border-slate-700 px-2 py-1 font-semibold text-slate-600 dark:text-slate-300">
            {signalLabel}
          </span>
          <Link href="/incidents/scorecard" className="font-semibold text-brand-navy dark:text-brand-yellow hover:underline">
            Scorecard
          </Link>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {visibleItems.map(item => (
          <CommandItemCard key={item.id} item={item} />
        ))}
      </div>

      {hiddenCount > 0 && (
        <p className="mt-3 text-xs font-medium text-slate-600 dark:text-slate-300">
          Showing the first {visibleItems.length} signals. {hiddenCount} more {hiddenCount === 1 ? 'item needs' : 'items need'} review in the linked work queues.
        </p>
      )}
    </section>
  )
}

function CommandItemCard({ item }: { item: CommandCenterItem }) {
  return (
    <InfographicMetricCard
      label={item.label}
      value={item.value}
      caption={item.detail}
      detail={item.suggestedAction}
      href={item.href}
      tone={toneForMetricCard(item.tone)}
      icon={iconForTone(item.tone)}
      percent={item.percent}
    />
  )
}

function iconForTone(tone: CommandCenterTone) {
  if (tone === 'critical') return <ShieldAlert className="h-4 w-4" />
  if (tone === 'warning') return <AlertTriangle className="h-4 w-4" />
  if (tone === 'attention') return <Clock className="h-4 w-4" />
  return <CheckCircle2 className="h-4 w-4" />
}

function toneForMetricCard(tone: CommandCenterTone): InfographicTone {
  if (tone === 'critical') return 'critical'
  if (tone === 'warning') return 'warning'
  if (tone === 'attention') return 'attention'
  return 'safe'
}

function sectionClass(tone: CommandCenterTone): string {
  if (tone === 'critical') return 'border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/20'
  if (tone === 'warning') return 'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20'
  if (tone === 'attention') return 'border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20'
  return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20'
}
