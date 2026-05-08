'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { fetchBBSMetrics, type BBSMetrics } from '@soteria/core/bbsMetrics'
import { Leaderboard } from '../_components/Leaderboard'

export default function BBSScorecardPage() {
  const { tenant } = useTenant()
  const [metrics, setMetrics] = useState<BBSMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    void fetchBBSMetrics().then(m => {
      setMetrics(m)
      setLoading(false)
    })
  }, [tenant?.id])

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading scorecard…
      </div>
    )
  }
  if (!metrics) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-slate-500">
        Could not load metrics.
      </div>
    )
  }

  const closeOutPct = Math.round(metrics.closeOutRate * 100)
  const avgRisk = metrics.avgRiskScore != null ? metrics.avgRiskScore.toFixed(1) : '—'

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/bbs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" />
        Back to BBS
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">BBS Scorecard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Trailing 30-day snapshot. Composite EHS score blends participation,
          close-out rate, and severity weighting.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center">
        <div className="text-xs uppercase text-slate-500 mb-2">EHS Score (BBS contribution)</div>
        <div className="text-6xl font-bold text-teal-600 dark:text-teal-400">{metrics.ehsScore}</div>
        <div className="text-xs text-slate-500 mt-1">out of 100</div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-xs uppercase text-slate-500">Participation (30d)</div>
          <div className="text-3xl font-bold mt-1">{metrics.newLast30Days}</div>
          <div className="text-xs text-slate-500">submissions</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-xs uppercase text-slate-500">Close-out rate</div>
          <div className="text-3xl font-bold mt-1">{closeOutPct}%</div>
          <div className="text-xs text-slate-500">of unsafe observations</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-xs uppercase text-slate-500">Avg risk score</div>
          <div className="text-3xl font-bold mt-1">{avgRisk}</div>
          <div className="text-xs text-slate-500">of 9 (lower = safer)</div>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <div className="text-xs uppercase text-amber-700 dark:text-amber-300">Unsafe acts</div>
          <div className="text-2xl font-bold mt-1 text-amber-900 dark:text-amber-100">{metrics.totalUnsafeAct}</div>
          <div className="text-xs text-slate-500">all-time</div>
        </div>
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 p-4">
          <div className="text-xs uppercase text-rose-700 dark:text-rose-300">Unsafe conditions</div>
          <div className="text-2xl font-bold mt-1 text-rose-900 dark:text-rose-100">{metrics.totalUnsafeCondition}</div>
          <div className="text-xs text-slate-500">all-time</div>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
          <div className="text-xs uppercase text-emerald-700 dark:text-emerald-300">Safe behaviors</div>
          <div className="text-2xl font-bold mt-1 text-emerald-900 dark:text-emerald-100">{metrics.totalSafeBehavior}</div>
          <div className="text-xs text-slate-500">all-time</div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Top contributors</h2>
        <Leaderboard rows={metrics.leaderboard} />
      </section>
    </div>
  )
}
