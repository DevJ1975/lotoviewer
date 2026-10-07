import { StatusChip } from '@/components/environmental/badges'
import type { Deadline } from '@/lib/environmental/client'
import {
  bucketOf, BUCKET_LABELS, formatDate, formatLocalDate, ownerLabel, relativeDueText, siteLabel, type DeadlineGroup,
} from '@/lib/environmental/calendarView'
import { BUCKET_ICON, BUCKET_TONE, DeadlineChips, QuickActions, type ViewContext } from './shared'

// The list view: one table, a band per urgency, a row per deadline.

const headerCell = 'px-3 py-2 font-semibold'

export function DeadlineList({ groups, ctx }: { groups: DeadlineGroup[]; ctx: ViewContext }) {
  const columns = ctx.showSite ? 5 : 4
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[42rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th scope="col" className={headerCell}>Deadline</th>
            <th scope="col" className={headerCell}>Due</th>
            <th scope="col" className={headerCell}>Owner</th>
            {ctx.showSite && <th scope="col" className={headerCell}>Site</th>}
            <th scope="col" className={headerCell}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        {groups.map(group => {
          const headingId = `deadline-group-${group.bucket}`
          return (
            <tbody key={group.bucket} aria-labelledby={headingId} className="divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              <tr className="bg-slate-100/70 dark:bg-slate-900/70">
                <th id={headingId} scope="rowgroup" colSpan={columns} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  {group.label} ({group.deadlines.length})
                </th>
              </tr>
              {group.deadlines.map(deadline => <DeadlineRow key={deadline.id} deadline={deadline} ctx={ctx} />)}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

function DeadlineRow({ deadline, ctx }: { deadline: Deadline; ctx: ViewContext }) {
  const bucket = bucketOf(deadline, ctx.now)
  const Icon = BUCKET_ICON[bucket]
  return (
    <tr className="bg-white align-top dark:bg-slate-950">
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => ctx.onOpen(deadline)}
          className="text-left font-medium text-slate-900 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/60 dark:text-slate-100"
        >
          {deadline.title}
        </button>
        <div className="mt-1 flex flex-wrap gap-1"><DeadlineChips deadline={deadline} /></div>
        {deadline.regulatory_ref && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{deadline.regulatory_ref}</p>}
        {deadline.last_completed_at && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Last completed {formatLocalDate(deadline.last_completed_at)}</p>}
      </td>
      <td className="px-3 py-2">
        <p className="whitespace-nowrap text-slate-800 dark:text-slate-200">{formatDate(deadline.next_due_at)}</p>
        <StatusChip tone={BUCKET_TONE[bucket]} className="mt-1">
          <Icon aria-hidden="true" className="h-3 w-3" />
          {deadline.status === 'open' ? relativeDueText(deadline.next_due_at, ctx.now) : BUCKET_LABELS[bucket]}
        </StatusChip>
      </td>
      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{ownerLabel(deadline.owner_user_id, ctx.ownerNames)}</td>
      {ctx.showSite && <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{siteLabel(deadline.facility_id, ctx.siteNames)}</td>}
      <td className="px-3 py-2">
        <div className="flex flex-wrap justify-end gap-2">
          <QuickActions deadline={deadline} ctx={ctx} onComplete={() => ctx.onOpen(deadline, 'complete')} />
        </div>
      </td>
    </tr>
  )
}
