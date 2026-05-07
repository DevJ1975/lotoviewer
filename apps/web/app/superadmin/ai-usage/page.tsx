'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, AlertCircle, Activity, DollarSign, Zap, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { UsageResponse } from '@/app/api/superadmin/ai-usage/route'

// Cost + observability dashboard for the AI surfaces.
//
// Reads /api/superadmin/ai-usage which gates on requireSuperadmin.
// AuthGate prevents non-superadmins from rendering this page client-side;
// the route gate is the security boundary.
//
// Cost numbers are estimates — see the route's `caveat` field, surfaced
// at the bottom of this page so superadmins don't read these as billing.

const WINDOW_OPTIONS = [
  { label: '24h',  days: 1   },
  { label: '7d',   days: 7   },
  { label: '30d',  days: 30  },
  { label: '90d',  days: 90  },
] as const

function fmtUsd(n: number): string {
  return n < 0.01 ? '$0.00' : `$${n.toFixed(2)}`
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

const STATUS_PILL: Record<'success' | 'rate_limited' | 'error', string> = {
  success:      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  rate_limited: 'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  error:        'bg-rose-100    text-rose-800    dark:bg-rose-900/40    dark:text-rose-200',
}

export default function AiUsagePage() {
  const [days, setDays]       = useState<number>(30)
  const [data, setData]       = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/superadmin/ai-usage?days=${days}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(body as UsageResponse)
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
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">
              Superadmin
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
              AI usage & cost
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Cross-tenant Anthropic invocation log. Trend, attribution, and failure visibility.
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
            <p className="font-medium">Couldn&apos;t load usage</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          {/* KPI tiles */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile
              icon={<Activity className="h-4 w-4" />}
              label="Invocations"
              value={fmtNum(summary.totals.invocations)}
              sub={`${summary.totals.success} success`}
            />
            <KpiTile
              icon={<Zap className="h-4 w-4" />}
              label="Tokens"
              value={fmtTokens(summary.totals.inputTokens + summary.totals.outputTokens)}
              sub={`${fmtTokens(summary.totals.inputTokens)} in / ${fmtTokens(summary.totals.outputTokens)} out`}
            />
            <KpiTile
              icon={<DollarSign className="h-4 w-4" />}
              label="Est. spend"
              value={fmtUsd(summary.totals.estCostUsd)}
              sub="estimate, see caveat"
            />
            <KpiTile
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Failures"
              value={fmtNum(summary.totals.errors + summary.totals.rateLimited)}
              sub={`${summary.totals.errors} err / ${summary.totals.rateLimited} rl`}
              tone={summary.totals.errors + summary.totals.rateLimited > 0 ? 'warn' : 'normal'}
            />
          </section>

          {/* By surface */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              By surface
            </h2>
            {summary.bySurface.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No invocations in this window.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-2">Surface</th>
                    <th className="text-right px-4 py-2">Invocations</th>
                    <th className="text-right px-4 py-2">Input tokens</th>
                    <th className="text-right px-4 py-2">Output tokens</th>
                    <th className="text-right px-4 py-2">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {summary.bySurface.map(s => (
                    <tr key={s.surface}>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{s.surface}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(s.invocations)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtTokens(s.inputTokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtTokens(s.outputTokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtUsd(s.estCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>

          {/* By tenant */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              By tenant
            </h2>
            {summary.byTenant.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No invocations in this window.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-2">Tenant</th>
                    <th className="text-right px-4 py-2">Invocations</th>
                    <th className="text-right px-4 py-2">Tokens</th>
                    <th className="text-right px-4 py-2">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {summary.byTenant.map(t => (
                    <tr key={t.tenantId ?? 'none'}>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                        {t.tenantName ?? <span className="italic text-slate-400">(no tenant)</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(t.invocations)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                        {fmtTokens(t.inputTokens + t.outputTokens)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtUsd(t.estCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>

          {/* Daily trend */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              Daily trend
            </h2>
            {summary.daily.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No invocations in this window.</p>
            ) : (
              <DailyBars daily={summary.daily} />
            )}
          </section>

          {/* By model */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              By model
            </h2>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left px-4 py-2">Model</th>
                  <th className="text-right px-4 py-2">Invocations</th>
                  <th className="text-right px-4 py-2">Input</th>
                  <th className="text-right px-4 py-2">Output</th>
                  <th className="text-right px-4 py-2">Est. cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {summary.byModel.map(m => (
                  <tr key={m.model}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{m.model}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtNum(m.invocations)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtTokens(m.inputTokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtTokens(m.outputTokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtUsd(m.estCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>

          {/* Recent failures */}
          {summary.recentFailures.length > 0 && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
                Recent failures (last {summary.recentFailures.length})
              </h2>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-2">When</th>
                    <th className="text-left px-4 py-2">Surface</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Tenant</th>
                    <th className="text-left px-4 py-2">Model</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {summary.recentFailures.map(f => (
                    <tr key={f.id}>
                      <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {new Date(f.occurredAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{f.surface}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_PILL[f.status]}`}>
                          {f.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{f.tenantName ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{f.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          )}

          {/* Caveat */}
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            <span className="font-semibold">Note:</span> {data.caveat}
            {data.truncated && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                Result was truncated at {fmtNum(data.rowsRead)} rows; widen the window with care.
              </span>
            )}
          </p>
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

function DailyBars({ daily }: { daily: NonNullable<UsageResponse['summary']>['daily'] }) {
  const maxCost = Math.max(...daily.map(d => d.estCostUsd), 0.0001)
  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-1 h-24">
        {daily.map(d => {
          const pct = (d.estCostUsd / maxCost) * 100
          return (
            <div
              key={d.day}
              title={`${d.day}: ${fmtNum(d.invocations)} invocations, ${fmtUsd(d.estCostUsd)}`}
              className="flex-1 min-w-[6px] bg-brand-navy/60 dark:bg-brand-yellow/60 hover:bg-brand-navy dark:hover:bg-brand-yellow transition-colors rounded-t"
              style={{ height: `${Math.max(pct, 2)}%` }}
            />
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono">
        <span>{daily[0]?.day}</span>
        <span>{daily[daily.length - 1]?.day}</span>
      </div>
    </div>
  )
}
