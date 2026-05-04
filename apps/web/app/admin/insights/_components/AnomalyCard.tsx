'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import type { ReadingAnomaly } from '@/lib/insightsMetrics'

const CHANNEL_LABEL: Record<ReadingAnomaly['channel'], string> = {
  o2:  'O₂',
  lel: 'LEL',
  h2s: 'H₂S',
  co:  'CO',
}

const CHANNEL_UNIT: Record<ReadingAnomaly['channel'], string> = {
  o2:  '%',
  lel: '%',
  h2s: 'ppm',
  co:  'ppm',
}

// Atmospheric readings that are statistically unusual for the space they
// came from. A "high" anomaly is |z| ≥ 3σ — those need immediate review
// (unusual reading, miscalibrated meter, or process issue). "Moderate"
// is 2σ ≤ |z| < 3σ — interesting, worth a glance.

export function AnomalyCard({ anomalies, windowDays }: {
  anomalies:  ReadingAnomaly[]
  windowDays: number
}) {
  // Cap so we don't render hundreds of rows on a noisy site. The
  // expected steady-state is < 5 anomalies in a healthy 90-day window.
  const top = anomalies.slice(0, 12)

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          Unusual readings
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          last {windowDays}d · |z| ≥ 2 vs space baseline
        </span>
      </header>
      {top.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No unusual readings detected.</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Spaces need at least 8 historical tests for a baseline. New spaces won&apos;t appear here yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {top.map(a => {
            const direction = (a.zScore ?? 0) < 0 ? 'low' : 'high'
            const directionWord = a.channel === 'o2'
              ? (direction === 'low' ? 'low' : 'high')   // O₂ low is dangerous; O₂ high is rare
              : (direction === 'low' ? 'low' : 'high')
            return (
              <li
                key={`${a.testId}:${a.channel}`}
                className={`rounded-lg border ${
                  a.severity === 'high'
                    ? 'border-rose-200 bg-rose-50/60 dark:bg-rose-950/40/60'
                    : 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/40/60'
                } px-3 py-2`}
              >
                <Link
                  href={`/confined-spaces/${encodeURIComponent(a.spaceId)}/permits/${a.permitId}`}
                  className="block hover:opacity-90 transition-opacity"
                >
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                        {a.spaceId} · {CHANNEL_LABEL[a.channel]}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {new Date(a.testedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold tabular-nums ${
                        a.severity === 'high'
                          ? 'text-rose-700 dark:text-rose-300'
                          : 'text-amber-700 dark:text-amber-300'
                      }`}>
                        {a.value}{CHANNEL_UNIT[a.channel]}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                        z = {(a.zScore ?? 0).toFixed(1)} ({directionWord})
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    Space mean {a.baselineMean?.toFixed(1) ?? '—'}{CHANNEL_UNIT[a.channel]}, σ {a.baselineStd?.toFixed(2) ?? '—'}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {anomalies.length > top.length && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 text-right pt-1">
          {anomalies.length - top.length} more not shown.
        </p>
      )}
    </section>
  )
}
