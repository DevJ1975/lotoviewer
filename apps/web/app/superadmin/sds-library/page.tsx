'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Check, X, RefreshCw, Database } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Stats {
  total: number
  statusCounts: Record<string, number>
  topHosts: Array<{ host: string; count: number; allowlisted: boolean }>
  unallowlistedHosts: Array<{ host: string; count: number; allowlisted: boolean }>
}
interface PendingRow {
  id: string
  canonical_name: string
  manufacturer: string | null
  cas_primary: string | null
  source_host: string | null
  source_url: string | null
  review_status: string
}

export default function SuperadminSdsLibraryPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [pending, setPending] = useState<PendingRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const bearer = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const headers = await bearer()
      const [statsRes, pendingRes] = await Promise.all([
        fetch('/api/superadmin/sds-library/stats', { headers }),
        fetch('/api/superadmin/sds-library/chemicals?status=pending&limit=200', { headers }),
      ])
      const statsBody = await statsRes.json()
      if (!statsRes.ok) { setError(statsBody.error ?? `HTTP ${statsRes.status}`); return }
      setStats(statsBody)
      const pendingBody = await pendingRes.json()
      if (pendingRes.ok) setPending(pendingBody.chemicals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [bearer])

  useEffect(() => { void load() }, [load])

  const review = useCallback(async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/superadmin/sds-library/chemicals/${id}/review`, {
        method: 'POST',
        headers: { ...(await bearer()), 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error ?? `Failed (HTTP ${res.status})`); return }
      setPending(p => (p ?? []).filter(r => r.id !== id))
      toast.success(action === 'approve' ? 'Approved' : 'Rejected')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }, [bearer, load])

  const runCron = useCallback(async (path: string, label: string) => {
    setRunning(path)
    try {
      const res = await fetch('/api/superadmin/run-cron', {
        method: 'POST',
        headers: { ...(await bearer()), 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error ?? `Failed (HTTP ${res.status})`); return }
      toast.success(`${label}: ${JSON.stringify(body.upstreamBody ?? {})}`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
    }
  }, [bearer, load])

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex items-center gap-2">
        <Database className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">SDS Library</h1>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void runCron('/api/cron/sds-library-seed-drip', 'Seed drip')}
          disabled={running !== null}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
          {running === '/api/cron/sds-library-seed-drip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Run seed drip
        </button>
        <button type="button" onClick={() => void runCron('/api/cron/sds-library-verify', 'Verify')}
          disabled={running !== null}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
          {running === '/api/cron/sds-library-verify' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Run verify
        </button>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(['approved', 'pending', 'needs_research', 'rejected'] as const).map(s => (
          <div key={s} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
            <div className="text-xs uppercase font-medium text-slate-500">{s.replace('_', ' ')}</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">{stats?.statusCounts[s] ?? 0}</div>
          </div>
        ))}
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
          <div className="text-xs uppercase font-medium text-indigo-700 dark:text-indigo-300">Total</div>
          <div className="text-2xl font-bold text-indigo-900 dark:text-indigo-100 mt-1">{stats?.total ?? 0}</div>
        </div>
      </section>

      {stats && stats.unallowlistedHosts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Hosts not in the fetch allowlist
          </h2>
          <p className="text-xs text-slate-500">Add high-count hosts to <code>CHEMICAL_SDS_HOST_ALLOWLIST</code> so the strict-path fetch trusts them.</p>
          <div className="flex flex-wrap gap-2">
            {stats.unallowlistedHosts.map(h => (
              <span key={h.host} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {h.host} <span className="opacity-70">×{h.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Pending review</h2>
        {pending === null ? (
          <div className="flex items-center gap-2 text-slate-500 py-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : pending.length === 0 ? (
          <div className="text-sm text-slate-500 py-4">Nothing awaiting review.</div>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            {pending.map(row => (
              <li key={row.id} className="px-4 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {row.canonical_name}
                    {row.manufacturer && <span className="text-xs text-slate-500"> · {row.manufacturer}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 flex flex-wrap gap-x-3">
                    {row.cas_primary && <span>CAS: {row.cas_primary}</span>}
                    {row.source_url && (
                      <a href={row.source_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline truncate max-w-[280px]">
                        {row.source_host ?? row.source_url}
                      </a>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => void review(row.id, 'approve')} disabled={busyId === row.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
                  <Check className="w-4 h-4" /> Approve
                </button>
                <button type="button" onClick={() => void review(row.id, 'reject')} disabled={busyId === row.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
                  <X className="w-4 h-4" /> Reject
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
