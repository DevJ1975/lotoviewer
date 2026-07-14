'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  summarizeCausalFactors,
  CAUSAL_FACTOR_CATEGORIES,
  CAUSAL_FACTOR_CATEGORY_LABEL,
  HIERARCHY_OF_CONTROLS,
  HIERARCHY_LABEL,
  type CausalFactorSummary,
  type CausalFactorSummaryNode,
} from '@soteria/core/ecfaSchemas'

// Causal-factor trend panel (ECFA add-on). Aggregates the causal factors
// flagged across incidents in the selected window into two trendable
// breakdowns — by systemic category and by the hierarchy-of-controls level
// of the intended fix — a leading indicator of whether the program is
// addressing root conditions with strong controls or leaning on weak ones.
//
// Self-contained: two RLS-scoped reads (investigations in-window → their
// ECFA causal-factor nodes), then the pure summarizeCausalFactors().

export default function CausalFactorTrendPanel({
  windowDays, tenantId,
}: {
  windowDays: number
  tenantId: string
}) {
  const [summary, setSummary] = useState<CausalFactorSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString()
      // Investigations whose incident occurred in the window (single-level
      // inner-join filter — RLS scopes to the active tenant).
      const invRes = await supabase
        .from('incident_investigations')
        .select('id, incidents!inner(occurred_at)')
        .gte('incidents.occurred_at', sinceIso)
      if (invRes.error) throw new Error(invRes.error.message)
      const invIds = (invRes.data ?? []).map((r: { id: string }) => r.id)
      if (invIds.length === 0) { setSummary(summarizeCausalFactors([])); return }

      const cfRes = await supabase
        .from('incident_ecfa_nodes')
        .select('is_causal_factor, cf_category, failed_barrier, cf_hierarchy_control')
        .eq('is_causal_factor', true)
        .in('investigation_id', invIds)
      if (cfRes.error) throw new Error(cfRes.error.message)
      setSummary(summarizeCausalFactors((cfRes.data ?? []) as CausalFactorSummaryNode[]))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [windowDays])

  useEffect(() => { if (tenantId) void load() }, [tenantId, load])

  if (loading && !summary) {
    return <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }
  if (error) {
    return <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500">Couldn&apos;t load causal-factor trends: {error}</div>
  }
  if (!summary || summary.total === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">No coded causal factors in this window yet. Flag and code causal factors on the Events &amp; Causal Factors tab to build the trend.</p>
      </div>
    )
  }

  const catMax = Math.max(1, ...CAUSAL_FACTOR_CATEGORIES.map(c => summary.byCategory[c]), summary.uncategorized)
  const ctrlMax = Math.max(1, ...HIERARCHY_OF_CONTROLS.map(h => summary.byControl[h]), summary.noControl)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">By category · {summary.total} causal factor{summary.total === 1 ? '' : 's'}</p>
        {CAUSAL_FACTOR_CATEGORIES.map(c => (
          <Bar key={c} label={CAUSAL_FACTOR_CATEGORY_LABEL[c]} count={summary.byCategory[c]} max={catMax} tone="sky" />
        ))}
        {summary.uncategorized > 0 && <Bar label="(uncategorized)" count={summary.uncategorized} max={catMax} tone="slate" />}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">By intended control level · {summary.withBarrier} with a named barrier</p>
        {HIERARCHY_OF_CONTROLS.map(h => (
          <Bar key={h} label={HIERARCHY_LABEL[h]} count={summary.byControl[h]} max={ctrlMax}
            tone={h === 'elimination' || h === 'substitution' ? 'emerald' : h === 'engineering' ? 'emeraldLite' : h === 'administrative' ? 'amber' : 'rose'} />
        ))}
        {summary.noControl > 0 && <Bar label="(no level set)" count={summary.noControl} max={ctrlMax} tone="slate" />}
      </div>
    </div>
  )
}

function Bar({ label, count, max, tone }: { label: string; count: number; max: number; tone: 'sky' | 'slate' | 'emerald' | 'emeraldLite' | 'amber' | 'rose' }) {
  const colour = {
    sky: 'bg-sky-400', slate: 'bg-slate-300', emerald: 'bg-emerald-500',
    emeraldLite: 'bg-emerald-300', amber: 'bg-amber-400', rose: 'bg-rose-400',
  }[tone]
  return (
    <div className="flex items-center gap-2">
      <span className="w-40 text-[11px] text-slate-700 dark:text-slate-300">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-3 ${colour}`} style={{ width: `${(count / max) * 100}%` }} />
      </div>
      <span className="w-6 text-right text-[11px] font-mono text-slate-600 dark:text-slate-300">{count}</span>
    </div>
  )
}
