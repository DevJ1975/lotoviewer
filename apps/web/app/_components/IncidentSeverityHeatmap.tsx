'use client'

import {
  type BodyPartBucket,
  type ShiftDayBucket,
} from '@soteria/core/incidentScorecardMetrics'

// Two heatmaps stacked: body-part counts on the left, day-of-week ×
// shift on the right. Both consume buckets produced by the
// scorecard summarizer; rendering is plain HTML/Tailwind so the
// component stays SSR-safe.
//
// Body-part rendering is keyword-based rather than an SVG silhouette
// — Phase 5 ships the data; a proper anatomical SVG ships in Phase 6
// with the lessons-learned library.

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const SHIFT_ORDER: Array<'day' | 'swing' | 'night' | 'unknown'> = ['day', 'swing', 'night', 'unknown']
const SHIFT_LABEL: Record<typeof SHIFT_ORDER[number], string> = {
  day: 'Day', swing: 'Swing', night: 'Night', unknown: 'Unknown',
}

interface Props {
  bodyParts: ReadonlyArray<BodyPartBucket>
  shiftDay:  ReadonlyArray<ShiftDayBucket>
}

export default function IncidentSeverityHeatmap({ bodyParts, shiftDay }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <BodyPartCard buckets={bodyParts} />
      <ShiftDayCard buckets={shiftDay} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────

function BodyPartCard({ buckets }: { buckets: ReadonlyArray<BodyPartBucket> }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0)
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
        Body parts injured
      </h3>
      {buckets.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No injured-person body-part data yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {buckets.slice(0, 12).map(b => {
            const pct = max ? (b.count / max) * 100 : 0
            return (
              <li key={b.body_part} className="flex items-center gap-2">
                <span className="w-32 text-[11px] text-slate-700 dark:text-slate-300 truncate">
                  {humaniseBodyPart(b.body_part)}
                </span>
                <div className="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-3 bg-rose-500 dark:bg-rose-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-6 text-right text-[11px] font-mono text-slate-600 dark:text-slate-300">{b.count}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function humaniseBodyPart(slug: string): string {
  // 'hand_right' → 'Hand (right)'; 'back_lower' → 'Lower back'.
  const parts = slug.replace(/_/g, ' ').split(' ')
  if (parts.length === 2) {
    const [a, b] = parts
    if (b === 'left' || b === 'right') {
      return `${cap(a!)} (${b})`
    }
    if (a === 'lower' || a === 'upper') {
      return `${cap(a)} ${b}`
    }
  }
  return parts.map(cap).join(' ')
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

// ──────────────────────────────────────────────────────────────────────────

function ShiftDayCard({ buckets }: { buckets: ReadonlyArray<ShiftDayBucket> }) {
  // Build a 4×7 grid keyed by (shift, weekday).
  const cellByKey = new Map<string, number>()
  for (const b of buckets) {
    cellByKey.set(`${b.shift}|${b.weekday}`, b.count)
  }
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0)

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
        Day of week × shift
      </h3>
      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] gap-0.5">
        <div />
        {WEEKDAY_LABELS.map(d => (
          <div key={d} className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center">{d}</div>
        ))}
        {SHIFT_ORDER.map(s => (
          <div key={s} className="contents">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 self-center">
              {SHIFT_LABEL[s]}
            </div>
            {WEEKDAY_LABELS.map((_, w) => {
              const v = cellByKey.get(`${s}|${w}`) ?? 0
              const intensity = max ? Math.min(1, v / max) : 0
              const bg = v === 0
                ? 'rgba(241,245,249,1)'      // slate-100 baseline (light)
                : `rgba(190,18,60,${0.15 + intensity * 0.7})`   // rose-700 with alpha
              return (
                <div
                  key={s + w}
                  title={v > 0 ? `${v} incident${v === 1 ? '' : 's'}` : 'no incidents'}
                  className="aspect-square rounded text-[10px] font-mono flex items-center justify-center text-slate-700 dark:text-slate-200"
                  style={{ backgroundColor: bg }}
                >
                  {v > 0 ? v : ''}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
