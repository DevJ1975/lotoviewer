'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react'
import type { HomeMetrics } from '@soteria/core/homeMetrics'

export type CommandCenterTone = 'critical' | 'warning' | 'attention' | 'ok'

export interface CommandCenterItem {
  id:       string
  tone:     CommandCenterTone
  label:    string
  value:    string
  detail:   string
  href:     string
}

export function deriveCommandCenterItems(metrics: HomeMetrics): CommandCenterItem[] {
  const items: CommandCenterItem[] = []

  for (const alert of metrics.commandCenterSafetyAlerts) {
    items.push({
      id:     `safety-alert-${alert.id}`,
      tone:   alert.severity_tone,
      label:  alert.title,
      value:  alert.report_number,
      detail: alert.summary,
      href:   `/incidents/${alert.incident_id}`,
    })
  }

  if (metrics.expiredPermitCount > 0) {
    items.push({
      id:     'expired-confined-space-permits',
      tone:   'critical',
      label:  'Expired permits',
      value:  String(metrics.expiredPermitCount),
      detail: 'Evacuate or cancel expired confined-space entries.',
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
      href:   '/confined-spaces/status',
    })
  }

  if (items.length === 0) {
    items.push({
      id:     'all-clear',
      tone:   'ok',
      label:  'No urgent EHS items',
      value:  'OK',
      detail: 'No expired permits, stale drafts, or low photo coverage signals.',
      href:   '/?dashboard=1',
    })
  }

  return items
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
  const highestTone = items[0]?.tone ?? 'ok'

  return (
    <section className={`rounded-xl border p-4 ${sectionClass(highestTone)}`}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            EHS Command Center
          </p>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {highestTone === 'ok' ? 'Program pulse is clear' : 'Items needing attention'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <Link href="/incidents/scorecard" className="font-semibold text-brand-navy dark:text-brand-yellow hover:underline">
            Scorecard
          </Link>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {items.slice(0, 4).map(item => (
          <CommandItemCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

function CommandItemCard({ item }: { item: CommandCenterItem }) {
  const Icon = iconForTone(item.tone)
  return (
    <Link
      href={item.href}
      className={`group rounded-lg border p-3 min-h-24 flex flex-col justify-between transition-shadow hover:shadow-sm ${cardClass(item.tone)}`}
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
