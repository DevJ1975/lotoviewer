'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { IncidentScorecardMetrics } from '@soteria/core/incidentScorecardMetrics'
import type { FocusResponse } from '@/app/api/insights/scorecard-focus/route'

// On-demand "Where to focus" card. The ranked areas + the score come from the
// deterministic risk model server-side; the AI only writes the prose. A human
// reads the bullets before acting — hence the advisory disclaimer. The card
// degrades gracefully: if the AI is unavailable the server returns the
// deterministic top drivers (source: 'fallback') and the card still renders.

export function FocusCard({
  tenantId,
  incidentMetrics,
}: {
  tenantId: string | null
  incidentMetrics: IncidentScorecardMetrics | null
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FocusResponse | null>(null)

  async function analyze() {
    if (!tenantId) return
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/insights/scorecard-focus', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-active-tenant': tenantId,
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ incidentMetrics }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? `Request failed (${res.status})`)
      }
      setResult((await res.json()) as FocusResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not analyze focus areas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="animate-panel-in rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/15 dark:text-brand-yellow">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">Where to focus</h2>
            <p className="ops-muted text-xs">AI guidance over your deterministic risk drivers.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={loading || !tenantId}
          className="motion-press flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-brand-navy px-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy/90 disabled:opacity-50 dark:bg-brand-yellow dark:text-slate-950 dark:hover:bg-brand-yellow/90"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          <span>{result ? 'Refresh' : 'Analyze'}</span>
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100">
          {error}
        </p>
      )}

      {!result && !error && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Run an analysis to get a ranked, plain-language read on where to work next to lower predicted risk.
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-200">{result.rationale}</p>
          <ol className="space-y-2">
            {result.focusAreas.map((area, i) => {
              const inner = (
                <>
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-navy/10 text-[11px] font-black tabular-nums text-brand-navy dark:bg-brand-yellow/15 dark:text-brand-yellow">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-semibold text-slate-800 group-hover:text-brand-navy dark:text-slate-100 dark:group-hover:text-brand-yellow">
                      {area.title}
                      {area.href && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{area.why}</span>
                  </span>
                </>
              )
              const className = 'group flex gap-2 rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800'
              return (
                <li key={area.key || i}>
                  {area.href
                    ? <Link href={area.href} className={`${className} outline-none hover:border-brand-navy/30 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-navy/40 dark:hover:bg-slate-800/50`}>{inner}</Link>
                    : <div className={className}>{inner}</div>}
                </li>
              )
            })}
          </ol>
          <p className="text-[11px] text-slate-400">
            Advisory guidance for a human to review — not a compliance determination. The risk score is computed deterministically; the assistant never sets it.
          </p>
        </div>
      )}
    </section>
  )
}
