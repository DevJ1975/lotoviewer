'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, BookOpen, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { complianceFetch } from './_lib/api'
import { StatusPill } from './_components/StatusPill'
import {
  CATEGORY_LABEL,
  FREQUENCY_LABEL,
  type ObligationCategory,
  type ObligationFrequency,
  type ObligationStatus,
} from '@soteria/core/compliance'

// /compliance — Calendar hub.
//
// Renders three sections:
//   1. Status tiles (overdue / due soon / upcoming)
//   2. Upcoming obligations list, grouped by month, sorted by due
//      date ascending. Each row shows status pill + responsible party.
//   3. Quick links to the registry.
//
// Calendar grid (month-view) is deferred — a flat chronological list
// is friendlier on mobile and matches how the rest of the app
// presents "what's next" (toolbox talks, equipment readiness).

interface ObligationRow {
  id:                 string
  legal_register_id:  string | null
  title:              string
  description:        string | null
  category:           ObligationCategory
  frequency:          ObligationFrequency
  next_due_date:      string
  lead_days:          number
  last_completed_at:  string | null
  snoozed_until:      string | null
  not_applicable:     boolean
  responsible_party:  string | null
  status:             ObligationStatus
}

interface ListResponse {
  obligations: ObligationRow[]
  total:       number
  today:       string
}

export default function ComplianceHubPage() {
  const { tenant } = useTenant()
  const [rows,    setRows]    = useState<ObligationRow[] | null>(null)
  const [today,   setToday]   = useState<string>('')
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true); setError(null)
    try {
      const body = await complianceFetch<ListResponse>(tenant.id, '/api/compliance/obligations?limit=300')
      setRows(body.obligations)
      setToday(body.today)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant?.id])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const c: Record<ObligationStatus, number> = {
      overdue: 0, due_soon: 0, upcoming: 0, snoozed: 0, completed: 0, not_applicable: 0,
    }
    for (const r of rows ?? []) c[r.status]++
    return c
  }, [rows])

  const grouped = useMemo(() => {
    // Group active (not completed, not not_applicable) obligations by
    // YYYY-MM of next_due_date. Show overdue first as their own group.
    const overdue: ObligationRow[] = []
    const byMonth = new Map<string, ObligationRow[]>()
    for (const r of rows ?? []) {
      if (r.status === 'completed' || r.status === 'not_applicable') continue
      if (r.status === 'overdue') { overdue.push(r); continue }
      const key = r.next_due_date.slice(0, 7) // YYYY-MM
      const arr = byMonth.get(key) ?? []
      arr.push(r)
      byMonth.set(key, arr)
    }
    const months = Array.from(byMonth.keys()).sort()
    return { overdue, months: months.map(k => ({ key: k, rows: byMonth.get(k)! })) }
  }, [rows])

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">
            Compliance · Calendar &amp; Legal Registry
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            Compliance calendar
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Track recurring obligations linked to the citations that drive them. AI-assisted authoring; humans confirm.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/compliance/registry"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Legal registry
          </Link>
          <Link
            href="/compliance/obligations/new"
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            <Plus className="h-4 w-4" />
            New obligation
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <CountTile label="Overdue"  count={counts.overdue}  tone="rose" />
        <CountTile label="Due soon" count={counts.due_soon} tone="amber" />
        <CountTile label="Upcoming" count={counts.upcoming} tone="sky" />
      </section>

      {error && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {loading && rows === null ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (rows?.length ?? 0) === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {grouped.overdue.length > 0 && (
            <section>
              <h2 className="text-[11px] font-bold tracking-widest uppercase text-rose-700 dark:text-rose-300 mb-2">
                Overdue
              </h2>
              <ObligationList rows={grouped.overdue} today={today} />
            </section>
          )}
          {grouped.months.map(({ key, rows: monthRows }) => (
            <section key={key}>
              <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-2">
                {monthLabel(key)}
              </h2>
              <ObligationList rows={monthRows} today={today} />
            </section>
          ))}
        </div>
      )}
    </main>
  )
}

function CountTile({ label, count, tone }: { label: string; count: number; tone: 'rose' | 'amber' | 'sky' }) {
  const toneClass = {
    rose:  'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300',
    amber: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    sky:   'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300',
  }[tone]
  return (
    <div className={`rounded-2xl border border-slate-100 dark:border-slate-800 p-4 ${toneClass}`}>
      <div className="text-3xl font-bold">{count}</div>
      <div className="text-xs font-semibold tracking-wide uppercase mt-0.5">{label}</div>
    </div>
  )
}

function ObligationList({ rows, today }: { rows: ObligationRow[]; today: string }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 overflow-hidden">
      {rows.map(r => (
        <li key={r.id}>
          <Link
            href={`/compliance/obligations/${r.id}`}
            className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{r.title}</span>
                  <StatusPill status={r.status} />
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                  <span>{CATEGORY_LABEL[r.category]}</span>
                  <span aria-hidden>·</span>
                  <span>{FREQUENCY_LABEL[r.frequency]}</span>
                  {r.responsible_party && (<><span aria-hidden>·</span><span>{r.responsible_party}</span></>)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {r.next_due_date}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {dueDelta(r.next_due_date, today)}
                </div>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 px-6 py-10 text-center">
      <ShieldCheck className="h-10 w-10 mx-auto text-slate-300 dark:text-slate-600" />
      <h3 className="mt-3 text-base font-semibold text-slate-700 dark:text-slate-200">
        No compliance obligations yet
      </h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
        Start by adding a citation to the <Link href="/compliance/registry" className="underline">legal registry</Link>, then let AI suggest obligations — or create one manually below.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Link href="/compliance/registry/new" className="text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
          + Add citation
        </Link>
        <Link href="/compliance/obligations/new" className="text-sm font-semibold px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90">
          + New obligation
        </Link>
      </div>
    </div>
  )
}

function monthLabel(key: string): string {
  // key = YYYY-MM
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  const d = new Date(Date.UTC(y, m - 1, 1))
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function dueDelta(due: string, today: string): string {
  if (!today) return ''
  const ms = Date.parse(due) - Date.parse(today)
  const days = Math.round(ms / 86_400_000)
  if (days === 0) return 'today'
  if (days < 0)   return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  return `in ${days} day${days === 1 ? '' : 's'}`
}
