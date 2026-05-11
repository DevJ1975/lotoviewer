'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { ClassifyResponse } from '@/app/api/near-miss/[id]/classify/route'

// AI triage card on the near-miss detail page. Auto-fetches on first
// view (POST acts as get-or-generate); cached for 7 days. Admin-only
// (the route gates).
//
// Design note: render only when `canEdit` is true. Tenant members
// have RLS-read access to the insights row, but the route requires
// admin to *generate* one. We avoid showing an "AI triage" UI to
// users who can't refresh it.

interface Props {
  nearMissId: string
  canEdit:    boolean
}

const RISK_TONE = {
  low:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  medium: 'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  high:   'bg-rose-100    text-rose-800    dark:bg-rose-900/40    dark:text-rose-200',
} as const

export function AiInsightsCard({ nearMissId, canEdit }: Props) {
  const { tenant } = useTenant()
  const [data,    setData]    = useState<ClassifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    if (!tenant?.id) return
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setLoading(false); return }
      const res = await fetch(`/api/near-miss/${nearMissId}/classify${force ? '?force=1' : ''}`, {
        method: 'POST',
        headers: {
          authorization:    `Bearer ${session.access_token}`,
          'x-active-tenant': tenant.id,
        },
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as ClassifyResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, nearMissId])

  useEffect(() => { if (canEdit) void load() }, [load, canEdit])

  if (!canEdit) return null

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            AI triage
          </h2>
          {data?.cached && (
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

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing description…
        </div>
      )}

      {error && !data && (
        <p className="text-xs text-rose-700 dark:text-rose-300 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {error}
        </p>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Escalation risk</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${RISK_TONE[data.escalation_risk]}`}>
              {data.escalation_risk}
            </span>
          </div>

          {data.themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {data.themes.map(t => (
                <span
                  key={t}
                  className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {data.rationale && (
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{data.rationale}</p>
          )}

          <p className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-[10px] text-slate-400 dark:text-slate-500 font-mono">
            Generated {new Date(data.generated_at).toLocaleString()} · {data.model}
          </p>
        </>
      )}
    </div>
  )
}
