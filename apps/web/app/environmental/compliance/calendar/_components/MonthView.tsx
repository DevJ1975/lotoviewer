import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { StatusChip } from '@/components/environmental/badges'
import { secondaryButtonCls } from '@/components/environmental/form'
import { cn } from '@/lib/utils'
import type { Deadline } from '@/lib/environmental/client'
import {
  bucketOf, BUCKET_LABELS, buildDeadlineMonth, chipsForDay, formatDate, isoDay, monthOf, monthTitle,
  orderByUrgency, shiftMonth, WEEKDAYS, type CalendarDay, type MonthRef,
} from '@/lib/environmental/calendarView'
import { BUCKET_ICON, BUCKET_TONE, type ViewContext } from './shared'

// The month view: a Sunday-first grid, three chips to a day. A day number opens a
// panel listing everything due that day, which is also how a phone, where the
// chips do not fit in a cell, reaches its deadlines.

const DAY_PANEL_ID = 'calendar-day-panel'

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/60 dark:focus-visible:ring-brand-yellow/70'

export function MonthView({ deadlines, ctx }: { deadlines: Deadline[]; ctx: ViewContext }) {
  const todayIso = isoDay(ctx.now)
  const [month, setMonth] = useState(() => monthOf(todayIso))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const weeks = useMemo(() => buildDeadlineMonth(month, deadlines), [month, deadlines])

  const goTo = (next: MonthRef) => { setMonth(next); setSelectedDate(null) }
  const selectedDay = weeks.flat().find(day => day.date === selectedDate)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Previous month" onClick={() => goTo(shiftMonth(month, -1))} className={secondaryButtonCls}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 aria-live="polite" className="min-w-[10rem] text-center text-base font-semibold text-slate-900 dark:text-slate-100">{monthTitle(month)}</h2>
        <button type="button" aria-label="Next month" onClick={() => goTo(shiftMonth(month, 1))} className={secondaryButtonCls}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => goTo(monthOf(todayIso))} className={cn(secondaryButtonCls, 'ml-auto')}>Today</button>
      </div>

      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{monthTitle(month)}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map(weekday => (
              <th key={weekday.long} scope="col" className="border border-slate-200 bg-slate-50 py-1 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <span aria-hidden="true">{weekday.short}</span>
                <span className="sr-only">{weekday.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => (
            <tr key={week[0]!.date}>
              {week.map(day => (
                <DayCell
                  key={day.date}
                  day={day}
                  ctx={ctx}
                  isToday={day.date === todayIso}
                  isSelected={day.date === selectedDate}
                  onSelect={() => setSelectedDate(current => (current === day.date ? null : day.date))}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 dark:text-slate-400">A repeating deadline appears on its next due date.</p>

      {selectedDay && <DayPanel day={selectedDay} ctx={ctx} />}
    </div>
  )
}

interface DayCellProps { day: CalendarDay; ctx: ViewContext; isToday: boolean; isSelected: boolean; onSelect: () => void }

function DayCell({ day, ctx, isToday, isSelected, onSelect }: DayCellProps) {
  const { shown, overflow } = chipsForDay(day.deadlines, ctx.now)
  const dayNumber = Number(day.date.slice(8))
  const count = day.deadlines.length
  const dateText = formatDate(day.date)

  return (
    <td
      aria-current={isToday ? 'date' : undefined}
      className={cn(
        'h-14 border border-slate-200 p-1 align-top sm:h-28 dark:border-slate-800',
        day.inMonth ? 'bg-white dark:bg-slate-950' : 'bg-slate-50 text-slate-400 dark:bg-slate-900/50 dark:text-slate-600',
        isToday && 'ring-2 ring-inset ring-brand-navy dark:ring-brand-yellow',
      )}
    >
      {count > 0 ? (
        <button
          type="button"
          aria-pressed={isSelected}
          aria-controls={isSelected ? DAY_PANEL_ID : undefined}
          aria-label={`${dateText}: ${count} ${count === 1 ? 'deadline' : 'deadlines'}${isToday ? ', today' : ''}`}
          onClick={onSelect}
          className={cn('inline-flex items-center gap-1 rounded px-1 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800', focusRing, isSelected && 'bg-slate-200 dark:bg-slate-700')}
        >
          <span aria-hidden="true">{dayNumber}</span>
          <span aria-hidden="true" className="rounded-full bg-brand-navy px-1.5 text-[10px] text-white sm:hidden dark:bg-brand-yellow dark:text-slate-900">{count}</span>
        </button>
      ) : (
        <span className="inline-block px-1 text-xs font-semibold">
          {dayNumber}
          {isToday && <span className="sr-only"> (today)</span>}
        </span>
      )}

      {count > 0 && (
        <ul className="mt-1 hidden space-y-1 sm:block">
          {shown.map(deadline => <li key={deadline.id}><DeadlineChipButton deadline={deadline} ctx={ctx} /></li>)}
          {overflow > 0 && (
            <li>
              <button type="button" onClick={onSelect} className={cn('rounded px-1 text-[11px] font-semibold text-slate-700 underline-offset-2 hover:underline dark:text-slate-300', focusRing)}>
                +{overflow} more{' '}<span className="sr-only">on {dateText}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </td>
  )
}

function DeadlineChipButton({ deadline, ctx }: { deadline: Deadline; ctx: ViewContext }) {
  const bucket = bucketOf(deadline, ctx.now)
  const Icon = BUCKET_ICON[bucket]
  return (
    <button type="button" title={`${BUCKET_LABELS[bucket]}: ${deadline.title}`} onClick={() => ctx.onOpen(deadline)} className={cn('block w-full rounded-full text-left', focusRing)}>
      <StatusChip tone={BUCKET_TONE[bucket]} className="w-full">
        <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="truncate"><span className="sr-only">{BUCKET_LABELS[bucket]}:</span>{' '}{deadline.title}</span>
      </StatusChip>
    </button>
  )
}

function DayPanel({ day, ctx }: { day: CalendarDay; ctx: ViewContext }) {
  const headingId = `${DAY_PANEL_ID}-heading`
  return (
    <section id={DAY_PANEL_ID} aria-labelledby={headingId} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <h3 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">Due {formatDate(day.date)}</h3>
      <ul className="space-y-1.5">
        {orderByUrgency(day.deadlines, ctx.now).map(deadline => {
          const bucket = bucketOf(deadline, ctx.now)
          const Icon = BUCKET_ICON[bucket]
          return (
            <li key={deadline.id} className="flex flex-wrap items-center gap-2">
              <StatusChip tone={BUCKET_TONE[bucket]}><Icon aria-hidden="true" className="h-3 w-3" />{BUCKET_LABELS[bucket]}</StatusChip>
              <button type="button" onClick={() => ctx.onOpen(deadline)} className={cn('text-left text-sm font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-100', focusRing)}>
                {deadline.title}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
