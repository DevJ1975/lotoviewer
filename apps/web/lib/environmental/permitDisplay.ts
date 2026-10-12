import type { PermitRow } from './client'

// How the screens word a permit's place in its renewal cycle. The standing and
// the countdown come from packages/core/src/environmentalPermit.ts through the
// API; this only turns them into a label and a tone, so the card and the detail
// page cannot say different things. The platform knows what was recorded, not
// what is legally in force, so the wording says "recorded" and never "valid".

export type PermitTone = 'neutral' | 'ok' | 'watch' | 'urgent'

export interface PermitCountdown {
  label: string
  tone: PermitTone
  /** A sentence to show beside the label, for a state the platform cannot settle itself. */
  note?: string
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

type CountdownInput = Pick<PermitRow,
  'standing' | 'escalation' | 'renewal_deadline' | 'renewal_application_due_on' | 'renewal_submitted_on' | 'expires_on'>

/** What a permit's renewal countdown says, and how loudly. */
export function permitCountdown(permit: CountdownInput): PermitCountdown {
  const { standing, escalation, renewal_deadline: deadline } = permit
  switch (standing) {
    case 'retired':           return { label: 'Retired', tone: 'neutral' }
    case 'no_expiry':         return { label: 'No expiry date recorded', tone: 'neutral' }
    case 'renewal_submitted': return { label: submittedLabel(permit), tone: submittedIsLate(permit) ? 'urgent' : 'watch' }
    // Whether it stays in force while the agency reviews depends on the program and the agency.
    case 'expired_renewal_pending':
      return { label: 'Past its recorded expiry, renewal pending', tone: 'urgent', note: 'Confirm its status with the agency.' }
    case 'expired':           return { label: `Past its recorded expiry ${permit.expires_on ?? ''}`.trim(), tone: 'urgent' }
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
  // The tiers match the register light: a deadline within 90 days turns it amber, within 30 days is the loudest warning.
  const tone: PermitTone = escalation.tier === 'none' || escalation.tier === 180 ? 'neutral'
    : escalation.tier === 90 ? 'watch' : 'urgent'
  return { label: `${what} ${deadline}, ${when}`, tone }
}

/** A submission dated after the permit's own renewal-application date. */
function submittedIsLate(permit: CountdownInput): boolean {
  return permit.renewal_submitted_on !== null && permit.renewal_application_due_on !== null
    && permit.renewal_submitted_on > permit.renewal_application_due_on
}

// The date is the user's word: nothing here has seen the receipt, so the pill is not green.
function submittedLabel(permit: CountdownInput): string {
  const submitted = `Renewal submitted ${permit.renewal_submitted_on ?? ''}`.trim()
  return submittedIsLate(permit) ? `${submitted}, after the ${permit.renewal_application_due_on} due date` : submitted
}

export const TONE_CLASS: Record<PermitTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  ok:      'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  watch:   'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  urgent:  'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
}

export const STANDING_LABEL: Record<PermitRow['standing'], string> = {
  retired:                 'Retired',
  no_expiry:               'No expiry date recorded',
  current:                 'Renewal not yet due',
  renewal_due:             'Renewal due',
  renewal_submitted:       'Renewal submitted',
  expired:                 'Past its recorded expiry',
  expired_renewal_pending: 'Past its recorded expiry, renewal pending',
}
