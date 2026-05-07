'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Clock, ListChecks, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { supabase } from '@/lib/supabase'
import {
  ACTION_TYPE_LABEL,
  daysUntilDue,
  type IncidentActionRow,
} from '@soteria/core/incidentAction'

// Open CAPA actions panel for the home Control Center.
//
// Shows the signed-in user's open / in_progress / blocked actions in
// due-date order. Overdue rows surface first with a red badge so the
// "what should I do today?" prompt is unambiguous.

const REFRESH_MS = 5 * 60 * 1000
const ROW_LIMIT = 6

type ActionRow = Pick<IncidentActionRow,
  'id' | 'incident_id' | 'description' | 'action_type' | 'due_at' | 'status'
>

export default function OpenActionsPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(
    () => isModuleVisible('incidents', tenant?.modules),
    [tenant?.modules],
  )

  const [rows, setRows] = useState<ActionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      // Resolve current user.
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setRows([]); return }

      const { data, error: err } = await supabase
        .from('incident_actions')
        .select('id, incident_id, description, action_type, due_at, status')
        .eq('owner_user_id', user.id)
        .in('status', ['open', 'in_progress', 'blocked'])
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(50)
      if (err) throw new Error(err.message)
      setRows((data ?? []) as ActionRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows([])
    }
  }, [])

  useEffect(() => {
    if (tenantLoading || !visible) return
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [tenantLoading, visible, load])

  if (tenantLoading || !visible) return null
  if (rows === null) {
    return (
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      </section>
    )
  }
  if (error || rows.length === 0) {
    return null    // hide the panel entirely when the user has nothing to do
  }

  // Sort by overdue first, then by due_at asc.
  const sorted = [...rows].sort((a, b) => {
    const da = daysUntilDue({ due_at: a.due_at }) ?? Infinity
    const db = daysUntilDue({ due_at: b.due_at }) ?? Infinity
    return da - db
  }).slice(0, ROW_LIMIT)

  const overdueCount = rows.filter(r => {
    const d = daysUntilDue({ due_at: r.due_at })
    return d != null && d < 0
  }).length

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-brand-navy" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Your open CAPAs
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {rows.length} action{rows.length === 1 ? '' : 's'} assigned
              {overdueCount > 0 && (
                <span className="ml-2 inline-block rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 px-2 py-0.5 text-[10px] font-bold">
                  {overdueCount} OVERDUE
                </span>
              )}
            </h2>
          </div>
        </div>
        {rows.length > ROW_LIMIT && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Showing {ROW_LIMIT} of {rows.length}
          </span>
        )}
      </header>

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {sorted.map(a => (
          <ActionLink key={a.id} action={a} />
        ))}
      </ul>
    </section>
  )
}

function ActionLink({ action }: { action: ActionRow }) {
  const days = daysUntilDue({ due_at: action.due_at })
  const overdue = days != null && days < 0
  const dueSoon = days != null && days >= 0 && days <= 3
  return (
    <li>
      <Link
        href={`/incidents/${action.incident_id}/actions`}
        className="flex items-center gap-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-lg px-2 -mx-2"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{action.description}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {ACTION_TYPE_LABEL[action.action_type]}
            </span>
            {action.due_at && (
              <span className={
                'inline-flex items-center gap-1 text-[11px] ' +
                (overdue ? 'text-rose-600 dark:text-rose-400 font-semibold'
                 : dueSoon ? 'text-amber-700 dark:text-amber-300 font-medium'
                 : 'text-slate-500 dark:text-slate-400')
              }>
                <Clock className="h-3 w-3" />
                {overdue ? `${Math.abs(days!)}d overdue`
                 : days! === 0 ? 'due today'
                 : `due in ${days}d`}
              </span>
            )}
          </div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </Link>
    </li>
  )
}
