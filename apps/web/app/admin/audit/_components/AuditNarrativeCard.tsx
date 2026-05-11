'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { AuditSummaryResponse } from '@/app/api/admin/audit-summary/route'

// AI-generated 24h narrative + anomaly bullets above the audit table.
// Calls /api/admin/audit-summary on first paint; the route caches per
// tenant per hour, so refreshing within an hour returns instantly.
//
// Failure mode: route returns a non-AI fallback narrative when
// Anthropic errors. We display whatever it gave us — never block the
// page on the AI step.

export function AuditNarrativeCard() {
  const { tenant } = useTenant()
  const [data,    setData]    = useState<AuditSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setLoading(false); return }
      const res = await fetch(`/api/admin/audit-summary${force ? '?force=1' : ''}`, {
        method: 'POST',
        headers: {
          authorization:    `Bearer ${session.access_token}`,
          'x-active-tenant': tenant?.id ?? '',
        },
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as AuditSummaryResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant?.id])

  useEffect(() => { void load() }, [load])

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating 24h summary…
        </div>
      </div>
    )
  }
  if (error || !data) {
    return null
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Last {data.windowHours}h summary
          </h2>
          {data.cached && (
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">cached</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          aria-label="Regenerate"
          title="Regenerate"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
        </button>
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{data.narrative}</p>

      {data.anomalies.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold mb-1.5 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Anomalies
          </p>
          <ul className="text-xs text-slate-700 dark:text-slate-200 space-y-1 list-disc pl-5">
            {data.anomalies.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
        <span>{data.totals.rows.toLocaleString()} rows</span>
        <span>{data.totals.actors} actor{data.totals.actors === 1 ? '' : 's'}</span>
        <span>{data.totals.tables} table{data.totals.tables === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}
