import type { PermitRow } from './client'

// How the screens word a permit's place in its renewal cycle. The standing and
// the countdown come from packages/core/src/environmentalPermit.ts through the
// API; this only turns them into a label and a tone, so the card and the detail
// page cannot say different things.

export type PermitTone = 'neutral' | 'ok' | 'watch' | 'urgent'

export interface PermitCountdown { label: string; tone: PermitTone }

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

/** What a permit's renewal countdown says, and how loudly. */
export function permitCountdown(permit: Pick<PermitRow,
  'standing' | 'escalation' | 'renewal_deadline' | 'renewal_application_due_on' | 'renewal_submitted_on' | 'expires_on'>): PermitCountdown {
  const { standing, escalation, renewal_deadline: deadline } = permit
  switch (standing) {
    case 'retired':           return { label: 'Retired', tone: 'neutral' }
    case 'no_expiry':         return { label: 'No expiry', tone: 'neutral' }
    case 'renewal_submitted': return { label: `Renewal submitted ${permit.renewal_submitted_on ?? ''}`.trim(), tone: 'ok' }
    // Whether it stays in force while the agency reviews depends on the program and the agency.
    case 'expired_renewal_pending':
      return { label: 'Expired, renewal pending: confirm its status with the agency', tone: 'urgent' }
    case 'expired':           return { label: `Expired ${permit.expires_on ?? ''}`.trim(), tone: 'urgent' }
    case 'current':
    case 'renewal_due':
      break
  }
  if (deadline === null || escalation === null) return { label: 'No renewal date', tone: 'neutral' }
  const what = permit.renewal_application_due_on !== null ? 'Renewal application due' : 'Expires'
  if (escalation.tier === 'passed') {
    return { label: `${what} ${deadline}, ${days(Math.abs(escalation.daysLeft))} ago`, tone: 'urgent' }
  }
  const when = escalation.daysLeft === 0 ? 'today' : `in ${days(escalation.daysLeft)}`
  const tone: PermitTone = escalation.tier === 'none' ? 'ok' : escalation.tier === 180 ? 'watch' : 'urgent'
  return { label: `${what} ${deadline}, ${when}`, tone }
}

export const TONE_CLASS: Record<PermitTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  ok:      'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  watch:   'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  urgent:  'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
}

export const STANDING_LABEL: Record<PermitRow['standing'], string> = {
  retired:                 'Retired',
  no_expiry:               'No expiry',
  current:                 'Current',
  renewal_due:             'Renewal due',
  renewal_submitted:       'Renewal submitted',
  expired:                 'Expired',
  expired_renewal_pending: 'Expired, renewal pending',
}
