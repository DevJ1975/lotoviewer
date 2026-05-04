'use client'

import Link from 'next/link'
import { RiskBandPill } from '@/components/ui/RiskBandPill'
import type { RiskSummary } from '@soteria/core/queries/risks'
import type { BandScheme } from '@soteria/core/risk'

// Read-only risk-row table. Used by:
//   - The "Top 5 by residual score" panel on the heat map page (compact).
//   - The /risk/list paginated table (full).
//
// Both consumers want the same column layout; the `compact` flag
// trims down padding/font-size for embedding in cards.

interface Props {
  risks:        RiskSummary[]
  compact?:     boolean
  bandScheme?:  BandScheme
  /**
   * Renders a "+ N more" footer link to the full list page when set.
   * Used by the "Top 5" embed on the heat map page.
   */
  moreUrl?:     string
  moreCount?:   number
}

export default function RiskTable({ risks, compact, bandScheme = '4-band', moreUrl, moreCount }: Props) {
  if (risks.length === 0) {
    return (
      <p className="text-xs italic text-slate-400 dark:text-slate-500 py-6 text-center">
        No risks match this filter.
      </p>
    )
  }

  const sizeCls = compact
    ? 'text-[12px] [&>tbody>tr>td]:py-1.5 [&>tbody>tr>td]:px-2 [&>thead>tr>th]:py-1.5 [&>thead>tr>th]:px-2'
    : 'text-sm  [&>tbody>tr>td]:py-2.5 [&>tbody>tr>td]:px-3 [&>thead>tr>th]:py-2 [&>thead>tr>th]:px-3'

  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse ${sizeCls}`}>
        <thead>
          <tr className="text-left border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <th>Risk #</th>
            <th>Title</th>
            <th>Category</th>
            <th>Inherent</th>
            <th>Residual</th>
            <th>Status</th>
            <th>Next review</th>
          </tr>
        </thead>
        <tbody>
          {risks.map(r => (
            <RiskRow key={r.id} risk={r} bandScheme={bandScheme} />
          ))}
        </tbody>
      </table>
      {moreUrl && (moreCount ?? 0) > risks.length && (
        <div className="mt-2 text-right">
          <Link href={moreUrl} className="text-xs font-semibold text-brand-navy hover:underline">
            View all {moreCount} →
          </Link>
        </div>
      )}
    </div>
  )
}

function RiskRow({ risk, bandScheme }: { risk: RiskSummary; bandScheme: BandScheme }) {
  const overdue = risk.next_review_date && new Date(risk.next_review_date) < new Date()
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td>
        <Link href={`/risk/${risk.id}`} className="font-mono text-xs font-semibold text-brand-navy hover:underline">
          {risk.risk_number}
        </Link>
      </td>
      <td>
        <Link href={`/risk/${risk.id}`} className="font-medium hover:underline">
          {risk.title}
        </Link>
      </td>
      <td className="capitalize text-slate-700 dark:text-slate-300">{risk.hazard_category}</td>
      <td>
        <RiskBandPill band={risk.inherent_band} score={risk.inherent_score} compact />
      </td>
      <td>
        {risk.residual_band ? (
          <RiskBandPill band={risk.residual_band} score={risk.residual_score} compact />
        ) : (
          <span className="text-[11px] text-slate-400 italic">— not scored</span>
        )}
      </td>
      <td>
        <StatusChip status={risk.status} />
      </td>
      <td className={overdue ? 'text-rose-700 font-semibold' : 'text-slate-600 dark:text-slate-300'}>
        {risk.next_review_date ?? '—'}
        {overdue && <span className="ml-1 text-[10px] uppercase tracking-wider">overdue</span>}
      </td>
    </tr>
  )
}

function StatusChip({ status }: { status: RiskSummary['status'] }) {
  const map: Record<RiskSummary['status'], { label: string; tone: string }> = {
    open:                  { label: 'Open',                  tone: 'bg-sky-100 text-sky-800' },
    in_review:             { label: 'In review',             tone: 'bg-violet-100 text-violet-800' },
    controls_in_progress:  { label: 'Controls WIP',          tone: 'bg-amber-100 text-amber-800' },
    monitoring:            { label: 'Monitoring',            tone: 'bg-emerald-100 text-emerald-800' },
    closed:                { label: 'Closed',                tone: 'bg-slate-100 text-slate-700' },
    accepted_exception:    { label: 'Accepted (exception)',  tone: 'bg-rose-100 text-rose-800' },
  }
  const { label, tone } = map[status]
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone}`}>{label}</span>
}
