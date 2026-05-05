'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, Inbox, CheckCircle2, Archive, AlertTriangle,
  Clock, Mail,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDuration } from '@/lib/support/ticketMetrics'
import type { SupportMetricsResponse } from '@/app/api/superadmin/support-metrics/route'

// Superadmin metrics view for AI support tickets.
//
// Reads /api/superadmin/support-metrics which gates on requireSuperadmin.
// Shows: KPI tiles (open / resolved / archived / email-failed),
// by-priority and by-tenant breakdowns, time-to-resolve stats,
// and a daily opened-vs-resolved trend.

const WINDOW_OPTIONS = [
  { label: '7d',   days: 7   },
  { label: '30d',  days: 30  },
  { label: '90d',  days: 90  },
  { label: '1y',   days: 365 },
] as const

function fmt(n: number) { return n.toLocaleString() }

const PRIORITY_PILL: Record<'safety_critical' | 'low_confidence' | 'user_requested', string> = {
  safety_critical: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
  low_confidence:  'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  user_requested:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export default function SupportMetricsPage() {
  const [days, setDays]       = useState<number>(30)
  const [data, setData]       = useState<SupportMetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/superadmin/support-metrics?days=${days}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as SupportMetricsResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { void load() }, [load])

  const summary = data?.summary

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin/support" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to support tickets">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">Support metrics</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Triage health by priority, tenant, and time-to-resolve.
            </p>
          </div>
        </div>
        <div className="shrink-0 inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
          {WINDOW_OPTIONS.map(opt => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === opt.days
                  ? 'bg-brand-navy text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      {loading && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Couldn&apos;t load metrics</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          {/* KPI tiles */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile
              icon={<Inbox className="h-4 w-4" />}
              label="Open"
              value={fmt(summary.totals.open)}
              sub={summary.oldestOpenAgeDays !== null ? `oldest ${summary.oldestOpenAgeDays}d` : 'none'}
              tone={summary.totals.open > 0 ? 'warn' : 'normal'}
            />
            <KpiTile
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Resolved"
              value={fmt(summary.totals.resolved)}
              sub="≤ 30 days ago"
            />
            <KpiTile
              icon={<Archive className="h-4 w-4" />}
              label="Archived"
              value={fmt(summary.totals.archived)}
              sub="cold storage"
            />
            <KpiTile
              icon={<Mail className="h-4 w-4" />}
              label="Email failed"
              value={fmt(summary.totals.emailFailed)}
              sub="escalation undelivered"
              tone={summary.totals.emailFailed > 0 ? 'warn' : 'normal'}
            />
          </section>

          {/* Resolution speed */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SpeedTile label="Median time to resolve"  value={formatDuration(summary.resolutionMs.median)} />
            <SpeedTile label="P90 time to resolve"    value={formatDuration(summary.resolutionMs.p90)} />
            <SpeedTile label="Mean time to resolve"   value={formatDuration(summary.resolutionMs.mean)} sub={`${summary.resolutionMs.count} tickets`} />
          </section>

          {/* By priority */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              By priority
            </h2>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left px-4 py-2">Priority</th>
                  <th className="text-right px-4 py-2">Open</th>
                  <th className="text-right px-4 py-2">Resolved</th>
                  <th className="text-right px-4 py-2">Archived</th>
                  <th className="text-right px-4 py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {summary.byPriority.map(p => (
                  <tr key={p.reason}>
                    <td className="px-4 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_PILL[p.reason]}`}>
                        {p.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(p.open)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt(p.resolved)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt(p.archived)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* By tenant */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              By tenant
            </h2>
            {summary.byTenant.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No tickets in this window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-2">Tenant</th>
                    <th className="text-right px-4 py-2">Open</th>
                    <th className="text-right px-4 py-2">Resolved</th>
                    <th className="text-right px-4 py-2">Archived</th>
                    <th className="text-right px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {summary.byTenant.map(t => (
                    <tr key={t.tenantId ?? 'none'}>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                        {t.tenantName ?? <span className="italic text-slate-400">(no tenant)</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(t.open)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt(t.resolved)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt(t.archived)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Daily trend */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              Daily — opened vs resolved
            </h2>
            {summary.daily.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No tickets in this window.</p>
            ) : (
              <DailyDualBars daily={summary.daily} />
            )}
          </section>

          {data.truncated && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Result truncated at {fmt(data.rowsRead)} rows; widen the window with care.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function KpiTile({
  icon, label, value, sub, tone = 'normal',
}: {
  icon:  React.ReactNode
  label: string
  value: string
  sub?:  string
  tone?: 'normal' | 'warn'
}) {
  const toneCls = tone === 'warn'
    ? 'border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10'
    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
  return (
    <div className={`p-4 rounded-xl border ${toneCls}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function SpeedTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Clock className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function DailyDualBars({ daily }: { daily: NonNullable<SupportMetricsResponse['summary']>['daily'] }) {
  const max = Math.max(...daily.flatMap(d => [d.opened, d.resolved]), 1)
  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-1 h-28">
        {daily.map(d => {
          const openH = (d.opened / max) * 100
          const resH  = (d.resolved / max) * 100
          return (
            <div key={d.day} className="flex-1 min-w-[6px] flex flex-col items-stretch gap-0.5" title={`${d.day}: opened ${d.opened}, resolved ${d.resolved}`}>
              <div className="w-full bg-brand-navy/60 dark:bg-brand-yellow/60 hover:bg-brand-navy dark:hover:bg-brand-yellow transition-colors rounded-t" style={{ height: `${Math.max(openH, 2)}%` }} />
              <div className="w-full bg-emerald-500/60 hover:bg-emerald-500 transition-colors rounded-b" style={{ height: `${Math.max(resH, 2)}%` }} />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono">
        <span>{daily[0]?.day}</span>
        <span>{daily[daily.length - 1]?.day}</span>
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-brand-navy/60 dark:bg-brand-yellow/60" />Opened</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/60" />Resolved</span>
      </div>
      {daily.length > 0 && (
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" aria-hidden="true">
          <AlertTriangle className="h-3 w-3 inline-block mr-1 opacity-0" />
        </div>
      )}
    </div>
  )
}
