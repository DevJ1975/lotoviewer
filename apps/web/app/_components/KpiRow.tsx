'use client'

import Link from 'next/link'
import type { HomeMetrics } from '@/lib/homeMetrics'

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
  const loading = metrics === null
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Permits Active"
          value={loading ? '—' : metrics.activePermitCount}
          href="/confined-spaces/status"
          tone={loading ? 'neutral' : metrics.activePermitCount > 0 ? 'safe' : 'neutral'}
        />
        <Kpi
          label="People In Spaces"
          value={loading ? '—' : metrics.peopleInSpaces}
          href="/confined-spaces/status"
          tone="neutral"
        />
        <Kpi
          label="LOTO Equipment"
          value={loading ? '—' : metrics.totalEquipment}
          href="/loto"
          tone="neutral"
        />
        <Kpi
          label="Photo Coverage"
          value={loading ? '—' : `${metrics.photoCompletionPct}%`}
          href="/loto"
          tone={loading ? 'neutral' : metrics.photoCompletionPct >= 90 ? 'safe' : metrics.photoCompletionPct >= 70 ? 'warning' : 'critical'}
        />
      </div>
      <FreshnessIndicator loadedAt={loadedAt} refreshing={refreshing} now={now} onRefresh={onRefresh} />
    </section>
  )
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

function Kpi({ label, value, href, tone }: {
  label: string
  value: string | number
  href:  string
  tone:  'safe' | 'warning' | 'critical' | 'neutral'
}) {
  const cls =
    tone === 'critical' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200'
  : tone === 'warning'  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200'
  : tone === 'safe'     ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200'
  :                       'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'

  const valueCls =
    tone === 'critical' ? 'text-rose-700 dark:text-rose-300'
  : tone === 'warning'  ? 'text-amber-700 dark:text-amber-300'
  : tone === 'safe'     ? 'text-emerald-700 dark:text-emerald-300'
  :                       'text-slate-900 dark:text-slate-100'

  return (
    <Link href={href} className={`block rounded-xl border ${cls} p-4 hover:shadow-sm transition-shadow`}>
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-3xl font-black tabular-nums mt-1 ${valueCls}`}>{value}</p>
    </Link>
  )
}
