'use client'

import Link from 'next/link'
import { AlertTriangle, FileText, Flame } from 'lucide-react'
import type { PermitAlertSummary, HotWorkAlertSummary } from '@/lib/homeMetrics'

// Sits below the critical alert banner (expired permits) but above the KPI
// strip. Only renders when there's at least one alert — empty state would
// be noise on a busy iPad. Mixes CS expiring/stale tiles with hot-work
// expiring/post-watch tiles in one responsive grid.

export function PermitAlertsCard({
  expiringSoon, pendingStale, hotWorkExpiring, hotWorkInPostWatch,
}: {
  expiringSoon:       PermitAlertSummary[]
  pendingStale:       PermitAlertSummary[]
  hotWorkExpiring:    HotWorkAlertSummary[]
  hotWorkInPostWatch: HotWorkAlertSummary[]
}) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {expiringSoon.length > 0 && (
        <AlertList
          tone="amber"
          icon={<AlertTriangle className="h-5 w-5" />}
          title={`${expiringSoon.length} permit${expiringSoon.length === 1 ? '' : 's'} expiring soon`}
          subtitle="Less than 2 hours left — confirm task complete and cancel."
          rows={expiringSoon.slice(0, 3).map(p => ({
            href:  `/confined-spaces/${encodeURIComponent(p.spaceId)}/permits/${p.id}`,
            label: p.serial,
            sub:   `${p.spaceId} · ${p.minutes} min left`,
          }))}
        />
      )}
      {pendingStale.length > 0 && (
        <AlertList
          tone="slate"
          icon={<FileText className="h-5 w-5" />}
          title={`${pendingStale.length} draft${pendingStale.length === 1 ? '' : 's'} pending signature`}
          subtitle="Open >2 hours — sign or abandon so the audit trail stays clean."
          rows={pendingStale.slice(0, 3).map(p => ({
            href:  `/confined-spaces/${encodeURIComponent(p.spaceId)}/permits/${p.id}`,
            label: p.serial,
            sub:   `${p.spaceId} · ${humanizeMinutes(p.minutes)} old`,
          }))}
        />
      )}
      {hotWorkExpiring.length > 0 && (
        <AlertList
          tone="rose"
          icon={<Flame className="h-5 w-5" />}
          title={`${hotWorkExpiring.length} hot-work permit${hotWorkExpiring.length === 1 ? '' : 's'} expiring soon`}
          subtitle="Less than 30 min left — finish or extend before fire watch ends."
          rows={hotWorkExpiring.slice(0, 3).map(p => ({
            href:  `/hot-work/${p.id}`,
            label: p.serial,
            sub:   `${p.workLocation} · ${p.minutes} min left`,
          }))}
        />
      )}
      {hotWorkInPostWatch.length > 0 && (
        <AlertList
          tone="indigo"
          icon={<Flame className="h-5 w-5" />}
          title={`${hotWorkInPostWatch.length} fire watch${hotWorkInPostWatch.length === 1 ? '' : 'es'} active`}
          subtitle="Post-work watch in progress — watcher must remain on site (NFPA 51B §8.7)."
          rows={hotWorkInPostWatch.slice(0, 3).map(p => ({
            href:  `/hot-work/${p.id}`,
            label: p.serial,
            sub:   `${p.workLocation} · ${p.minutes} min on watch`,
          }))}
        />
      )}
    </section>
  )
}

function AlertList({
  tone, icon, title, subtitle, rows,
}: {
  tone:     'amber' | 'slate' | 'rose' | 'indigo'
  icon:     React.ReactNode
  title:    string
  subtitle: string
  rows:     Array<{ href: string; label: string; sub: string }>
}) {
  const toneCls =
    tone === 'amber'  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 text-amber-900 dark:text-amber-100'
  : tone === 'rose'   ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 text-rose-900 dark:text-rose-100'
  : tone === 'indigo' ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 text-indigo-900 dark:text-indigo-100'
  :                     'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
  return (
    <div className={`rounded-xl border ${toneCls} p-4 space-y-3`}>
      <header className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{title}</p>
          <p className="text-[11px] opacity-80">{subtitle}</p>
        </div>
      </header>
      <ul className="space-y-1">
        {rows.map(r => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="flex items-center justify-between gap-2 text-xs bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 rounded-md px-2 py-1.5 transition-colors"
            >
              <span className="font-mono font-semibold tracking-wider truncate">{r.label}</span>
              <span className="text-[11px] opacity-70 truncate">{r.sub}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function humanizeMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
