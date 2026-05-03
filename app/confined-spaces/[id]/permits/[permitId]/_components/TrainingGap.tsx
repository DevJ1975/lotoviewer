'use client'

import type { TrainingIssue } from '@/lib/trainingRecords'

// Renders inside the pending-signature card when validateTraining
// surfaced any missing or expired records. Lists each (name, slot,
// status) row + a checkbox the supervisor flips to acknowledge they
// verified training off-app. Without that ack, the sign button stays
// disabled.

export function TrainingGap({
  issues, acknowledged, onAcknowledge,
}: {
  issues:        TrainingIssue[]
  acknowledged:  boolean
  onAcknowledge: (next: boolean) => void
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-1.5">
      <p className="text-[11px] font-bold text-amber-900 dark:text-amber-100">
        §1910.146(g) — training records not on file
      </p>
      <ul className="text-[11px] text-amber-900/85 dark:text-amber-100/85 space-y-0.5">
        {issues.map((i, idx) => (
          <li key={`${i.worker_name}:${i.slot}:${idx}`}>
            • <span className="font-semibold">{i.worker_name}</span>
            {' '}({i.slot})
            {' — '}
            {i.kind === 'missing'
              ? 'no training record'
              : <>cert expired{i.expired_on ? ` ${i.expired_on}` : ''}</>}
          </li>
        ))}
      </ul>
      <label className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-100 pt-1 cursor-pointer">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={e => onAcknowledge(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I have verified each worker's training off-app and accept responsibility for authorizing
          entry. (The audit log records this acknowledgement on the permit.)
        </span>
      </label>
    </div>
  )
}
