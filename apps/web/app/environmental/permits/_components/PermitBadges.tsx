import { permitCountdown, TONE_CLASS } from '@/lib/environmental/permitDisplay'
import type { PermitRow } from '@/lib/environmental/client'

const PILL = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold'

/** The renewal countdown, in words, coloured by how close the deadline is. */
export function RenewalBadge({ permit }: { permit: PermitRow }) {
  const { label, tone } = permitCountdown(permit)
  return <span className={`${PILL} ${TONE_CLASS[tone]}`}>{label}</span>
}

/** Red when the holder of record is not the legal entity the scope names; says nothing when there is no scope yet. */
export function HolderMismatchBadge({ permit }: { permit: PermitRow }) {
  if (permit.holder_mismatch !== true) return null
  return <span className={`${PILL} ${TONE_CLASS.urgent}`}>Holder mismatch</span>
}

export function BusinessCriticalBadge({ permit }: { permit: PermitRow }) {
  if (!permit.business_critical) return null
  return <span className={`${PILL} ${TONE_CLASS.watch}`}>Business-critical</span>
}
