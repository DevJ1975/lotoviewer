'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, Sparkles, AlertTriangle, RefreshCw, Mail, Calendar,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Latest 30 daily-report rows + the regenerate button. Auth-gated by
// the parent superadmin layout; the API likewise gates.

interface ReportRow {
  id:           number
  for_date:     string
  generated_at: string
  narrative:    string
  anomalies:    string[]
  delivered_at: string | null
  model:        string
}

const MAX_DAYS = 30

export default function DailyReportPage() {
  const [rows,    setRows]    = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenMessage, setRegenMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setError('Sign in.'); setLoading(false); return }
      // Read directly via RLS-gated supabase client — no separate API
      // route needed for a vanilla SELECT.
      const cutoff = new Date()
      cutoff.setUTCDate(cutoff.getUTCDate() - MAX_DAYS)
      const { data, error: e } = await supabase
        .from('superadmin_daily_reports')
        .select('id, for_date, generated_at, narrative, anomalies, delivered_at, model')
        .gte('for_date', cutoff.toISOString().slice(0, 10))
        .order('for_date', { ascending: false })
      if (e) {
        setError(e.message)
        setRows([])
      } else {
        setRows((data ?? []) as ReportRow[])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Regenerate today's report. Hits the cron route via the same
  // run-cron passthrough other manual triggers use. The bearer must
  // be CRON_SECRET; this client doesn't have it, so we POST through
  // /api/superadmin/run-cron which gates on superadmin + injects.
  const regenerate = useCallback(async () => {
    setRegenerating(true); setRegenMessage(null); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setError('Sign in.'); return }
      const res = await fetch('/api/superadmin/run-cron', {
        method:  'POST',
        headers: {
          'content-type': 'application/json',
          authorization:  `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ path: '/api/cron/superadmin-daily-report' }),
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
      } else {
        setRegenMessage(`Regenerated. ${j?.body?.aiInvocations ?? 0} AI calls in window; ${j?.body?.anomalies ?? 0} anomalies.`)
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRegenerating(false)
    }
  }, [load])

  const today = rows[0]

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calendar className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              Daily report
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Morning narrative + anomaly bullets across all tenants. Cron fires at 12:00 UTC; email lands in superadmins&apos; inboxes; this page is the history view.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={regenerating}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 transition-colors"
        >
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Regenerate today
        </button>
      </header>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      )}

      {regenMessage && (
        <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-200">
          {regenMessage}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {today && (
        <ReportCard row={today} highlighted />
      )}

      {rows.length > 1 && (
        <section className="space-y-3">
          <h2 className="text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold">History</h2>
          {rows.slice(1).map(r => <ReportCard key={r.id} row={r} />)}
        </section>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">
          No reports yet. The cron will publish the first one at the next 12:00 UTC, or you can regenerate now.
        </p>
      )}
    </div>
  )
}

function ReportCard({ row, highlighted }: { row: ReportRow; highlighted?: boolean }) {
  const cls = highlighted
    ? 'border-brand-navy/30 dark:border-brand-yellow/30 bg-white dark:bg-slate-800/50'
    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
  return (
    <article className={`rounded-xl border ${cls} p-4`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{row.for_date}</h3>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
          <span title={row.generated_at}>generated {new Date(row.generated_at).toLocaleString()}</span>
          {row.delivered_at ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Mail className="h-3 w-3" /> emailed
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">not emailed</span>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{row.narrative}</p>

      {row.anomalies.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold mb-1.5 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Anomalies
          </p>
          <ul className="text-xs text-slate-700 dark:text-slate-200 space-y-1 list-disc pl-5">
            {row.anomalies.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
    </article>
  )
}
