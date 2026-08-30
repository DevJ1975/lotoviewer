'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, RefreshCw, Play, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { RegulationStatusResponse, RegulationStatusRow } from '@/app/api/superadmin/regulation-status/route'

// Regulation freshness panel. Reads regulation_update_checks (maintained by the
// check-regulation-updates cron + the ingester's record-snapshot.sql) and shows,
// per tracked corpus, whether the assistant's RAG is behind the latest eCFR
// amendment. "Check now" triggers the cron via the run-cron allowlist.

const CRON_PATH = '/api/cron/check-regulation-updates'

export default function RegulationFreshnessPage() {
  const [rows, setRows]       = useState<RegulationStatusRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/superadmin/regulation-status', {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) { setError(j?.error ?? `HTTP ${res.status}`); setRows(null) }
      else setRows((j as RegulationStatusResponse).rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function checkNow() {
    setChecking(true)
    setCheckResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/superadmin/run-cron', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ path: CRON_PATH }),
      })
      const j = await res.json()
      if (!res.ok) setCheckResult({ ok: false, message: j?.error ?? `HTTP ${res.status}` })
      else setCheckResult({
        ok: j.upstreamStatus >= 200 && j.upstreamStatus < 300,
        message: `Upstream ${j.upstreamStatus} in ${j.elapsedMs}ms`,
      })
      await load()
    } catch (e) {
      setCheckResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Regulation freshness</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Whether the assistant&apos;s RAG corpus is behind the latest eCFR amendment. The
              bi-monthly <code>check-regulation-updates</code> cron updates this; re-ingest with{' '}
              <code>scripts/osha_1910_ingest.py</code> when an update is due.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void checkNow()}
            disabled={checking}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-brand-navy text-white hover:opacity-90 disabled:opacity-50"
            title="Trigger the freshness cron now"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Check now
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh"
            disabled={loading}
            className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Couldn&apos;t load regulation status</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {checkResult && (
        <div className={`p-3 rounded-md text-sm flex items-start gap-2 ${
          checkResult.ok
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
            : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
        }`}>
          {checkResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
          <p className="text-xs">{checkResult.message}</p>
        </div>
      )}

      {!loading && rows && (
        rows.length === 0 ? (
          <div className="p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-center text-sm text-slate-500 dark:text-slate-400">
            No tracked regulations. Apply migration <code>222_regulation_update_checks.sql</code>.
          </div>
        ) : (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map(r => <RegulationTile key={r.source} row={r} />)}
          </section>
        )
      )}

      {loading && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}
    </div>
  )
}

function RegulationTile({ row }: { row: RegulationStatusRow }) {
  const tone = row.needs_update
    ? 'border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10'
    : 'border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/40 dark:bg-emerald-900/10'
  return (
    <div className={`p-4 rounded-xl border ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={row.title}>{row.title}</h3>
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            {row.ecfr_title} CFR {row.ecfr_part}
          </p>
        </div>
        <FreshnessBadge needsUpdate={row.needs_update} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Field label="Corpus snapshot" value={row.ingested_snapshot ?? 'never ingested'} />
        <Field label="Latest eCFR amendment" value={row.latest_amendment ?? '—'} />
        <Field label="Last checked" value={fmt(row.last_checked_at)} />
        <Field label="Last notified" value={fmt(row.last_notified_at)} />
      </dl>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="text-slate-700 dark:text-slate-300 tabular-nums">{value}</dd>
    </div>
  )
}

function FreshnessBadge({ needsUpdate }: { needsUpdate: boolean }) {
  return needsUpdate ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded font-medium shrink-0">
      <AlertTriangle className="h-3 w-3" /> Update due
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded font-medium shrink-0">
      <CheckCircle2 className="h-3 w-3" /> Current
    </span>
  )
}

function fmt(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)     return 'just now'
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}
