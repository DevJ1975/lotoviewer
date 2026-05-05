'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { fetchInsightsMetrics, type InsightsMetrics } from '@soteria/core/insightsMetrics'
import { WorstSpacesCard }   from './_components/WorstSpacesCard'
import { AnomalyCard }       from './_components/AnomalyCard'
import { SupervisorTable }   from './_components/SupervisorTable'

// Risk-intelligence dashboard. Sits one tier deeper than the EHS scorecard
// (/admin/scorecard) — that one answers "how is my safety program doing?"
// with KPIs; this one answers "where should I look harder?" with
// drill-down rows.
//
// Three sections:
//   1. Spaces to investigate — fail-rate ranked, with empty-state copy
//      explaining the MIN_FAIL_RANK_TESTS floor.
//   2. Unusual readings — z-score-based anomaly detection on each
//      atmospheric channel against per-space historical baselines.
//   3. Supervisor activity — issued / signed / closed-clean / for-cause
//      breakdown per supervisor.
//
// Window is selectable; defaults to 90 days because shorter windows
// (30d) often have empty supervisor rows on a small site, and longer
// (1y) loses the "what's happening lately" focus.

const WINDOW_OPTIONS = [
  { label: '30 days',  days: 30 },
  { label: '90 days',  days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year',   days: 365 },
]

export default function InsightsPage() {
  const { profile, loading: authLoading } = useAuth()
  const [windowDays, setWindowDays] = useState(90)
  const [metrics, setMetrics] = useState<InsightsMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const m = await fetchInsightsMetrics(windowDays)
      setMetrics(m)
    } catch (err) {
      console.error('[insights] fetch failed', err)
      setError(err instanceof Error ? err.message : 'Could not load insights')
    } finally {
      setLoading(false)
    }
  }, [windowDays])

  useEffect(() => { load() }, [load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-500" />
            Risk intelligence
          </h1>
          <div className="flex items-center gap-1 flex-wrap">
            {WINDOW_OPTIONS.map(opt => (
              <button
                key={opt.days}
                type="button"
                onClick={() => setWindowDays(opt.days)}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                  windowDays === opt.days
                    ? 'border-brand-navy bg-brand-navy text-white'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Where to look harder — fail-rate hot spots, statistical anomalies, and supervisor mix.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100 flex items-center justify-between gap-3">
          <span>Couldn&apos;t load insights: {error}</span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="shrink-0 px-3 py-1 rounded-md bg-rose-600 text-white text-[11px] font-semibold disabled:opacity-50 hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !metrics && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {metrics && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <WorstSpacesCard rows={metrics.worstSpaces} windowDays={metrics.windowDays} />
            <AnomalyCard anomalies={metrics.anomalies} windowDays={metrics.windowDays} />
          </div>
          <SupervisorTable rows={metrics.supervisors} windowDays={metrics.windowDays} />
        </>
      )}
    </div>
  )
}
