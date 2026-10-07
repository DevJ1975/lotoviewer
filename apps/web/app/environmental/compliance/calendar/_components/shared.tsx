import Link from 'next/link'
import type { ComponentProps } from 'react'
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, Clock, ListChecks, type LucideIcon } from 'lucide-react'
import { StatusChip } from '@/components/environmental/badges'
import { secondaryButtonCls } from '@/components/environmental/form'
import type { Deadline } from '@/lib/environmental/client'
import {
  canCompleteDeadline, checklistHref, ORIGIN_LABELS, originOf, programLabel,
  type Actor, type UrgencyBucket,
} from '@/lib/environmental/calendarView'

// What the calendar's list, month grid and dialogs share: the context they are
// drawn in, how an urgency looks, and the two actions both a row and the detail
// dialog offer.

export interface ViewContext {
  /** The viewer's today, from localToday. */
  now:        Date
  actor:      Actor
  ownerNames: ReadonlyMap<string, string>
  siteNames:  ReadonlyMap<string, string>
  /** The all-sites roll-up mixes sites, so each deadline says which one it is for. */
  showSite:   boolean
  /** Library deadline id to the checklist that completes it; empty when no single site is open. */
  checklistKeys: ReadonlyMap<string, string>
  /** Opens the deadline's dialog; a row's Complete button opens it straight to the completion form. */
  onOpen:        (deadline: Deadline, mode?: 'detail' | 'complete') => void
  /** Keeps a freshly picked owner's name, because the up-front people lookup only returns the first few. */
  rememberOwner: (userId: string, name: string) => void
}

type Tone = ComponentProps<typeof StatusChip>['tone']

// Every urgency has a tone, an icon and (from BUCKET_LABELS) a word, so colour is
// never the only way to tell them apart.
export const BUCKET_TONE: Readonly<Record<UrgencyBucket, Tone>> = {
  overdue: 'bad', due_soon: 'warn', upcoming: 'idle', completed: 'good', dismissed: 'idle',
}

export const BUCKET_ICON: Readonly<Record<UrgencyBucket, LucideIcon>> = {
  overdue: AlertTriangle, due_soon: Clock, upcoming: CalendarClock, completed: CheckCircle2, dismissed: Ban,
}

/** The program and where the deadline came from, as chips. */
export function DeadlineChips({ deadline }: { deadline: Deadline }) {
  const program = programLabel(deadline.program)
  return (
    <>
      {program && <StatusChip tone="idle">{program}</StatusChip>}
      <StatusChip tone="idle">{ORIGIN_LABELS[originOf(deadline)]}</StatusChip>
    </>
  )
}

/** Complete, and run the checklist that completes it: the two things most people open a deadline to do. */
export function QuickActions({ deadline, ctx, onComplete }: { deadline: Deadline; ctx: ViewContext; onComplete: () => void }) {
  const href = checklistHref(deadline, ctx.checklistKeys)
  const canComplete = canCompleteDeadline(deadline, ctx.actor)
  if (!href && !canComplete) return null
  return (
    <>
      {canComplete && (
        <button type="button" onClick={onComplete} aria-label={`Complete ${deadline.title}`} className={secondaryButtonCls}>
          <CheckCircle2 className="h-4 w-4" /> Complete
        </button>
      )}
      {href && (
        <Link href={href} aria-label={`Run checklist for ${deadline.title}`} className={secondaryButtonCls}>
          <ListChecks className="h-4 w-4" /> Run checklist
        </Link>
      )}
    </>
  )
}
