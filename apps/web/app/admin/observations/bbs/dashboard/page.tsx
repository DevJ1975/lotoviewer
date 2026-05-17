'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Eye, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  bandRatio,
  summarizeObservations,
  RATIO_BAND_LABEL,
  type BbsObservationV2Row,
  type BbsRatioBand,
} from '@soteria/core/bbsMetricsV2'

// /admin/observations/bbs/dashboard — leading-indicator dashboard for BBS v2.
//
// Three sections, all driven by the 30-day window:
//   1. Headline tile: safe-to-unsafe ratio + band colour.
//   2. Mini-funnel: total / safe / unsafe / follow-ups due.
//   3. Follow-ups-due list (top 10) with the original description.

const BAND_TILE: Record<BbsRatioBand, string> = {
  red:    'bg-rose-100    text-rose-900    dark:bg-rose-950/40    dark:text-rose-100',
  yellow: 'bg-amber-100   text-amber-900   dark:bg-amber-950/40   dark:text-amber-100',
  green:  'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
}

interface ObservationDashboardRow extends BbsObservationV2Row {
  description: string
  location_text: string | null
}

const WINDOW_DAYS = 30

export default function BbsDashboardPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [rows, setRows]     = useState<ObservationDashboardRow[] | null>(null)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
    const { data, error: err } = await supabase
      .from('bbs_observations_v2')
      .select('id, category, severity, follow_up_required, follow_up_completed_at, feedback_given_at, description, location_text, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (err) { setError(formatSupabaseError(err, 'load observations')); return }
    setRows((data ?? []) as ObservationDashboardRow[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  const summary = useMemo(() => summarizeObservations(rows ?? []), [rows])
  const band = bandRatio(summary.safeToUnsafeRatio)

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const followUpsDueRows = (rows ?? []).filter(r => r.follow_up_required && !r.follow_up_completed_at).slice(0, 10)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <div className="mt-2 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Eye className="h-6 w-6 text-brand-navy" />
              BBS leading indicators
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Trailing {WINDOW_DAYS}-day window. Safe-to-unsafe ratio is the leading
              indicator: ≥4:1 is the industry-healthy band.
            </p>
          </div>
          <Link
            href="/bbs/observe"
            className="px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            New observation
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : (
        <>
          <section className={`rounded-2xl p-6 ${BAND_TILE[band]}`}>
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">Safe : Unsafe ratio</p>
            <p className="mt-1 text-5xl font-black tabular-nums">
              {summary.safeToUnsafeRatio === null ? '—' : `${summary.safeToUnsafeRatio.toFixed(2)} : 1`}
            </p>
            <p className="mt-2 text-sm font-semibold">{RATIO_BAND_LABEL[band]}</p>
          </section>

          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Total" value={summary.total} />
            <Tile label="Safe behaviors" value={summary.safeBehaviorCount} tone="emerald" />
            <Tile label="Unsafe (acts + conditions)" value={summary.unsafeCount} tone="rose" />
            <Tile label="Follow-ups due" value={summary.followUpsDue} tone="amber" />
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Follow-ups due</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{followUpsDueRows.length} of {summary.followUpsDue} most recent</p>
            </header>
            {followUpsDueRows.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No outstanding follow-ups. Great job.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {followUpsDueRows.map(r => (
                  <li key={r.id} className="px-5 py-3">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{r.description.slice(0, 120)}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {r.location_text ?? '—'} · {r.severity} · {new Date(r.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' | 'amber' }) {
  const bg = tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100'
           : tone === 'rose'    ? 'bg-rose-50    dark:bg-rose-950/40    text-rose-900    dark:text-rose-100'
           : tone === 'amber'   ? 'bg-amber-50   dark:bg-amber-950/40   text-amber-900   dark:text-amber-100'
           :                      'bg-slate-50   dark:bg-slate-900/40   text-slate-900   dark:text-slate-100'
  return (
    <div className={`rounded-xl px-4 py-3 ${bg}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-3xl font-black tabular-nums mt-1">{value}</p>
    </div>
  )
}
