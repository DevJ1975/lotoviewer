'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, Mail, RefreshCw, CheckCircle2, XCircle, MinusCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useUrlState } from '@/hooks/useUrlState'
import type { EmailLogResponse, EmailLogRow } from '@/app/api/superadmin/email-log/route'

const WINDOW_OPTIONS = [
  { label: '24h', days: 1  },
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const

const KIND_OPTIONS = ['', 'invite', 'training-expiry', 'risk-review', 'review-link', 'support-ticket'] as const

export default function EmailLogPage() {
  const [days, setDays]       = useState<number>(7)
  const [kind,   setKind]     = useUrlState<string>('kind', '')
  const [status, setStatus]   = useUrlState<'' | 'sent' | 'failed' | 'skipped'>('status', '')
  const [data, setData]       = useState<EmailLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const params = new URLSearchParams()
      params.set('days', String(days))
      if (kind)   params.set('kind', kind)
      if (status) params.set('status', status)
      const res = await fetch(`/api/superadmin/email-log?${params.toString()}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as EmailLogResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [days, kind, status])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Mail className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              Email log
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Every Resend send the app made — invites, training reminders, risk reviews, review links.
              Filter by kind, status, or window.
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
            disabled={loading}
            aria-label="Refresh"
            className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Kind</span>
          <select
            value={kind}
            onChange={e => setKind(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            {KIND_OPTIONS.map(k => (
              <option key={k} value={k}>{k || 'All kinds'}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</span>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as '' | 'sent' | 'failed' | 'skipped')}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped (no API key)</option>
          </select>
        </label>
      </section>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Couldn&apos;t load email log</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-3 gap-3">
            <Tile label="Sent"    value={data.counts.sent}    tone="ok"   />
            <Tile label="Failed"  value={data.counts.failed}  tone={data.counts.failed > 0 ? 'bad' : 'normal'} />
            <Tile label="Skipped" value={data.counts.skipped} tone={data.counts.skipped > 0 ? 'warn' : 'normal'} />
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              {data.rows.length} row{data.rows.length === 1 ? '' : 's'} (most recent first)
            </div>
            {data.rows.length === 0 ? (
              <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
                No emails in this window with these filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[840px]">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-left px-3 py-2">Kind</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">To</th>
                    <th className="text-left px-3 py-2">Tenant</th>
                    <th className="text-left px-3 py-2">Subject / Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {data.rows.map(r => <Row key={r.id} r={r} />)}
                </tbody>
              </table>
              </div>
            )}
          </section>
        </>
      )}

      {loading && !data && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'bad' | 'warn' | 'normal' }) {
  const cls =
    tone === 'ok'   ? 'border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/40 dark:bg-emerald-900/10' :
    tone === 'bad'  ? 'border-rose-200 dark:border-rose-700/50 bg-rose-50/40 dark:bg-rose-900/10' :
    tone === 'warn' ? 'border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10' :
                      'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
  return (
    <div className={`p-3 rounded-lg border ${cls}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
    </div>
  )
}

function Row({ r }: { r: EmailLogRow }) {
  return (
    <tr>
      <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
        {new Date(r.occurred_at).toLocaleString()}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">{r.kind}</td>
      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-mono text-[11px] max-w-[200px]">
        <div className="truncate" title={r.to_email}>{r.to_email}</div>
      </td>
      <td className="px-3 py-2 text-slate-500 dark:text-slate-400 max-w-[160px]">
        <div className="truncate" title={r.tenant_name ?? ''}>
          {r.tenant_name ?? <span className="italic text-slate-400">—</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[420px]">
        <div className="truncate" title={r.subject ?? r.error_text ?? ''}>
          {r.status === 'failed' || r.status === 'skipped'
            ? <span className="text-rose-700 dark:text-rose-300">{r.error_text ?? '—'}</span>
            : (r.subject ?? '—')}
        </div>
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: 'sent' | 'failed' | 'skipped' }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded font-medium">
        <CheckCircle2 className="h-3 w-3" /> sent
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-rose-800 dark:text-rose-200 bg-rose-100 dark:bg-rose-950/40 px-1.5 py-0.5 rounded font-medium">
        <XCircle className="h-3 w-3" /> failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded font-medium">
      <MinusCircle className="h-3 w-3" /> skipped
    </span>
  )
}
