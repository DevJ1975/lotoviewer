'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { Equipment } from '@soteria/core/types'
import {
  groupByPeriodic,
  type PeriodicStatus,
  type PeriodicInspectionRow,
} from '@soteria/core/lotoPeriodicInspection'

// /admin/periodic-inspections — 29 CFR 1910.147(c)(6) compliance.
//
// Lists every equipment grouped by inspection status (overdue,
// due-soon, never, current). Each row drills down to the per-equipment
// page where the admin can record a new inspection or view history.
// The list is intentionally tenant-scoped at the query layer and at
// the RLS layer — defense in depth.

const STATUS_LABEL: Record<PeriodicStatus, string> = {
  overdue:  'Overdue',
  due_soon: 'Due within 30 days',
  never:    'Never inspected',
  current:  'Current',
}

const STATUS_PILL: Record<PeriodicStatus, string> = {
  overdue:  'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
  due_soon: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  never:    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  current:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
}

type Filter = 'all' | PeriodicStatus

export default function PeriodicInspectionsPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [equipment, setEquipment]   = useState<Equipment[] | null>(null)
  const [latestByEqId, setLatestByEqId] = useState<Map<string, PeriodicInspectionRow>>(new Map())
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [filter, setFilter]         = useState<Filter>('all')
  const [search, setSearch]         = useState('')

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      // Two queries in parallel — equipment list for the row + the
      // most-recent inspection per equipment for the "last inspected
      // by" column. Both are RLS-scoped to the active tenant.
      const [eqResult, inspResult] = await Promise.all([
        supabase
          .from('loto_equipment')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('equipment_id', { ascending: true }),
        supabase
          .from('loto_periodic_inspections')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('signed', true)
          .order('inspected_at', { ascending: false }),
      ])
      if (eqResult.error)   throw new Error(formatSupabaseError(eqResult.error,   'load equipment'))
      if (inspResult.error) throw new Error(formatSupabaseError(inspResult.error, 'load inspections'))

      setEquipment(eqResult.data as Equipment[])
      const latest = new Map<string, PeriodicInspectionRow>()
      for (const row of (inspResult.data ?? []) as PeriodicInspectionRow[]) {
        if (!latest.has(row.equipment_id)) latest.set(row.equipment_id, row)
      }
      setLatestByEqId(latest)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load inspections.')
    }
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) load() }, [authLoading, profile, load])

  const now = useMemo(() => new Date(), [])
  const cohorts = useMemo(() => groupByPeriodic(equipment ?? [], now), [equipment, now])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const q = search.trim().toLowerCase()
  const visibleCohorts = cohorts
    .filter(c => filter === 'all' || c.status === filter)
    .map(c => ({
      ...c,
      items: c.items.filter(eq =>
        !q
        || eq.equipment_id.toLowerCase().includes(q)
        || eq.description.toLowerCase().includes(q)
        || eq.department.toLowerCase().includes(q),
      ),
    }))

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/loto" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to LOTO
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-brand-navy" />
          Periodic procedure inspections
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          29 CFR 1910.147(c)(6) requires every energy-control procedure to be
          inspected at least once a year by an authorized employee not using
          the procedure. Overdue items show first.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by equipment, description, or department…"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as Filter)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="all">All statuses</option>
          <option value="overdue">Overdue only</option>
          <option value="due_soon">Due within 30 days</option>
          <option value="never">Never inspected</option>
          <option value="current">Current</option>
        </select>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      {equipment === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : (
        <div className="space-y-6">
          {visibleCohorts.map(cohort => {
            if (cohort.items.length === 0 && filter !== 'all') {
              return (
                <CohortHeader key={cohort.status} status={cohort.status} count={0}>
                  <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    Nothing in this cohort.
                  </p>
                </CohortHeader>
              )
            }
            if (cohort.items.length === 0) return null
            return (
              <CohortHeader key={cohort.status} status={cohort.status} count={cohort.items.length}>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {cohort.items.map(eq => {
                    const latest = latestByEqId.get(eq.equipment_id)
                    const due = eq.next_periodic_review_due_at
                    return (
                      <li key={eq.equipment_id} className="px-4 py-3 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/equipment/${encodeURIComponent(eq.equipment_id)}/periodic-inspection`}
                            className="text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-brand-navy hover:underline"
                          >
                            {eq.equipment_id}
                          </Link>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {eq.description} · {eq.department}
                          </p>
                        </div>
                        <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                          {due ? (
                            <>
                              <span className="font-mono">Due {new Date(due).toLocaleDateString()}</span>
                              {latest && (
                                <p className="mt-0.5">
                                  Last: {latest.inspector_name} ·{' '}
                                  {new Date(latest.inspected_at).toLocaleDateString()}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="italic">Never inspected</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </CohortHeader>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CohortHeader({ status, count, children }: { status: PeriodicStatus; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${STATUS_PILL[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{count}</span>
      </header>
      {children}
    </section>
  )
}

