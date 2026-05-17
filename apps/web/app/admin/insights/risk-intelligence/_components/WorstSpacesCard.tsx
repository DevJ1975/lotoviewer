'use client'

import Link from 'next/link'
import { TrendingDown } from 'lucide-react'
import type { SpaceFailureRow } from '@soteria/core/insightsMetrics'

// Top spaces by atmospheric-test fail rate. The empty state matters here
// — a brand-new deployment with no permits in the window should explain
// why nothing's listed, not look broken.

export function WorstSpacesCard({ rows, windowDays }: {
  rows:       SpaceFailureRow[]
  windowDays: number
}) {
  // Show the worst N. More than 8 fights with the supervisor card next
  // to it visually; if there's a real outlier list, the user can drill
  // into the status board. We slice rather than scroll so the section
  // stays glance-friendly.
  const top = rows.slice(0, 8)

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <TrendingDown className="h-4 w-4 text-rose-600" />
          Spaces to investigate
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          last {windowDays}d · ranked by fail rate
        </span>
      </header>
      {top.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No spaces with enough tests to rank.</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Spaces need at least 5 tests in the window to appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {top.map(r => (
            <li key={r.space_id} className="py-2.5">
              <Link
                href={`/confined-spaces/${encodeURIComponent(r.space_id)}`}
                className="block hover:bg-slate-50 dark:hover:bg-slate-900/40 -mx-2 px-2 py-1 rounded-lg transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{r.space_id}</p>
                    {r.description && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{r.description}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-black tabular-nums ${
                      (r.failRatePct ?? 0) >= 30 ? 'text-rose-700 dark:text-rose-300'
                      : (r.failRatePct ?? 0) >= 10 ? 'text-amber-700 dark:text-amber-300'
                      : 'text-slate-700 dark:text-slate-300'
                    }`}>
                      {r.failRatePct ?? 0}%
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {r.failCount}/{r.totalTests} fail
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
