'use client'

import { HIERARCHY_LABELS, HIERARCHY_ORDER, type HierarchyLevel } from '@soteria/core/risk'
import type { RiskControl } from '@soteria/core/queries/risks'

// Read-only controls list per risk. Slice 3's wizard ships the
// editor; slice 2 just renders what's there + flags PPE-alone
// situations inline.

interface Props {
  controls:                RiskControl[]
  inherentScore:           number
  ppeOnlyJustification:    string | null
}

const STATUS_TONES: Record<RiskControl['status'], string> = {
  planned:     'bg-slate-100 text-slate-700',
  implemented: 'bg-sky-100 text-sky-800',
  verified:    'bg-emerald-100 text-emerald-800',
  superseded:  'bg-zinc-100 text-zinc-600 line-through',
}

export default function ControlsTable({ controls, inherentScore, ppeOnlyJustification }: Props) {
  if (controls.length === 0) {
    return (
      <p className="text-xs italic text-slate-400 dark:text-slate-500 py-4 text-center">
        No controls documented yet. Use the wizard (coming in slice 3) or PATCH the risk to attach controls.
      </p>
    )
  }

  const hasNonPpe = controls.some(c => c.hierarchy_level !== 'ppe')
  const ppeOnlyCase = inherentScore >= 8 && controls.length > 0 && !hasNonPpe

  // Group by hierarchy level for cleaner display.
  const grouped = HIERARCHY_ORDER.map(level => ({
    level,
    items: controls.filter(c => c.hierarchy_level === level),
  })).filter(g => g.items.length > 0)

  return (
    <div className="space-y-3">
      {ppeOnlyCase && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-bold uppercase tracking-wider mb-1">PPE-alone control set · ISO 45001 8.1.2</div>
          {ppeOnlyJustification ? (
            <p className="whitespace-pre-wrap">{ppeOnlyJustification}</p>
          ) : (
            <p className="italic">No justification on file. Document why higher-level controls are not feasible.</p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="py-2 px-2">Hierarchy</th>
              <th className="py-2 px-2">Control</th>
              <th className="py-2 px-2">Status</th>
              <th className="py-2 px-2">Implemented</th>
              <th className="py-2 px-2">Verified</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(group =>
              group.items.map((c, idx) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  <td className="py-2 px-2 align-top">
                    {idx === 0 && (
                      <HierarchyBadge level={c.hierarchy_level} />
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      {c.library_name ?? c.custom_name ?? '(unnamed)'}
                    </div>
                    {c.notes && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.notes}</div>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONES[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-xs text-slate-600 dark:text-slate-300">
                    {c.implemented_at ? new Date(c.implemented_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-2 px-2 text-xs text-slate-600 dark:text-slate-300">
                    {c.verified_at ? new Date(c.verified_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HierarchyBadge({ level }: { level: HierarchyLevel }) {
  const tone: Record<HierarchyLevel, string> = {
    elimination:    'bg-emerald-100 text-emerald-800',
    substitution:   'bg-teal-100 text-teal-800',
    engineering:    'bg-sky-100 text-sky-800',
    administrative: 'bg-amber-100 text-amber-800',
    ppe:            'bg-rose-100 text-rose-800',
  }
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone[level]}`}>
      {HIERARCHY_LABELS[level]}
    </span>
  )
}
