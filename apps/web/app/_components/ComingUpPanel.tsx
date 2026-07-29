'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import {
  fetchComingUpUpdates,
  fetchTenantJurisdictions,
  selectComingUp,
  comingUpDate,
  type OshaRegulationUpdate,
  type RegulationJurisdiction,
} from '@soteria/core/oshaRegWatch'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { JurisdictionBadge, SeverityPill, TitleLink } from './RegulationUpdateParts'

// "Coming Up" — the forward-looking half of Regulatory Watch, on the Control
// Center home dashboard.
//
// Where OshaRegWatchPanel answers "what changed", this answers "what is about
// to change, and when do I have to act". It shows only items that are not yet
// in force: an open comment period, a scheduled hearing, or a future
// effective date. Ordering is by the soonest of those dates, so the top row
// is always the next thing with a deadline.
//
// Jurisdiction: federal items go to everyone. Cal/OSHA items go ONLY to
// tenants with a facility or OSHA establishment in California — Title 8 binds
// a California employer and is noise for a Texas plant. The tenant's
// jurisdictions are resolved once per load from RLS-scoped tables, and the
// same set is passed to the fetch so out-of-scope rows never reach the client.
//
// Gated on the existing 'osha-reg-watch' module rather than a new one: this
// is a second view of the same feed, fed by the same monthly cron, and a
// tenant who wants one wants both.

const REFRESH_MS = 6 * 60 * 60 * 1000   // 6h — the feed only changes monthly
const PANEL_LIMIT = 5

export default function ComingUpPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(
    () => isModuleVisible('osha-reg-watch', tenant?.modules),
    [tenant?.modules],
  )

  const [updates, setUpdates] = useState<OshaRegulationUpdate[] | null>(null)
  const [jurisdictions, setJurisdictions] = useState<RegulationJurisdiction[]>(['federal'])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const scope = await fetchTenantJurisdictions()
      setJurisdictions(scope)
      setUpdates(await fetchComingUpUpdates(scope, PANEL_LIMIT))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tenantLoading || !visible) return
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [tenantLoading, visible, load])

  // Hide entirely for tenants without the module, and on a first-load failure
  // — the panel is informational, so a transient error shouldn't break the
  // dashboard (Sentry already captured it).
  if (tenantLoading || !visible) return null
  if (error && !updates) return null

  const todayIso = new Date().toISOString().slice(0, 10)
  const coming = updates
    ? selectComingUp(updates, { jurisdictions, todayIso, limit: PANEL_LIMIT })
    : null

  // A badge per row only earns its space when rows can differ.
  const showJurisdiction = jurisdictions.length > 1

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Regulatory Watch
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Coming up
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          <CalendarClock className="h-3.5 w-3.5" />
          {showJurisdiction ? 'Federal + Cal/OSHA' : 'Federal'}
        </span>
      </header>

      {loading && coming === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : coming === null || coming.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          <p className="text-xs italic text-slate-400">
            No upcoming regulatory changes on the horizon.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {coming.map(u => (
            <ComingUpRow
              key={u.id}
              update={u}
              todayIso={todayIso}
              showJurisdiction={showJurisdiction}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ComingUpRow({
  update, todayIso, showJurisdiction,
}: {
  update: OshaRegulationUpdate
  todayIso: string
  showJurisdiction: boolean
}) {
  const due = comingUpDate(update, todayIso)
  return (
    <li className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
      <div className="flex items-start justify-between gap-2">
        <TitleLink update={update} />
        <SeverityPill severity={update.severity} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        {showJurisdiction && <JurisdictionBadge jurisdiction={update.jurisdiction} />}
        <DeadlineChip update={update} due={due} todayIso={todayIso} />
      </div>
      <p className="mt-2 text-sm leading-snug text-slate-700 dark:text-slate-300">
        {update.impact_summary}
      </p>
    </li>
  )
}

/**
 * The deadline and how far off it is. Naming which date it is matters — an
 * employer acts very differently on "comments close" (say something now) than
 * on "takes effect" (be compliant by then).
 */
function DeadlineChip({
  update, due, todayIso,
}: {
  update: OshaRegulationUpdate
  due: string | null
  todayIso: string
}) {
  if (!due) {
    return (
      <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Date not set
      </span>
    )
  }

  const isCommentDeadline = update.comment_close_date === due
  const urgent = daysBetween(todayIso, due) <= 30

  return (
    <span
      className={`rounded-md px-2 py-0.5 font-bold uppercase tracking-wide ${
        urgent
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {isCommentDeadline ? 'Comments close' : 'Effective'} {formatDay(due)} · {describeLeadTime(todayIso, due)}
    </span>
  )
}

// Parsed as local time so the rendered day matches the stored ISO date.
function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function daysBetween(fromIso: string, toIso: string): number {
  const DAY_MS = 86_400_000
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS)
}

function describeLeadTime(fromIso: string, toIso: string): string {
  const days = daysBetween(fromIso, toIso)
  if (days <= 0)  return 'today'
  if (days === 1) return 'in 1 day'
  if (days < 45)  return `in ${days} days`
  const months = Math.round(days / 30)
  return `in ${months} month${months === 1 ? '' : 's'}`
}
