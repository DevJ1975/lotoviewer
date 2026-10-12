'use client'

import { AlertTriangle } from 'lucide-react'
import { VerifyNote } from '@/components/environmental/badges'
import type { MonitoringSummaryResponse } from '@/lib/environmental/monitoringClient'
import { exceedanceCards, outfallName } from '@/lib/environmental/monitoringView'
import { EXCEEDANCE_CLASS_LABELS, type ExceedanceClass } from '@soteria/core/environmental/monitoring'
import { cn } from '@/lib/utils'

// The reporting year at a glance: how many times each CLASS of limit was exceeded, in its own
// card. A permit or local limit and a benchmark or action level are different things, so they
// are never one number; the accent colour repeats the difference the words already make.

const CARD_ACCENT: Readonly<Record<ExceedanceClass, string>> = {
  limit:    'border-l-rose-500',
  action:   'border-l-amber-500',
  internal: 'border-l-slate-400',
}

interface Props {
  view:     MonitoringSummaryResponse
  outfalls: readonly { id: string; code: string }[]
}

const th = 'px-3 py-2 font-semibold'
const td = 'px-3 py-2'

export function SummaryStrip({ view, outfalls }: Props) {
  const { summary, reporting_year_basis: basis, truncated } = view
  const { reportingYear: year } = summary
  const cards = exceedanceCards(summary.totals)
  const showInternal = cards.some(card => card.exceedanceClass === 'internal')

  return (
    <section aria-labelledby="monitoring-summary" className="space-y-3">
      <div className="space-y-1">
        <h2 id="monitoring-summary" className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Exceedances this reporting year
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Reporting year {year.label}: {year.reportingYearStart} to {year.reportingYearEnd} (UTC days).
        </p>
        <VerifyNote note={basis.verify} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => (
          <div
            key={card.exceedanceClass}
            role="group"
            aria-labelledby={`exceedances-${card.exceedanceClass}`}
            className={cn('rounded-lg border border-l-4 border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950', CARD_ACCENT[card.exceedanceClass])}
          >
            <p className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{card.count}</p>
            <p id={`exceedances-${card.exceedanceClass}`} className="text-sm font-semibold text-slate-800 dark:text-slate-200">{card.label}</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{card.explanation}</p>
          </div>
        ))}
      </div>

      {truncated && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This reporting year has more results than could be read, so these counts may be low. Narrow the year or ask an administrator to review the records.</span>
        </p>
      )}

      {summary.subjects.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <caption className="sr-only">Exceedances this reporting year, by outfall</caption>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th scope="col" className={th}>Outfall</th>
                <th scope="col" className={th}>{EXCEEDANCE_CLASS_LABELS.limit}</th>
                <th scope="col" className={th}>{EXCEEDANCE_CLASS_LABELS.action}</th>
                {showInternal && <th scope="col" className={th}>{EXCEEDANCE_CLASS_LABELS.internal}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {summary.subjects.map(subject => (
                <tr key={subject.outfallId ?? 'site'} className="bg-white dark:bg-slate-950">
                  <th scope="row" className={`${td} text-left font-mono font-semibold text-slate-900 dark:text-slate-100`}>{outfallName(subject.outfallId, outfalls)}</th>
                  <td className={`${td} tabular-nums`}>{subject.counts.limit}</td>
                  <td className={`${td} tabular-nums`}>{subject.counts.action}</td>
                  {showInternal && <td className={`${td} tabular-nums`}>{subject.counts.internal}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
