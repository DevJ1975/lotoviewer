'use client'

import {
  HAZARD_CONTROL_HIERARCHY,
  HAZARD_CONTROL_LABEL,
  summarizeControls,
  type HazardControlHierarchyLevel,
} from '@soteria/core/hazardControls'

// Stacked-bar + labeled-list summary of a risk's controls by ISO 45001
// 8.1.2 hierarchy level. Drives the "is this risk healthy?" visual on
// the risk detail page — a PPE-only stack signals the org is taking
// the easy route; an Eliminate/Substitute-heavy stack signals the
// opposite.

interface Props {
  controls: { hierarchy_level: string }[]
}

const TONE: Record<HazardControlHierarchyLevel, string> = {
  eliminate:      'bg-emerald-600',
  substitute:     'bg-emerald-500',
  engineering:    'bg-amber-500',
  administrative: 'bg-amber-400',
  ppe:            'bg-rose-500',
}

const TOP_TONE: Record<HazardControlHierarchyLevel, string> = {
  eliminate:      'text-emerald-700 dark:text-emerald-300',
  substitute:     'text-emerald-700 dark:text-emerald-300',
  engineering:    'text-amber-700 dark:text-amber-300',
  administrative: 'text-amber-700 dark:text-amber-300',
  ppe:            'text-rose-700 dark:text-rose-300',
}

export default function ControlsHierarchySummary({ controls }: Props) {
  const summary = summarizeControls(controls)
  if (summary.total === 0) {
    return (
      <p className="text-xs italic text-slate-500 dark:text-slate-400">
        No controls yet. Add at least one to declare your mitigation strategy.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Top of stack:
        </span>
        {summary.topOfStack && (
          <span className={`text-sm font-semibold ${TOP_TONE[summary.topOfStack]}`}>
            {HAZARD_CONTROL_LABEL[summary.topOfStack]}
          </span>
        )}
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          {summary.total} control{summary.total === 1 ? '' : 's'}
        </span>
      </div>

      {/* Horizontal stacked bar — proportional widths per level. */}
      <div className="flex h-3 w-full rounded overflow-hidden bg-slate-100 dark:bg-slate-800">
        {HAZARD_CONTROL_HIERARCHY.map(level => {
          const count = summary.counts[level]
          if (count === 0) return null
          const widthPct = (count / summary.total) * 100
          return (
            <div
              key={level}
              className={TONE[level]}
              style={{ width: `${widthPct}%` }}
              title={`${HAZARD_CONTROL_LABEL[level]}: ${count}`}
            />
          )
        })}
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
        {HAZARD_CONTROL_HIERARCHY.map(level => (
          <li key={level} className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded ${TONE[level]}`} />
            <span className="text-slate-600 dark:text-slate-400">
              {HAZARD_CONTROL_LABEL[level]}
            </span>
            <span className="ml-auto font-semibold tabular-nums text-slate-700 dark:text-slate-300">
              {summary.counts[level]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
