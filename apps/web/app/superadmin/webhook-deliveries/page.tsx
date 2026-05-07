'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, Webhook, RefreshCw,
  CheckCircle2, XCircle, Clock, Copy, Check, ExternalLink,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useUrlState } from '@/hooks/useUrlState'
import type {
  WebhookDeliveriesResponse, WebhookDeliveryRow,
} from '@/app/api/superadmin/webhook-deliveries/route'

const WINDOW_OPTIONS = [
  { label: '24h', days: 1  },
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const

// Free-form text input is intentional — events expand over time
// (mig 013/020 already added permit/test/hot_work flavors and more
// will land) and a hard-coded enum would silently drop new ones.
const EVENT_HINTS = [
  '', 'permit.created', 'permit.signed', 'permit.canceled',
  'test.recorded', 'test.failed',
  'hot_work.created', 'hot_work.signed', 'hot_work.work_complete', 'hot_work.canceled',
] as const

export default function WebhookDeliveriesPage() {
  const [days,   setDays]    = useState<number>(7)
  const [event,  setEvent]   = useUrlState<string>('event', '')
  const [status, setStatus]  = useUrlState<'' | 'ok' | 'fail' | 'pending'>('status', '')
  const [tenantNumber, setTenantNumber] = useUrlState<string>('tenant_number', '')
  const [data, setData]      = useState<WebhookDeliveriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]    = useState<string | null>(null)
  const [openId, setOpenId]  = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const params = new URLSearchParams()
      params.set('days', String(days))
      if (event)        params.set('event', event)
      if (status)       params.set('status', status)
      if (tenantNumber) params.set('tenant_number', tenantNumber)
      const res = await fetch(`/api/superadmin/webhook-deliveries?${params.toString()}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as WebhookDeliveriesResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [days, event, status, tenantNumber])

  useEffect(() => { void load() }, [load])

  // Auto-poll every 15s while the tab is visible AND there's at least
  // one pending delivery — the reconciler runs on a 5-min cron so the
  // operator otherwise has to F5 to see results land. When everything
  // is OK or failed (no pending), polling stops to avoid useless load.
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!data || data.counts.pending === 0) return
    let cancelled = false
    function tick() {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
      void loadRef.current()
    }
    const id = setInterval(tick, 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [data])

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
              <Webhook className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              Webhook deliveries
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Per-attempt log of outbound webhooks fired by{' '}
              <code className="font-mono text-[12px]">public.fire_webhooks()</code>.
              Pending rows wait on the next reconcile cron tick (every 5 min).
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
            aria-label={data && data.counts.pending > 0 ? 'Refresh (auto-refreshing)' : 'Refresh'}
            title={data && data.counts.pending > 0 ? `Auto-refreshing every 15s while ${data.counts.pending} pending` : 'Refresh'}
            className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50 relative"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {data && data.counts.pending > 0 && !loading && (
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Event</span>
          <input
            type="text"
            value={event}
            list="event-hints"
            onChange={e => setEvent(e.target.value)}
            placeholder="any event"
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
          <datalist id="event-hints">
            {EVENT_HINTS.filter(Boolean).map(e => <option key={e} value={e} />)}
          </datalist>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</span>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as '' | 'ok' | 'fail' | 'pending')}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            <option value="">All</option>
            <option value="ok">OK (2xx)</option>
            <option value="fail">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tenant #</span>
          <input
            type="text"
            value={tenantNumber}
            onChange={e => setTenantNumber(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="0042"
            inputMode="numeric"
            maxLength={4}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </label>
      </section>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Couldn&apos;t load webhook deliveries</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-3 gap-3">
            <Tile label="OK"      value={data.counts.ok}      tone="ok" />
            <Tile label="Failed"  value={data.counts.fail}    tone={data.counts.fail > 0 ? 'bad' : 'normal'} />
            <Tile label="Pending" value={data.counts.pending} tone={data.counts.pending > 0 ? 'warn' : 'normal'} />
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              {data.rows.length} row{data.rows.length === 1 ? '' : 's'} (most recent first)
            </div>
            {data.rows.length === 0 ? (
              <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
                No deliveries in this window with these filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[920px]">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left px-3 py-2">When</th>
                      <th className="text-left px-3 py-2">Event</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Subscription → URL</th>
                      <th className="text-left px-3 py-2">Tenant</th>
                      <th className="text-right px-3 py-2">Latency</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {data.rows.map(r => (
                      <Row
                        key={r.id}
                        r={r}
                        open={openId === r.id}
                        onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                      />
                    ))}
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

function Row({
  r, open, onToggle,
}: { r: WebhookDeliveryRow; open: boolean; onToggle: () => void }) {
  const isPending = r.completed_at == null
  const isOk      = !isPending && r.response_status != null && r.response_status >= 200 && r.response_status < 300

  return (
    <>
      <tr className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
          {new Date(r.fired_at).toLocaleString()}
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">{r.event}</td>
        <td className="px-3 py-2">
          <StatusBadge pending={isPending} ok={isOk} status={r.response_status} />
        </td>
        <td className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[280px]">
          <div className="font-medium truncate" title={r.subscription_name ?? ''}>
            {r.subscription_name ?? <span className="italic text-slate-400">deleted</span>}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            <span className="truncate" title={r.subscription_url}>{r.subscription_url}</span>
            <CopyButton value={r.subscription_url} />
          </div>
        </td>
        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 max-w-[160px]">
          {r.tenant_id && r.tenant_number ? (
            <Link
              href={`/superadmin/tenants/${r.tenant_number}`}
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 truncate text-brand-navy dark:text-brand-yellow hover:underline"
              title={`#${r.tenant_number} · ${r.tenant_name ?? ''}`}
            >
              <span className="truncate">{r.tenant_name ?? `#${r.tenant_number}`}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </Link>
          ) : (
            <span className="italic text-slate-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-[11px] text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
          {r.duration_ms != null ? `${r.duration_ms} ms` : '—'}
        </td>
        <td className="px-3 py-2 text-right text-[11px] text-slate-400">
          {open ? '−' : '+'}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50 dark:bg-slate-900/40">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
              <div>
                <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">Error</p>
                <pre className="whitespace-pre-wrap font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 rounded p-2 max-h-40 overflow-auto">
                  {r.error ?? '—'}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">Response body (first 4 KB)</p>
                <pre className="whitespace-pre-wrap font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 rounded p-2 max-h-40 overflow-auto">
                  {r.response_body ?? '—'}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard blocked — fail silently, user can still triple-click */ }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : 'Copy URL'}
      title={copied ? 'Copied' : 'Copy URL'}
      className="shrink-0 p-0.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700/70 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
    >
      {copied
        ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        : <Copy className="h-3 w-3" />}
    </button>
  )
}

function StatusBadge({
  pending, ok, status,
}: { pending: boolean; ok: boolean; status: number | null }) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded font-medium">
        <Clock className="h-3 w-3" /> pending
      </span>
    )
  }
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded font-medium">
        <CheckCircle2 className="h-3 w-3" /> {status ?? 'ok'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-rose-800 dark:text-rose-200 bg-rose-100 dark:bg-rose-950/40 px-1.5 py-0.5 rounded font-medium">
      <XCircle className="h-3 w-3" /> {status ?? 'err'}
    </span>
  )
}
