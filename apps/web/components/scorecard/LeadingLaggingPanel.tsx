'use client'

import { Activity, TrendingUp } from 'lucide-react'
import type { IncidentRiskDriver, IndicatorKind } from '@soteria/core/incidentRiskModel'

// Splits the deterministic risk-model drivers into leading (preventive) vs
// lagging (outcome) indicators — the safety director's two lenses. Each row is a
// tappable drill-down into MetricDetailSheet. The pressure bar shows how much
// the indicator is contributing to risk right now (0 = healthy, 100 = saturating).

function pressureColor(p: number): string {
  if (p >= 66) return 'bg-rose-500'
  if (p >= 33) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function Group({ title, kind, drivers, onSelect }: {
  title: string
  kind: IndicatorKind
  drivers: IncidentRiskDriver[]
  onSelect: (d: IncidentRiskDriver) => void
}) {
  const Icon = kind === 'leading' ? TrendingUp : Activity
  const rows = [...drivers].sort((a, b) => b.pressure - a.pressure)
  return (
    <div className="ops-surface animate-panel-in rounded-lg p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/15 dark:text-brand-yellow">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{title}</h3>
        <span className="ml-auto text-[11px] font-semibold text-slate-400">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">No indicators in this group.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(d => (
            <li key={d.key}>
              <button
                type="button"
                onClick={() => onSelect(d)}
                className="motion-press group flex w-full items-center gap-3 rounded-md border border-slate-100 px-3 py-2 text-left outline-none hover:border-brand-navy/30 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-navy/40 dark:border-slate-800 dark:hover:bg-slate-800/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800 group-hover:text-brand-navy dark:text-slate-100">{d.label}</span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{d.value} · target {d.target}</span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <span className={`block h-full ${pressureColor(d.pressure)}`} style={{ width: `${Math.max(2, Math.min(100, d.pressure))}%` }} />
                  </span>
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  +{d.contribution}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LeadingLaggingPanel({ drivers, onSelect }: {
  drivers: IncidentRiskDriver[]
  onSelect: (d: IncidentRiskDriver) => void
}) {
  const leading = drivers.filter(d => d.kind === 'leading')
  const lagging = drivers.filter(d => d.kind === 'lagging')
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="ops-section-title text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Leading vs lagging indicators</span>
        <span aria-hidden="true" className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Group title="Leading (preventive)" kind="leading" drivers={leading} onSelect={onSelect} />
        <Group title="Lagging (outcomes)" kind="lagging" drivers={lagging} onSelect={onSelect} />
      </div>
      <p className="text-[11px] text-slate-400">Tap any indicator for its definition, current reading, and where to act. Leading signals are upstream of incidents; lagging signals are outcomes that already occurred.</p>
    </section>
  )
}
