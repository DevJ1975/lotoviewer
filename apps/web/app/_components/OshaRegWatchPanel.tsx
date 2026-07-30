'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import {
  fetchOshaRegulationUpdates,
  fetchTenantJurisdictions,
  sortUpdatesForFeed,
  type OshaRegulationUpdate,
  type OshaUpdateCategory,
  type RegulationJurisdiction,
} from '@soteria/core/oshaRegWatch'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { JurisdictionBadge, SeverityPill, TitleLink } from './RegulationUpdateParts'

// Regulatory Watch panel for the Control Center home dashboard — the
// backward-looking half. ComingUpPanel is its forward-looking sibling.
//
// Same self-gating pattern as RiskKpiPanel / NearMissKpiPanel: mounts only
// when the active tenant has the module visible, returns null otherwise.
// Unlike the KPI panels (number tiles), this one is summary-text-first —
// each row is the AI's workplace-impact blurb for one update, because
// reading the summary IS the point of the feature.
//
// The feed is GLOBAL (one shared set of rows) and the cron refreshes it
// monthly, so the poll interval is slow — just enough that a long-lived tab
// eventually picks up a new month's run. Cal/OSHA rows are filtered to
// tenants that actually operate in California; see fetchTenantJurisdictions.

const REFRESH_MS = 6 * 60 * 60 * 1000   // 6h — the feed only changes monthly
const FEED_LIMIT = 5

const CATEGORY_LABEL: Record<OshaUpdateCategory, string> = {
  final_rule:    'Final rule',
  proposed_rule: 'Proposed rule',
  enforcement:   'Enforcement',
  guidance:      'Guidance',
  upcoming:      'Upcoming',
  other:         'Update',
}

export default function OshaRegWatchPanel() {
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
      setUpdates(await fetchOshaRegulationUpdates(FEED_LIMIT, scope))
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

  // Hide entirely for tenants without the module, and on a first-load
  // failure — the panel is purely informational, so a transient error
  // shouldn't break the dashboard (Sentry already captured it).
  if (tenantLoading || !visible) return null
  if (error && !updates) return null

  const ordered = updates ? sortUpdatesForFeed(updates) : null
  const showJurisdiction = jurisdictions.length > 1

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Regulatory Watch
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Regulatory updates
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          <ShieldAlert className="h-3.5 w-3.5" /> AI summary
        </span>
      </header>

      {loading && ordered === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : ordered === null || ordered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          <p className="text-xs italic text-slate-400">No regulatory updates yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {ordered.map(u => (
            <UpdateRow key={u.id} update={u} showJurisdiction={showJurisdiction} />
          ))}
        </ul>
      )}
    </section>
  )
}

function UpdateRow({
  update, showJurisdiction,
}: {
  update: OshaRegulationUpdate
  showJurisdiction: boolean
}) {
  const dateLabel = formatUpdateDate(update)
  return (
    <li className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
      <div className="flex items-start justify-between gap-2">
        <TitleLink update={update} />
        <SeverityPill severity={update.severity} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        {showJurisdiction && <JurisdictionBadge jurisdiction={update.jurisdiction} />}
        <CategoryBadge update={update} />
        {dateLabel && <span>{dateLabel}</span>}
      </div>
      <p className="mt-2 text-sm leading-snug text-slate-700 dark:text-slate-300">
        {update.impact_summary}
      </p>
    </li>
  )
}

function CategoryBadge({ update }: { update: OshaRegulationUpdate }) {
  if (update.is_upcoming) {
    return (
      <span className="rounded-md bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
        Upcoming
      </span>
    )
  }
  return (
    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
      {CATEGORY_LABEL[update.category]}
    </span>
  )
}

// Show the most decision-relevant date: when comments close (act now) for
// upcoming items, else when the change takes effect, else when it published.
// Parsed as local time so the displayed day matches the ISO date.
function formatUpdateDate(u: OshaRegulationUpdate): string | null {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  if (u.is_upcoming && u.comment_close_date) return `Comments close ${fmt(u.comment_close_date)}`
  if (u.effective_date) return `Effective ${fmt(u.effective_date)}`
  if (u.published_date) return `Published ${fmt(u.published_date)}`
  if (u.comment_close_date) return `Comments close ${fmt(u.comment_close_date)}`
  return null
}
