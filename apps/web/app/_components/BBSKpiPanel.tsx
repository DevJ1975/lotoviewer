'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Eye, Loader2, Trophy } from 'lucide-react'
import { fetchBBSMetrics, type BBSMetrics } from '@soteria/core/bbsMetrics'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { Avatar } from '@/components/ui/Avatar'

// BBS intelligence panel for the home dashboard. Same gating pattern
// as NearMissKpiPanel — tenant module toggle hides the entire panel.
//
// Three KPI tiles, an EHS scorecard contribution number, and the top-3
// leaderboard preview with avatars (the gamification surface that
// drives recurring participation).

const REFRESH_MS = 5 * 60 * 1000

export default function BBSKpiPanel() {
  const { tenant, loading: tenantLoading } = useTenant()
  const visible = useMemo(
    () => isModuleVisible('bbs', tenant?.modules),
    [tenant?.modules],
  )

  const [metrics, setMetrics] = useState<BBSMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const m = await fetchBBSMetrics()
      setMetrics(m)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tenantLoading || !visible) return
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [tenantLoading, visible, load])

  if (tenantLoading || !visible) return null

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            <Eye className="w-3 h-3" /> Behavior-Based Safety
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Observation program
          </h2>
        </div>
        <Link
          href="/bbs"
          className="text-xs font-semibold text-brand-navy hover:underline inline-flex items-center gap-1"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      {loading && metrics === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : metrics === null || metrics.totalAll === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          <p className="text-xs italic text-slate-400">No BBS submissions yet.</p>
          <Link href="/bbs/new" className="mt-2 inline-block text-xs font-medium text-brand-navy hover:underline">
            File the first one →
          </Link>
        </div>
      ) : (
        <Inner metrics={metrics} />
      )}
    </section>
  )
}

function Inner({ metrics }: { metrics: BBSMetrics }) {
  const closeOutPct = Math.round(metrics.closeOutRate * 100)
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile label="EHS score" value={metrics.ehsScore} subtitle="of 100" tone="primary" href="/bbs/scorecard" />
        <KpiTile label="Submissions (30d)" value={metrics.newLast30Days} subtitle="participation" href="/bbs" />
        <KpiTile label="Close-out" value={`${closeOutPct}%`} subtitle="unsafe closed" href="/bbs" />
        <KpiTile label="Total all-time" value={metrics.totalAll} href="/bbs" />
      </div>

      {metrics.leaderboard.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2 inline-flex items-center gap-1">
            <Trophy className="w-3 h-3" /> Top contributors
          </div>
          <ul className="space-y-1.5">
            {metrics.leaderboard.slice(0, 3).map((row, idx) => (
              <li key={row.user_id} className="flex items-center gap-2.5 text-sm">
                <span className="w-5 text-center text-xs font-semibold text-slate-500">{idx + 1}</span>
                <Avatar src={row.avatar_url} name={row.full_name} size="sm" />
                <span className="flex-1 truncate text-slate-800 dark:text-slate-200">
                  {row.full_name ?? 'Unknown'}
                </span>
                <span className="shrink-0 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {row.points_total} pts
                </span>
              </li>
            ))}
          </ul>
          <Link href="/bbs/leaderboard" className="mt-2 inline-block text-xs text-brand-navy hover:underline">
            See full leaderboard →
          </Link>
        </div>
      )}
    </>
  )
}

interface TileProps {
  label:    string
  value:    number | string
  subtitle?: string
  tone?:    'neutral' | 'primary'
  href?:    string
}

function KpiTile({ label, value, subtitle, tone = 'neutral', href }: TileProps) {
  const toneClass =
    tone === 'primary' ? 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20'
                       : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
  const valueClass =
    tone === 'primary' ? 'text-teal-700 dark:text-teal-300'
                       : 'text-slate-900 dark:text-slate-100'

  const inner = (
    <div className={`rounded-xl border p-3 ${toneClass} transition-colors hover:shadow-sm`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</div>
      {subtitle && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
