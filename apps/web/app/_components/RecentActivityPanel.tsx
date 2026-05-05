'use client'

import Link from 'next/link'
import type { ActivityEvent } from '@soteria/core/homeMetrics'

// Recent audit-log feed. Admin-only at the data layer (RLS) — for non-
// admin users this just shows an empty-state copy.

export function RecentActivityPanel({ events }: { events: ActivityEvent[] | null }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recent Activity</h2>
      {events === null ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No recent activity.</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Audit log is admin-only — non-admins won&apos;t see entries here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
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
      <span className="text-[11px] font-mono font-semibold text-slate-400 dark:text-slate-500 tabular-nums shrink-0 w-12">{time}</span>
      <span className="text-sm text-slate-800 dark:text-slate-200 flex-1">{event.description}</span>
      {event.actorEmail && (
        <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline truncate max-w-[140px]">{event.actorEmail.split('@')[0]}</span>
      )}
    </div>
  )
  if (event.link) {
    return (
      <li>
        <Link href={event.link} className="block -mx-2 px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
          {body}
        </Link>
      </li>
    )
  }
  return <li className="-mx-2 px-2 py-1">{body}</li>
}
