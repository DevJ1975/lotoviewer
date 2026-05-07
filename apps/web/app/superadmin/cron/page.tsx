'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, Play, RefreshCw, Clock, CheckCircle2, XCircle, Activity,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CronRunsResponse, CronRunRow } from '@/app/api/superadmin/cron-runs/route'

// Cron job dashboard. Reads cron_runs (populated by
// withCronLogging wrapping each /api/cron/* handler) and shows:
//   - Per-cron summary tile with last status + run count + error count
//   - Manual "Run now" button per cron
//   - Recent-runs table sorted newest-first

const WINDOW_OPTIONS = [
  { label: '24h', days: 1  },
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const

export default function CronDashboardPage() {
  const [days, setDays]       = useState<number>(7)
  const [data, setData]       = useState<CronRunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<{ path: string; ok: boolean; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/superadmin/cron-runs?days=${days}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as CronRunsResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { void load() }, [load])

  async function runNow(path: string) {
    setRunning(path)
    setRunResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/superadmin/run-cron', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ path }),
      })
      const j = await res.json()
      if (!res.ok) {
        setRunResult({ path, ok: false, message: j?.error ?? `HTTP ${res.status}` })
      } else {
        setRunResult({
          path,
          ok: j.upstreamStatus >= 200 && j.upstreamStatus < 300,
          message: `Upstream ${j.upstreamStatus} in ${j.elapsedMs}ms`,
        })
      }
      // Refetch so the new run appears in the table.
      await load()
    } catch (e) {
      setRunResult({ path, ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Cron jobs</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Last fired, status, and manual trigger for every scheduled cron in <code>vercel.json</code>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {WINDOW_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === opt.days ? 'bg-brand-navy text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
            <p className="font-medium">Couldn&apos;t load cron history</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {runResult && (
        <div className={`p-3 rounded-md text-sm flex items-start gap-2 ${
          runResult.ok
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
            : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
        }`}>
          {runResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
          <div>
            <p className="font-medium font-mono text-xs">{runResult.path}</p>
            <p className="text-xs mt-0.5 opacity-80">{runResult.message}</p>
          </div>
        </div>
      )}

      {/* Per-cron tiles */}
      {!loading && data && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.perCron.length === 0 ? (
              <div className="col-span-full p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-center">
                <Activity className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No cron runs in the last {days} days. Either no cron has fired (Vercel cron not yet active)
                  or the cron_runs table is empty.
                </p>
              </div>
            ) : data.perCron.map(c => (
              <CronTile
                key={c.cron_path}
                tile={c}
                running={running === c.cron_path}
                onRun={() => runNow(c.cron_path)}
              />
            ))}
          </section>

          {/* Recent runs table */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              Recent runs ({data.runs.length})
            </h2>
            {data.runs.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No runs in this window.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2">Started</th>
                    <th className="text-left px-3 py-2">Cron</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-right px-3 py-2">Duration</th>
                    <th className="text-left px-3 py-2">Trigger</th>
                    <th className="text-left px-3 py-2">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {data.runs.map(r => <RunRow key={r.id} run={r} />)}
                </tbody>
              </table>
              </div>
            )}
          </section>
        </>
      )}

      {loading && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}
    </div>
  )
}

function CronTile({ tile, running, onRun }: {
  tile:    CronRunsResponse['perCron'][number]
  running: boolean
  onRun:   () => void
}) {
  const ago = relativeTime(tile.last_started_at)
  const tone =
    tile.last_status === 'success'  ? 'border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/40 dark:bg-emerald-900/10' :
    tile.last_status === 'error'    ? 'border-rose-200 dark:border-rose-700/50 bg-rose-50/40 dark:bg-rose-900/10' :
    tile.last_status === 'running'  ? 'border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10' :
                                      'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
  return (
    <div className={`p-4 rounded-xl border ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate" title={tile.cron_path}>
          {tile.cron_path.replace('/api/cron/', '')}
        </p>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="text-[11px] font-semibold text-brand-navy dark:text-brand-yellow hover:underline inline-flex items-center gap-1 disabled:opacity-40"
          title="Trigger this cron manually"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run now
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        <StatusBadge status={tile.last_status} />
        <span className="text-slate-500 dark:text-slate-400">{ago}</span>
      </div>
      <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
        {tile.last_summary
          ? <span className="line-clamp-2">{tile.last_summary}</span>
          : <span className="italic text-slate-400">no summary</span>}
      </div>
      <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
        <span>{tile.runs_in_window} run{tile.runs_in_window === 1 ? '' : 's'}</span>
        {tile.error_count > 0 && (
          <span className="text-rose-700 dark:text-rose-300 font-semibold">
            {tile.error_count} err
          </span>
        )}
      </div>
    </div>
  )
}

function RunRow({ run }: { run: CronRunRow }) {
  const dur = run.ended_at
    ? Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()))
    : null
  return (
    <tr>
      <td className="px-3 py-2 text-slate-500 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap">
        {new Date(run.started_at).toLocaleString()}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">
        {run.cron_path.replace('/api/cron/', '')}
      </td>
      <td className="px-3 py-2"><StatusBadge status={run.status} /></td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
        {dur === null ? '—' : `${dur} ms`}
      </td>
      <td className="px-3 py-2">
        {run.trigger === 'manual' ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-navy dark:text-brand-yellow">
            manual
          </span>
        ) : (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">scheduled</span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[420px]">
        <div className="truncate" title={run.summary ?? ''}>{run.summary ?? '—'}</div>
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: 'running' | 'success' | 'error' | null }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded font-medium">
        <CheckCircle2 className="h-3 w-3" /> success
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-rose-800 dark:text-rose-200 bg-rose-100 dark:bg-rose-950/40 px-1.5 py-0.5 rounded font-medium">
        <XCircle className="h-3 w-3" /> error
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded font-medium">
        <Loader2 className="h-3 w-3 animate-spin" /> running
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-medium">
      <Clock className="h-3 w-3" /> unknown
    </span>
  )
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)        return 'just now'
  if (ms < 3_600_000)     return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000)    return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}
