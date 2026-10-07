'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, List, Plus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { EmptyState } from '@/components/EmptyState'
import { useAuth } from '@/components/AuthProvider'
import { useFacility } from '@/components/FacilityProvider'
import { HowToPanel, JurisdictionBanner } from '@/components/environmental/context'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { listDeadlines, errorList, searchOwners, type Deadline } from '@/lib/environmental/client'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { checklistKeysFor, filterDeadlines, groupByUrgency, localToday } from '@/lib/environmental/calendarView'
import { cn } from '@/lib/utils'
import { ENV_PROGRAMS, ENV_PROGRAM_LABELS } from '@soteria/core/environmental/siteProfile'
import { AddDeadlineDialog } from './_components/AddDeadlineDialog'
import { DeadlineDialog } from './_components/DeadlineDialog'
import { DeadlineList } from './_components/DeadlineList'
import { MonthView } from './_components/MonthView'
import type { ViewContext } from './_components/shared'

// /environmental/compliance/calendar — every compliance deadline, for one site or
// for all of them, as a list grouped by urgency or as a month.
//
// Program and status are asked of the API; the search and "assigned to me" narrow
// what came back. Whatever the person changes, the screen reloads from the API
// rather than patching its copy, because completing a repeating deadline moves it
// to a date only the server works out.

const VIEW_MODES = [
  { id: 'list',  label: 'List',  icon: List },
  { id: 'month', label: 'Month', icon: CalendarDays },
] as const
type CalendarMode = typeof VIEW_MODES[number]['id']

const STATUS_FILTERS = [
  { id: 'open', label: 'Open' }, { id: 'completed', label: 'Completed' }, { id: 'dismissed', label: 'Dismissed' }, { id: 'all', label: 'All' },
] as const
type StatusFilter = typeof STATUS_FILTERS[number]['id']

const VIEW_KEY = 'soteria.environmental.calendar.view.v1'

function readStoredView(): CalendarMode {
  try { return window.sessionStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'list' } catch { return 'list' }
}

function storeView(mode: CalendarMode) {
  try { window.sessionStorage.setItem(VIEW_KEY, mode) } catch { /* storage can be blocked; the choice then lasts until the page reloads */ }
}

type Notice = { tone: 'good' | 'warn'; text: string }
type Selection = { id: string; mode: 'detail' | 'complete' }

export default function EnvironmentalCalendarPage() {
  const { ready } = useEnvironmentalScope()
  if (!ready) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  return (
    <>
      <PageHeader
        icon={CalendarDays}
        eyebrow="ISO 14001 · 6.1.3 · 8.1 · 9.1.1"
        title="Compliance calendar"
        description="Every permit renewal, report and inspection that falls due, with who owns it."
      />
      <CalendarScreen />
    </>
  )
}

