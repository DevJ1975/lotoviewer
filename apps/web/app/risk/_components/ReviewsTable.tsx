'use client'

import type { RiskReviewRow } from '@soteria/core/queries/risks'

// Read-only review history for a risk. Slice 2 surfaces this on the
// detail page; the "Mark reviewed" admin action posts to
// /api/risk/[id]/reviews and the page refetches.

interface Props {
  reviews: RiskReviewRow[]
}

const TRIGGER_LABELS: Record<RiskReviewRow['trigger'], string> = {
  cadence:        'Cadence',
  incident:       'Incident',
  moc:            'MOC',
  audit:          'Audit',
  worker_report:  'Worker report',
  regulatory:     'Regulatory',
  manual:         'Manual',
}

const OUTCOME_LABELS: Record<RiskReviewRow['outcome'], { label: string; tone: string }> = {
  no_change:        { label: 'No change',       tone: 'bg-slate-100 text-slate-700' },
  rescored:         { label: 'Re-scored',       tone: 'bg-violet-100 text-violet-800' },
  controls_updated: { label: 'Controls updated',tone: 'bg-sky-100 text-sky-800' },
  closed:           { label: 'Closed',          tone: 'bg-emerald-100 text-emerald-800' },
  escalated:        { label: 'Escalated',       tone: 'bg-rose-100 text-rose-800' },
}

export default function ReviewsTable({ reviews }: Props) {
  if (reviews.length === 0) {
    return (
      <p className="text-xs italic text-slate-400 dark:text-slate-500 py-4 text-center">
        No reviews recorded yet.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <th className="py-2 px-2">When</th>
            <th className="py-2 px-2">Trigger</th>
            <th className="py-2 px-2">Outcome</th>
            <th className="py-2 px-2">Inherent → Residual</th>
            <th className="py-2 px-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map(r => {
            const outcome = OUTCOME_LABELS[r.outcome]
            return (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 px-2 align-top whitespace-nowrap">
                  {new Date(r.reviewed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
                <td className="py-2 px-2 align-top">{TRIGGER_LABELS[r.trigger]}</td>
                <td className="py-2 px-2 align-top">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${outcome.tone}`}>
                    {outcome.label}
                  </span>
                </td>
                <td className="py-2 px-2 align-top text-xs font-mono text-slate-600 dark:text-slate-300">
                  {r.inherent_score_at_review ?? '—'} → {r.residual_score_at_review ?? '—'}
                </td>
                <td className="py-2 px-2 align-top text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                  {r.notes ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
