'use client'

import { Plus, Edit2, Trash2 } from 'lucide-react'
import type { RiskAuditEntry } from '@soteria/core/queries/risks'

// Append-only audit log for a single risk. Each entry shows actor +
// timestamp + a one-line diff summary computed in the queries layer
// from the before/after row JSON. The audit_log table itself is
// immutable (DB-enforced; see migration 038).

interface Props {
  entries: RiskAuditEntry[]
}

const TYPE_ICONS = {
  insert: { Icon: Plus,   tone: 'text-emerald-700 bg-emerald-100' },
  update: { Icon: Edit2,  tone: 'text-sky-800     bg-sky-100' },
  delete: { Icon: Trash2, tone: 'text-rose-800    bg-rose-100' },
} as const

export default function AuditTimeline({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <p className="text-xs italic text-slate-400 dark:text-slate-500 py-4 text-center">
        No audit entries yet.
      </p>
    )
  }
  return (
    <ol className="space-y-2">
      {entries.map(e => {
        const meta = TYPE_ICONS[e.event_type]
        const { Icon } = meta
        return (
          <li key={e.id} className="flex items-start gap-3 text-sm">
            <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${meta.tone}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-slate-800 dark:text-slate-200 break-words">
                {e.summary}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {e.actor_email ?? e.actor_id ?? 'system'}
                {' · '}
                {new Date(e.occurred_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {e.context && ` · via ${e.context}`}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
