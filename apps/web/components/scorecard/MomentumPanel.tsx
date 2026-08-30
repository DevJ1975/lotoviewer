'use client'

import { Activity, TrendingUp } from 'lucide-react'
import {
  formatComparedMonths,
  MOM_MIN_COMBINED,
  type MonthOverMonthRow,
} from '@soteria/core/monthOverMonth'
import { MONTH_OVER_MONTH_EXCLUSIONS } from '@soteria/core/incidentScorecardMetrics'

// Month-over-month movement, split into the safety director's two lenses.
//
// Three deliberate choices, all of which make this panel quieter than a
// typical trend strip:
//
//  1. It compares the last two CLOSED calendar months. The current month is
//     never shown — a part-month against a whole one manufactures an
//     improvement on every render.
//  2. A move is coloured only when it falls outside control limits built from
//     the preceding months. Small programmes will see grey most of the time,
//     which is the honest reading, not a rendering failure.
//  3. It carries counts only. Monthly rates are not available (hours worked
//     are recorded annually), and saying so on the panel is better than
//     letting a reader assume a rate is hiding somewhere.

function toneClass(row: MonthOverMonthRow): string {
  if (!row.significant || row.tone === 'neutral') return 'text-slate-400'
  return row.tone === 'good'
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400'
}

function suppressionNote(row: MonthOverMonthRow): string | null {
  switch (row.suppressed) {
    case 'insufficient_events':
      return `too few events to compare (needs ${MOM_MIN_COMBINED} across both months)`
    case 'insufficient_history':
      return 'not enough closed months to know what normal looks like yet'
    case 'no_comparison_month':
      return 'no prior month to compare'
    default:
      return row.significant ? null : 'within normal variation'
  }
}

function Row({ row }: { row: MonthOverMonthRow }) {
  const note = suppressionNote(row)
  const arrow = row.direction === 'up' ? '↑' : row.direction === 'down' ? '↓' : '—'
  const showDelta = row.suppressed === null

  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {row.label}
        </span>
        {note && (
          <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">{note}</span>
        )}
      </span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="text-lg font-black tabular-nums text-slate-900 dark:text-slate-100">
          {row.current}
        </span>
        <span className="text-[11px] text-slate-400">was {row.previous}</span>
        {showDelta && (
          <span className={`text-xs font-bold tabular-nums ${toneClass(row)}`}>
            {row.direction === 'flat' ? '—' : `${arrow} ${Math.abs(row.delta)}`}
            {row.deltaPct !== null && row.direction !== 'flat' && (
              <span className="ml-1 font-semibold opacity-70">
                ({row.deltaPct > 0 ? '+' : ''}{row.deltaPct}%)
              </span>
            )}
          </span>
        )}
      </span>
    </li>
  )
}

function Group({ title, icon: Icon, rows }: {
  title: string
  icon: typeof Activity
  rows: MonthOverMonthRow[]
}) {
  return (
    <div className="ops-surface animate-panel-in rounded-lg p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/15 dark:text-brand-yellow">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{title}</h3>
      </div>
      <ul>{rows.map(r => <Row key={r.key} row={r} />)}</ul>
    </div>
  )
}

export function MomentumPanel({ mom }: {
  mom: {
    recordables:             MonthOverMonthRow
    allIncidents:            MonthOverMonthRow
    actionsCompleted:        MonthOverMonthRow
    investigationsCompleted: MonthOverMonthRow
  }
}) {
  const compared = formatComparedMonths(mom.recordables)

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="ops-section-title text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Month over month{compared ? ` · ${compared}` : ''}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Group title="Leading (preventive)" icon={TrendingUp}
          rows={[mom.actionsCompleted, mom.investigationsCompleted]} />
        <Group title="Lagging (outcomes)" icon={Activity}
          rows={[mom.recordables, mom.allIncidents]} />
      </div>

      <div className="space-y-1 text-[11px] text-slate-400 dark:text-slate-500">
        <p>
          Compares the last two <strong>complete</strong> calendar months (UTC, by date of
          occurrence — not date reported). The current month is excluded while it is still
          running, because a partial month always looks like an improvement.
        </p>
        <p>
          <strong>Case counts, not rates.</strong> Monthly rates are not available: hours worked
          are recorded annually, so a monthly numerator has no matching denominator.
        </p>
        <p>
          A change is coloured only when it falls outside the control limits set by this
          tenant&apos;s own preceding months. Grey means the move is inside normal variation, or
          that there are too few events to tell — not that nothing happened.
        </p>
        {MONTH_OVER_MONTH_EXCLUSIONS.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer font-semibold text-slate-500 hover:text-brand-navy dark:text-slate-400">
              Why some metrics are not shown here ({MONTH_OVER_MONTH_EXCLUSIONS.length})
            </summary>
            <ul className="mt-1 space-y-1 pl-4">
              {MONTH_OVER_MONTH_EXCLUSIONS.map(x => (
                <li key={x.metric} className="list-disc">
                  <strong>{x.metric}</strong> — {x.blocker}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}
