'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, RefreshCw, Play, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { REGULATION_SOURCES } from '@soteria/core/regulationSources'
import { describeJob } from '@/lib/regulationJobs'
import type {
  RegulationJobRow, RegulationStatusResponse, RegulationStatusRow,
} from '@/app/api/superadmin/regulation-status/route'

// Regulation freshness panel. Reads regulation_update_checks (maintained by the
// check-regulation-updates cron + the ingester's record-snapshot.sql) and shows,
// per tracked corpus, whether the assistant's RAG is behind the latest eCFR
// amendment. "Check now" triggers the cron via the run-cron allowlist. "Load" asks
// the Python service to fetch a part of the CFR from eCFR and embed it into the
// knowledge base; a dry run (the default) shows what that would do first.

const CRON_PATH = '/api/cron/check-regulation-updates'
const POLL_MS = 5000

export default function RegulationFreshnessPage() {
  const [rows, setRows]       = useState<RegulationStatusRow[] | null>(null)
  const [jobs, setJobs]       = useState<RegulationJobRow[]>([])
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
      else {
        setRows((j as RegulationStatusResponse).rows)
        setJobs((j as RegulationStatusResponse).jobs ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // A load runs in the background service; keep looking while one is in flight.
  const inFlight = jobs.some(j => j.status === 'queued' || j.status === 'running')
  useEffect(() => {
    if (!inFlight) return
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(timer)
  }, [inFlight, load])

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
              bi-monthly <code>check-regulation-updates</code> cron updates this. Federal OSHA 1910 is
              refreshed with <code>scripts/osha_1910_ingest.py</code>; load any other part below.
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
            No tracked regulations yet. Federal OSHA 1910 appears once migration{' '}
            <code>226_regulation_update_checks.sql</code> is applied; a part loaded below appears here after its first load.
          </div>
        ) : (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map(r => <RegulationTile key={r.source} row={r} />)}
          </section>
        )
      )}

      <LoadPanel rows={rows ?? []} jobs={jobs} onQueued={load} />

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

// ── Load into the knowledge base ────────────────────────────────────────────

function LoadPanel({ rows, jobs, onQueued }: { rows: RegulationStatusRow[]; jobs: RegulationJobRow[]; onQueued: () => Promise<void> }) {
  const [source, setSource] = useState(REGULATION_SOURCES[0].key)
  const [date, setDate]     = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // Offer the part's newest known amendment as the snapshot, if the cron has seen one.
  const suggested = rows.find(r => r.source === source)?.latest_amendment ?? ''
  const effectiveDate = date || suggested

  async function submit() {
    setBusy(true)
    setMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/superadmin/regulations/load', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ source, date: effectiveDate, dry_run: dryRun }),
      })
      const j = await res.json()
      if (!res.ok) setMessage({ ok: false, text: j?.error ?? `HTTP ${res.status}` })
      else setMessage({ ok: true, text: dryRun ? 'Dry run queued. Nothing will be written.' : 'Load queued.' })
      await onQueued()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 space-y-4" aria-labelledby="load-heading">
      <div>
        <h2 id="load-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Load into the knowledge base</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Fetches the part from eCFR, splits it into sections and embeds them for the assistant to cite. Only sections
          whose text changed are re-embedded. <strong>Run a dry run first</strong>: it writes nothing and costs nothing,
          and shows how many sections it found so you can check the parse before paying to embed it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Part
          <select
            value={source} onChange={e => setSource(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm"
          >
            {REGULATION_SOURCES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          eCFR snapshot date
          <input
            type="date" value={effectiveDate} onChange={e => setDate(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button" onClick={() => void submit()} disabled={busy || !effectiveDate}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md bg-brand-navy text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {dryRun ? 'Run dry run' : 'Load now'}
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="h-4 w-4" />
        Dry run (fetch and parse only; write nothing)
      </label>
      {!dryRun && (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          A real load replaces this part&apos;s sections for every tenant and spends embedding credits.
        </p>
      )}

      {message && (
        <p role="status" className={`text-xs ${message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{message.text}</p>
      )}

      {jobs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Recent loads</h3>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700">
            {jobs.map(j => <JobRow key={j.id} job={j} />)}
          </ul>
        </div>
      )}
    </section>
  )
}

const JOB_BADGE: Record<RegulationJobRow['status'], string> = {
  queued:    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  running:   'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  succeeded: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  failed:    'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
}

function JobRow({ job }: { job: RegulationJobRow }) {
  const label = REGULATION_SOURCES.find(s => s.key === job.payload.source)?.label ?? job.payload.source ?? 'Unknown part'
  return (
    <li className="p-3 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900 dark:text-slate-100">{label}</span>
        <span className="text-slate-500 dark:text-slate-400">as of {job.payload.date ?? '?'}</span>
        <span className="text-slate-500 dark:text-slate-400">{job.payload.dry_run ? 'dry run' : 'load'}</span>
        <span className={`rounded px-1.5 py-0.5 font-medium ${JOB_BADGE[job.status]}`}>{job.status}</span>
        <span className="ml-auto text-slate-400 dark:text-slate-500">{fmt(job.created_at)}</span>
      </div>
      <p className="text-slate-600 dark:text-slate-300">{describeJob(job)}</p>
    </li>
  )
}
