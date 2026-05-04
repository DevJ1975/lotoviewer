'use client'

import { useMemo } from 'react'
import { bandFor, colorFor, scoreRisk, SEVERITY_LABELS, LIKELIHOOD_LABELS, type Severity, type Likelihood, type BandScheme } from '@soteria/core/risk'

// 5×5 risk matrix grid. Pure presentational — gets cells data and a
// click handler; doesn't fetch or mutate anything itself.
//
// Layout:
//   Y axis (top → bottom) = Likelihood (5 → 1, "Almost Certain" first)
//   X axis (left → right) = Severity   (1 → 5, "Negligible" first)
//
// Each cell shows the score (S × L) + the count of risks at that
// score. Cells with count > 0 are interactive (click to drill into
// the list view filtered to that score). The band coloring uses
// colorFor() which is the same source the RiskBandPill uses.

interface Props {
  /** Cell counts keyed "S,L" (severity, likelihood). Missing = 0. */
  cells:        Record<string, number>
  /** 4-band default; collapse extreme→high when tenant prefers 3-band. */
  bandScheme?:  BandScheme
  onCellClick?: (severity: Severity, likelihood: Likelihood) => void
  /** Highlights one cell — used when a drill-down panel is open. */
  selected?:    { severity: Severity; likelihood: Likelihood } | null
}

export default function HeatMapGrid({ cells, bandScheme = '4-band', onCellClick, selected }: Props) {
  // Render top-down so likelihood=5 is at the top per the PDD §4.4
  // matrix layout.
  const rows: Likelihood[] = [5, 4, 3, 2, 1]
  const cols: Severity[]   = [1, 2, 3, 4, 5]

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 mx-auto">
        <thead>
          <tr>
            <th className="w-20" aria-hidden />
            {cols.map(s => (
              <th
                key={`hdr-${s}`}
                className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 px-1 py-1 text-center min-w-[110px]"
              >
                <span className="block opacity-60">{s}</span>
                <span className="block">{SEVERITY_LABELS[s - 1]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(l => (
            <tr key={`row-${l}`}>
              <th
                scope="row"
                className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 px-1 py-1 text-right pr-2"
              >
                <span className="block">{LIKELIHOOD_LABELS[l - 1]}</span>
                <span className="block opacity-60">{l}</span>
              </th>
              {cols.map(s => (
                <Cell
                  key={`cell-${s}-${l}`}
                  severity={s}
                  likelihood={l}
                  count={cells[`${s},${l}`] ?? 0}
                  bandScheme={bandScheme}
                  onClick={onCellClick}
                  isSelected={selected?.severity === s && selected?.likelihood === l}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface CellProps {
  severity:   Severity
  likelihood: Likelihood
  count:      number
  bandScheme: BandScheme
  onClick?:   (s: Severity, l: Likelihood) => void
  isSelected: boolean
}

function Cell({ severity, likelihood, count, bandScheme, onClick, isSelected }: CellProps) {
  const score   = scoreRisk(severity, likelihood)
  const band    = bandFor(score, bandScheme)
  const display = useMemo(() => colorFor(band), [band])
  const interactive = count > 0 && onClick != null

  // Text contrast already comes from display.textClass. Pattern
  // overlay is layered via display.pattern; the solid Tailwind
  // bg sits underneath.
  const baseClass = `relative h-20 w-full rounded-md flex flex-col items-center justify-center transition-all ${display.tailwind} ${display.pattern} ${display.textClass}`
  const interactiveClass = interactive
    ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-brand-navy/50 hover:scale-[1.02]'
    : 'cursor-default opacity-90'
  const selectedClass = isSelected ? 'ring-2 ring-offset-2 ring-brand-navy' : ''

  return (
    <td className="p-0 align-middle">
      <button
        type="button"
        disabled={!interactive}
        onClick={interactive ? () => onClick!(severity, likelihood) : undefined}
        className={`${baseClass} ${interactiveClass} ${selectedClass}`}
        aria-label={`Score ${score}, ${display.label} band, ${count} ${count === 1 ? 'risk' : 'risks'}`}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
          {display.label}
        </span>
        <span className="text-2xl font-bold leading-none mt-1" aria-hidden>
          {count}
        </span>
        <span className="text-[10px] font-mono opacity-80 mt-1" aria-hidden>
          score {score}
        </span>
      </button>
    </td>
  )
}
