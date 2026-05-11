'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react'
import type { HomeMetrics } from '@soteria/core/homeMetrics'

export type CommandCenterTone = 'critical' | 'warning' | 'attention' | 'ok'

export interface CommandCenterItem {
  id:              string
  tone:            CommandCenterTone
  label:           string
  value:           string
  detail:          string
  suggestedAction: string
  href:            string
}

const TONE_RANK: Record<CommandCenterTone, number> = {
  ok:        0,
  attention: 1,
  warning:   2,
  critical:  3,
}

export function deriveCommandCenterItems(metrics: HomeMetrics): CommandCenterItem[] {
  const items: CommandCenterItem[] = []

  if (metrics.expiredPermitCount > 0) {
    items.push({
      id:     'expired-confined-space-permits',
      tone:   'critical',
      label:  'Expired permits',
      value:  String(metrics.expiredPermitCount),
      detail: 'Evacuate or cancel expired confined-space entries.',
      suggestedAction: 'Confirm entrants are out, then cancel or close each permit.',
      href:   '/confined-spaces/status',
    })
  }

  if (metrics.hotWorkExpiringSoon.length > 0) {
    items.push({
      id:     'hot-work-expiring',
      tone:   'critical',
      label:  'Hot work expiring',
      value:  String(metrics.hotWorkExpiringSoon.length),
      detail: 'Finish, extend, or cancel before authorization lapses.',
      suggestedAction: 'Contact the permit authorizer before work continues.',
      href:   '/hot-work/status',
    })
  }

  if (metrics.expiringSoonPermits.length > 0) {
    items.push({
      id:     'confined-space-expiring',
      tone:   'warning',
      label:  'CS permits expiring',
      value:  String(metrics.expiringSoonPermits.length),
      detail: 'Less than 2 hours left on active entries.',
      suggestedAction: 'Check entrant status and prepare renewal or cancellation.',
      href:   '/confined-spaces/status',
    })
  }

  if (metrics.pendingStalePermits.length > 0) {
    items.push({
      id:     'stale-permit-drafts',
      tone:   'warning',
      label:  'Stale permit drafts',
      value:  String(metrics.pendingStalePermits.length),
      detail: 'Open drafts should be signed or abandoned.',
      suggestedAction: 'Have supervisors sign active drafts or abandon stale work.',
      href:   '/confined-spaces/status',
    })
  }

  if (metrics.hotWorkInPostWatch.length > 0) {
    items.push({
      id:     'fire-watch-active',
      tone:   'attention',
      label:  'Fire watch active',
      value:  String(metrics.hotWorkInPostWatch.length),
      detail: 'Post-work watch is still in progress.',
      suggestedAction: 'Keep watchers assigned until the watch timer is complete.',
      href:   '/hot-work/status',
    })
  }

  if (metrics.totalEquipment > 0 && metrics.photoCompletionPct < 90) {
    items.push({
      id:     'loto-photo-coverage',
      tone:   metrics.photoCompletionPct < 70 ? 'warning' : 'attention',
      label:  'LOTO photo coverage',
      value:  `${metrics.photoCompletionPct}%`,
      detail: 'Bring placard photo evidence above the 90% target.',
      suggestedAction: 'Prioritize missing equipment and isolation-point photos.',
      href:   '/loto',
    })
  }

  if (metrics.activePermitCount > 0) {
    items.push({
      id:     'active-confined-space-permits',
      tone:   'attention',
      label:  'Active CS permits',
      value:  String(metrics.activePermitCount),
      detail: `${metrics.peopleInSpaces} entrant${metrics.peopleInSpaces === 1 ? '' : 's'} currently in spaces.`,
      suggestedAction: 'Keep attendant coverage and atmospheric checks current.',
      href:   '/confined-spaces/status',
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
  const Icon = iconForTone(item.tone)
  return (
    <Link
      href={item.href}
      className={`group rounded-lg border p-3 min-h-36 flex flex-col justify-between transition-shadow hover:shadow-sm ${cardClass(item.tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {item.label}
        </p>
        <Icon className="h-4 w-4 shrink-0" />
      </div>
      <div>
        <p className="mt-2 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">
          {item.value}
        </p>
        <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-300">
          {item.detail}
        </p>
        <p className="mt-3 border-t border-slate-200/70 dark:border-slate-800 pt-2 text-[11px] font-semibold leading-snug text-slate-700 dark:text-slate-200">
          <span className="block text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Suggested next step
          </span>
          {item.suggestedAction}
        </p>
      </div>
    </Link>
  )
}

function iconForTone(tone: CommandCenterTone) {
  if (tone === 'critical') return ShieldAlert
  if (tone === 'warning') return AlertTriangle
  if (tone === 'attention') return Clock
  return CheckCircle2
}

function sectionClass(tone: CommandCenterTone): string {
  if (tone === 'critical') return 'border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/20'
  if (tone === 'warning') return 'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20'
  if (tone === 'attention') return 'border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20'
  return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20'
}

function cardClass(tone: CommandCenterTone): string {
  if (tone === 'critical') return 'border-rose-200 dark:border-rose-900 bg-white/80 dark:bg-slate-950/50 text-rose-700 dark:text-rose-300'
  if (tone === 'warning') return 'border-amber-200 dark:border-amber-900 bg-white/80 dark:bg-slate-950/50 text-amber-700 dark:text-amber-300'
  if (tone === 'attention') return 'border-sky-200 dark:border-sky-900 bg-white/80 dark:bg-slate-950/50 text-sky-700 dark:text-sky-300'
  return 'border-emerald-200 dark:border-emerald-900 bg-white/80 dark:bg-slate-950/50 text-emerald-700 dark:text-emerald-300'
}
