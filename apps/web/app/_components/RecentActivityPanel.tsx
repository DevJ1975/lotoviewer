'use client'

import Link from 'next/link'
import type { ActivityEvent } from '@soteria/core/homeMetrics'

// Recent audit-log feed. Admin-only at the data layer (RLS) — for non-
// admin users this just shows an empty-state copy.

export function RecentActivityPanel({ events }: { events: ActivityEvent[] | null }) {
  const count = events?.length ?? 0
  return (
    <section className="placard-surface placard-corner-mark p-4 space-y-3">
      <header className="flex items-center gap-3">
        <h2 className="placard-section-title">Recent Activity</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-slate-300 to-transparent dark:from-slate-700" />
        {count > 0 && (
          <span className="placard-label placard-numeric text-slate-400 dark:text-slate-500">
            {count.toString().padStart(2, '0')} EVENTS
          </span>
        )}
      </header>
      {events === null ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No recent activity on this shift.</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Audit log is admin-only — non-admins won&apos;t see entries here.
          </p>
        </div>
      ) : (
        <ul>
          {events.map(e => <ActivityRow key={e.id} event={e} />)}
        </ul>
      )}
    </section>
  )
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const time = new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const body = (
    <div className="flex items-baseline gap-3">
      <span className="placard-numeric text-[11px] font-semibold text-slate-400 dark:text-slate-500 shrink-0 w-12">{time}</span>
      <span className="text-sm text-slate-800 dark:text-slate-200 flex-1">{event.description}</span>
      {event.actorEmail && (
        <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline truncate max-w-[140px]">{event.actorEmail.split('@')[0]}</span>
      )}
    </div>
  )
  if (event.link) {
    return (
      <li className="ops-list-row">
        <Link href={event.link} className="block">
          {body}
        </Link>
      </li>
    )
  }
  return <li className="ops-list-row">{body}</li>
}
