'use client'

import { CalendarClock, CheckCircle2, Clock, AlertOctagon } from 'lucide-react'

// OshaDeadlineBanner — surfaces the four federal OSHA recordkeeping
// deadlines that apply to the year currently being viewed on the
// /osha records page:
//
//   1. 300A annual summary CERTIFICATION — informally targeted at
//      Jan 31 of the following year so the form is ready to post
//      on Feb 1 (29 CFR 1904.32(b)(3)).
//   2. 300A workplace POSTING — Feb 1 through Apr 30 of the
//      following year (29 CFR 1904.32(b)(6)).
//   3. ITA ELECTRONIC SUBMISSION — due Mar 2 of the following
//      year for establishments meeting size/industry criteria
//      (29 CFR 1904.41).
//   4. 5-year retention reminder — informational only.
//
// Plus a footer note covering the always-on rules:
//   - 7-day entry deadline for new cases (29 CFR 1904.29(b)(3)).
//   - Severe-injury reporting: fatalities within 8 hours,
//     in-patient hospitalisation / amputation / loss of an eye
//     within 24 hours (29 CFR 1904.39).
//
// The banner is read-only — actions to certify or upload are on
// the records page itself. We intentionally don't *enforce*
// deadlines here; OSHA owns enforcement, we just inform.

interface Props {
  year:           number              // year the data covers
  certified:      boolean             // 300A certified?
  certifiedAt?:   string | null
  itaSubmittedAt?: string | null      // present once ITA upload is logged
  postedAt?:      string | null       // optional posted-on-wall acknowledgement
  /** True when this establishment must submit to ITA at all. */
  itaApplicable?: boolean
}

type Status = 'done' | 'overdue' | 'imminent' | 'upcoming' | 'future'

interface Row {
  key:    string
  label:  string
  detail: string
  status: Status
  due:    Date
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export default function OshaDeadlineBanner({
  year, certified, certifiedAt, itaSubmittedAt, postedAt, itaApplicable = true,
}: Props) {
  const today    = new Date()
  const followYr = year + 1

  // Deadlines for `year`'s recordkeeping cycle.
  const certifyBy   = new Date(followYr, 0, 31)   // Jan 31
  const postStart   = new Date(followYr, 1, 1)    // Feb 1
  const postEnd     = new Date(followYr, 3, 30)   // Apr 30
  const itaDue      = new Date(followYr, 2, 2)    // Mar 2
  const retentionEnd = new Date(year + 6, 0, 1)   // 5 yrs after last day of year

  const rows: Row[] = [
    {
      key:    'certify',
      label:  '300A annual summary — certify',
      detail: certified
        ? `Signed ${certifiedAt ? new Date(certifiedAt).toLocaleDateString() : ''}.`
        : `Have a company executive sign by ${formatDate(certifyBy)} so the 300A is ready to post Feb 1.`,
      due:    certifyBy,
      status: certified ? 'done' : statusFor(today, certifyBy),
    },
    {
      key:    'post',
      label:  '300A workplace posting',
      detail: postedAt
        ? `Posted ${new Date(postedAt).toLocaleDateString()}.`
        : `Post in a visible workplace location from ${formatDate(postStart)} through ${formatDate(postEnd)}.`,
      due:    postEnd,
      status: postedAt
        ? 'done'
        : today < postStart
          ? 'future'
          : today > postEnd
            ? 'overdue'
            : 'imminent',                    // currently in posting window
    },
  ]

  if (itaApplicable) {
    rows.push({
      key:    'ita',
      label:  'ITA electronic submission',
      detail: itaSubmittedAt
        ? `Submitted ${new Date(itaSubmittedAt).toLocaleDateString()}.`
        : `Upload to OSHA Injury Tracking Application (osha.gov/ita) by ${formatDate(itaDue)}. ` +
          `Required for establishments with 250+ employees, or 20-249 employees in OSHA Appendix A industries; ` +
          `100+ employees in Appendix B industries must also submit Form 300 + 301 data.`,
      due:    itaDue,
      status: itaSubmittedAt ? 'done' : statusFor(today, itaDue),
    })
  }

  rows.push({
    key:    'retain',
    label:  '5-year retention',
    detail: `Keep this year's 300, 300A, and 301 records on file until ${formatDate(retentionEnd)}.`,
    due:    retentionEnd,
    status: 'upcoming',
  })

  // Sort rows so the most-urgent surface to the top.
  const order: Record<Status, number> = {
    overdue: 0, imminent: 1, upcoming: 2, future: 3, done: 4,
  }
  rows.sort((a, b) => order[a.status] - order[b.status] || +a.due - +b.due)

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/40">
        <CalendarClock className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          OSHA submission deadlines — {year} recordkeeping cycle
        </h2>
      </header>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(r => <DeadlineRow key={r.key} row={r} today={today} />)}
      </ul>
      <footer className="border-t border-slate-200 dark:border-slate-800 px-4 py-2.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/20">
        <p>
          <span className="font-semibold">Always on:</span> log new cases within 7 calendar days of awareness
          (29 CFR 1904.29). Report fatalities to OSHA within 8 hours; in-patient hospitalisation, amputation,
          or loss of an eye within 24 hours (29 CFR 1904.39).
        </p>
      </footer>
    </section>
  )
}

function DeadlineRow({ row, today }: { row: Row; today: Date }) {
  const days = Math.round((+row.due - +today) / MS_PER_DAY)
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <StatusIcon status={row.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.label}</p>
          <p className={`text-xs font-semibold ${badgeColor(row.status)}`}>{badgeText(row.status, days)}</p>
        </div>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{row.detail}</p>
      </div>
    </li>
  )
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400" />
  if (status === 'overdue') return <AlertOctagon className="h-4 w-4 mt-0.5 text-rose-600 dark:text-rose-400" />
  if (status === 'imminent') return <Clock className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
  return <Clock className="h-4 w-4 mt-0.5 text-slate-400 dark:text-slate-500" />
}

function statusFor(today: Date, due: Date): Status {
  const days = Math.round((+due - +today) / MS_PER_DAY)
  if (days < 0)  return 'overdue'
  if (days <= 30) return 'imminent'
  if (days <= 90) return 'upcoming'
  return 'future'
}

function badgeText(status: Status, days: number): string {
  if (status === 'done')     return 'Complete'
  if (status === 'overdue')  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (status === 'imminent') return days === 0 ? 'Due today' : `In ${days} day${days === 1 ? '' : 's'}`
  if (status === 'upcoming') return `In ${days} days`
  return `In ${days} days`
}

function badgeColor(status: Status): string {
  if (status === 'done')     return 'text-emerald-700 dark:text-emerald-300'
  if (status === 'overdue')  return 'text-rose-700 dark:text-rose-300'
  if (status === 'imminent') return 'text-amber-700 dark:text-amber-300'
  return 'text-slate-500 dark:text-slate-400'
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
