'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle, Plus, FileText } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import type { JhaRow, JhaStatus, JhaFrequency } from '@soteria/core/jha'

// /jha — Job Hazard Analysis register. Read + create-header in slice 2;
// slice 3 ships the full editor for steps/hazards/controls.

const STATUS_PILL: Record<JhaStatus, string> = {
  draft:       'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_review:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  approved:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  superseded:  'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-500 line-through',
}

const FREQUENCY_LABEL: Record<JhaFrequency, string> = {
  continuous: 'Continuous',
  daily:      'Daily',
  weekly:     'Weekly',
  monthly:    'Monthly',
  quarterly:  'Quarterly',
  annually:   'Annually',
  as_needed:  'As needed',
}

export default function JhaListPage() {
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canCreate = !!profile?.is_admin || !!profile?.is_superadmin

  const [rows,  setRows]  = useState<JhaRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSuperseded, setShowSuperseded] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const params = new URLSearchParams()
      params.set('limit', '200')
      if (!showSuperseded) params.set('status', 'draft,in_review,approved')

      const res = await fetch(`/api/jha?${params.toString()}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRows((body.jhas ?? []) as JhaRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id, showSuperseded])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Job Hazard Analyses</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Task-level hazard breakdowns per ISO 45001 6.1.2.2 + Cal/OSHA T8 §3203.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/jha/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
          >
            <Plus className="h-4 w-4" />
            New JHA
          </Link>
        )}
      </header>

      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showSuperseded}
            onChange={e => setShowSuperseded(e.target.checked)}
            className="rounded"
          />
          Show superseded
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {rows === null && !error && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <FileText className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            No {showSuperseded ? '' : 'active '}JHAs yet.
          </p>
          {canCreate && (
            <Link href="/jha/new" className="mt-3 inline-block text-sm font-medium text-brand-navy hover:underline">
              Create the first one →
            </Link>
          )}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Job #</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-left">Frequency</th>
                <th className="px-3 py-2 text-left">Performed by</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                    <Link href={`/jha/${r.id}`} className="hover:underline">
                      {r.job_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200 max-w-md truncate">
                    {r.title}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.location ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {FREQUENCY_LABEL[r.frequency]}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.performed_by ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${STATUS_PILL[r.status]}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
