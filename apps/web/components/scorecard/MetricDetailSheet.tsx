'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, X } from 'lucide-react'
import {
  Drawer, DrawerContent, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer'
import type { MetricDetail, MetricTone } from './metricDetail'

// Tableau-style drill-down sheet. Bound to useMetricDrill: when a user taps any
// scorecard graphic, the page passes that metric's MetricDetail here and a
// bottom-sheet (touch) / centered panel slides up with the underlying numbers,
// the definition + formula, supporting stats, and a plain-language explanation
// of what it means and where to act. `extra` lets a call site inject metric-
// specific charts (distribution / forecast) into the sheet body.

const TONE_TEXT: Record<MetricTone, string> = {
  safe:     'text-emerald-600 dark:text-emerald-400',
  watch:    'text-amber-600 dark:text-amber-400',
  critical: 'text-rose-600 dark:text-rose-400',
  neutral:  'text-slate-900 dark:text-slate-100',
}
const TONE_CHIP: Record<MetricTone, string> = {
  safe:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  watch:    'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  neutral:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

export function MetricDetailSheet({ detail, onClose, extra }: {
  detail: MetricDetail | null
  onClose: () => void
  /** Optional metric-specific charts rendered in the sheet body. */
  extra?: ReactNode
}) {
  const tone = detail?.tone ?? 'neutral'
  return (
    <Drawer open={detail !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DrawerContent className="max-h-[88vh] dark:bg-slate-900">
        {detail && (
          <div className="mx-auto flex w-full max-w-2xl flex-col overflow-y-auto px-5 pb-8 pt-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {detail.category && (
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TONE_CHIP[tone]}`}>
                    {detail.category}
                  </span>
                )}
                <DrawerTitle className="mt-1.5 truncate text-lg font-black text-slate-900 dark:text-slate-50">
                  {detail.title}
                </DrawerTitle>
              </div>
              <button
                onClick={onClose}
                aria-label="Close detail"
                className="motion-press flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex items-end gap-3">
              <span className={`text-4xl font-black tabular-nums leading-none ${TONE_TEXT[tone]}`}>{detail.value}</span>
              {detail.target && <span className="pb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{detail.target}</span>}
            </div>

            <DrawerDescription className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {detail.definition}
            </DrawerDescription>

            {detail.formula && (
              <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                {detail.formula}
              </p>
            )}

            {detail.stats && detail.stats.length > 0 && (
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {detail.stats.map(s => (
                  <div key={s.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/50">
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{s.label}</dt>
                    <dd className="mt-0.5 text-base font-black tabular-nums text-slate-900 dark:text-slate-100">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {extra && <div className="mt-5">{extra}</div>}

            <div className="mt-5 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">What this means</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{detail.narrative}</p>
            </div>

            {detail.href && (
              <Link
                href={detail.href}
                className="motion-press mt-4 inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-brand-navy px-3.5 py-2 text-sm font-bold text-white hover:bg-brand-navy/90 dark:bg-brand-yellow dark:text-slate-950"
              >
                {detail.hrefLabel ?? 'Open module'} <ArrowUpRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}
