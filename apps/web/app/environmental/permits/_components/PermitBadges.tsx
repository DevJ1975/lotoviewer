import { permitCountdown, TONE_CLASS } from '@/lib/environmental/permitDisplay'
import type { PermitRow } from '@/lib/environmental/client'

const PILL = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold'

/** The renewal countdown, in words, coloured by how close the deadline is. */
export function RenewalBadge({ permit }: { permit: PermitRow }) {
  const { label, tone, note } = permitCountdown(permit)
  return (
    <>
      <span className={`${PILL} ${TONE_CLASS[tone]}`}>{label}</span>
      {note && <span className="basis-full text-[11px] text-slate-600 dark:text-slate-400">{note}</span>}
    </>
  )
}

/** Red when the holder of record is not the legal entity the scope names; says nothing when there is no scope yet. */
export function HolderMismatchBadge({ permit }: { permit: PermitRow }) {
  if (permit.holder_mismatch !== true) return null
  return <span className={`${PILL} ${TONE_CLASS.urgent}`}>Holder mismatch</span>
}

export function BusinessCriticalBadge({ permit }: { permit: PermitRow }) {
  if (!permit.business_critical) return null
  // A label, not a warning: amber is reserved for what needs doing.
  return <span className={`${PILL} border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200`}>Business-critical</span>
}