function CalendarScreen() {
  const { scope, facilityId, canAdmin } = useEnvironmentalScope()
  const { userId } = useAuth()
  const { available } = useFacility()
  const { site, error: siteError } = useEnvironmentalSite()

  const [now] = useState(() => localToday(new Date()))
  const [mode, setMode] = useState<CalendarMode>(readStoredView)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [program, setProgram] = useState('')
  const [search, setSearch] = useState('')
  const [assignedToMe, setAssignedToMe] = useState(false)

  // Rows are tagged with the filters they answer, so changing a filter shows the spinner
  // instead of the previous filter's rows, while a reload after a change keeps the rows on screen.
  const queryKey = `${status}|${program}`
  const [loaded, setLoaded] = useState<{ key: string; deadlines: Deadline[] } | null>(null)
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [reloads, setReloads] = useState(0)
  const [ownerNames, setOwnerNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [ownerErrors, setOwnerErrors] = useState<string[]>([])

  const [selection, setSelection] = useState<Selection | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    listDeadlines(scope, { status, ...(program ? { program } : {}) })
      .then(({ obligations }) => { if (!cancelled) { setLoaded({ key: queryKey, deadlines: obligations }); setLoadErrors([]) } })
      .catch(e => { if (!cancelled) setLoadErrors(errorList(e)) })
    return () => { cancelled = true }
  }, [scope, status, program, queryKey, reloads])

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    searchOwners(scope, '')
      .then(members => { if (!cancelled) setOwnerNames(new Map(members.map(m => [m.user_id, m.display_name]))) })
      .catch(e => { if (!cancelled) setOwnerErrors(errorList(e)) })
    return () => { cancelled = true }
  }, [scope])

  const reload = useCallback(() => setReloads(n => n + 1), [])
  const rememberOwner = useCallback((id: string, name: string) => setOwnerNames(names => new Map(names).set(id, name)), [])
  const chooseMode = (next: CalendarMode) => { setMode(next); storeView(next) }

  const deadlines = loaded?.key === queryKey ? loaded.deadlines : null
  const visible = useMemo(
    () => filterDeadlines(deadlines ?? [], { search, assignedToUserId: assignedToMe ? userId : null }),
    [deadlines, search, assignedToMe, userId],
  )
  const groups = useMemo(() => groupByUrgency(visible, now), [visible, now])
  const siteNames = useMemo(() => new Map(available.map(f => [f.id, f.name])), [available])
  const checklistKeys = useMemo(() => (site ? checklistKeysFor(site.facility.state) : new Map<string, string>()), [site])

  if (!scope) return null

  const ctx: ViewContext = {
    now,
    actor: { canAdmin, userId },
    ownerNames,
    siteNames,
    showSite: facilityId === null,
    checklistKeys,
    onOpen: (deadline, openMode = 'detail') => { setNotice(null); setSelection({ id: deadline.id, mode: openMode }) },
    rememberOwner,
  }

  const saved = (message: string) => { setNotice({ tone: 'good', text: message }); setSelection(null); setAdding(false); reload() }
  const stale = () => {
    setNotice({ tone: 'warn', text: 'That deadline changed while you were looking at it, so nothing was saved and the list has been reloaded. Check its new due date and try again.' })
    setSelection(null)
    reload()
  }

  const selected = selection ? deadlines?.find(d => d.id === selection.id) : undefined
  const filtersActive = status !== 'open' || program !== '' || search.trim() !== '' || assignedToMe

  return (
    <div className="space-y-4">
      <JurisdictionBanner site={site} />
      <HowToPanel pageKey="calendar" state={site?.facility.state ?? null} />
      <ErrorList errors={[...(siteError ? [siteError] : []), ...loadErrors, ...ownerErrors]} />

      <div className="flex flex-wrap items-end gap-3">
        <div role="search" aria-label="Filter deadlines" className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Program">
            <select value={program} onChange={e => setProgram(e.target.value)} className={inputCls}>
              <option value="">All programs</option>
              {ENV_PROGRAMS.map(p => <option key={p} value={p}>{ENV_PROGRAM_LABELS[p]}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className={inputCls}>
              {STATUS_FILTERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Search">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Title or reference" className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-800 dark:text-slate-200">
            <input type="checkbox" checked={assignedToMe} onChange={e => setAssignedToMe(e.target.checked)} disabled={!userId} />
            Assigned to me
          </label>
        </div>

        <div role="group" aria-label="Calendar view" className="inline-flex rounded-md border border-slate-300 dark:border-slate-700">
          {VIEW_MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => chooseMode(id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium first:rounded-l-md last:rounded-r-md',
                mode === id
                  ? 'bg-brand-navy text-white dark:bg-brand-yellow dark:text-slate-900'
                  : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {canAdmin && (
          <button type="button" onClick={() => { setNotice(null); setAdding(true) }} className={primaryButtonCls}>
            <Plus className="h-4 w-4" /> Add a deadline
          </button>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className={cn(
            'rounded-md p-3 text-sm',
            notice.tone === 'good'
              ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
          )}
        >
          {notice.text}
        </p>
      )}

      {deadlines === null ? (
        loadErrors.length === 0 && <div className="flex justify-center py-16"><OpsSpinner /></div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          eyebrow="No deadlines"
          title={filtersActive ? 'No deadlines match these filters' : 'No deadlines yet'}
          description={filtersActive
            ? 'Try a different program, status or search.'
            : canAdmin
              ? 'Add the legal requirements, checklists and recurring deadlines a site needs from the library, or add a deadline of your own.'
              : 'Nothing is on the calendar yet. A tenant admin can set it up.'}
          action={canAdmin && !filtersActive
            ? <Link href="/environmental/compliance" className={secondaryButtonCls}>Set up this site from the library</Link>
            : undefined}
        />
      ) : mode === 'list' ? (
        <DeadlineList groups={groups} ctx={ctx} />
      ) : (
        <MonthView deadlines={visible} ctx={ctx} />
      )}

      {selected && selection && (
        <DeadlineDialog
          key={selected.id}
          deadline={selected}
          initialMode={selection.mode}
          scope={scope}
          ctx={ctx}
          onClose={() => setSelection(null)}
          onSaved={saved}
          onStale={stale}
        />
      )}
      {adding && <AddDeadlineDialog scope={scope} ctx={ctx} onClose={() => setAdding(false)} onSaved={saved} />}
    </div>
  )
}
