'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, Activity, DollarSign, Zap, AlertTriangle, ShieldOff,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { TenantUsageResponse } from '@/app/api/tenant/ai-usage/route'

// Tenant admin's view of their own AI usage. Mirrors the superadmin
// dashboard but scoped to one tenant + adds today's-spend-vs-cap
// progress bar so an admin can see "we're at 60% of today's $5 budget".

const WINDOW_OPTIONS = [
  { label: '24h', days: 1  },
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
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
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

export default function TenantAiUsagePage() {
  const { tenant } = useTenant()
  const [days, setDays]       = useState<number>(30)
  const [data, setData]       = useState<TenantUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setError('Sign in to view usage.'); setLoading(false); return }
      const res = await fetch(`/api/tenant/ai-usage?days=${days}`, {
        headers: {
          authorization:    `Bearer ${session.access_token}`,
          'x-active-tenant': tenant?.id ?? '',
        },
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as TenantUsageResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [days, tenant?.id])

  useEffect(() => { void load() }, [load])

  const summary = data?.summary
  const today   = data?.today

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">
              Admin
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
              AI usage
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Your tenant&apos;s Claude invocations, by surface and day. Cost is an estimate (see footnote).
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

      {!loading && !error && summary && today && (
        <>
          {today.aiDisabled && (
            <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
              <ShieldOff className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-800 dark:text-rose-200">
                AI is currently disabled for your tenant. Contact your administrator.
              </p>
            </div>
          )}

          <BudgetCard today={today} />

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
              label={`Spend (${data.windowDays}d)`}
              value={fmtUsd(summary.totals.estCostUsd)}
              sub="estimate"
            />
            <KpiTile
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Failures"
              value={fmtNum(summary.totals.errors + summary.totals.rateLimited + summary.totals.budgetBlocked)}
              sub={`${summary.totals.errors} err · ${summary.totals.rateLimited} rl · ${summary.totals.budgetBlocked} bb`}
              tone={summary.totals.errors + summary.totals.rateLimited + summary.totals.budgetBlocked > 0 ? 'warn' : 'normal'}
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
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left  px-4 py-2">Surface</th>
                      <th className="text-right px-4 py-2">Invocations</th>
                      <th className="text-right px-4 py-2">Input</th>
                      <th className="text-right px-4 py-2">Output</th>
                      <th className="text-right px-4 py-2" title="Cache reads / (cache reads + uncached input)">Cache hit</th>
                      <th className="text-right px-4 py-2">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {summary.bySurface.map(s => {
                      const hitTone = s.cacheHitRate >= 0.5 ? 'text-emerald-700 dark:text-emerald-400'
                                    : s.cacheHitRate >  0    ? 'text-slate-700 dark:text-slate-300'
                                    :                          'text-slate-400 dark:text-slate-500'
                      return (
                        <tr key={s.surface}>
                          <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{s.surface}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmtNum(s.invocations)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtTokens(s.inputTokens)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtTokens(s.outputTokens)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums ${hitTone}`}>{s.cacheHitRate > 0 ? fmtPct(s.cacheHitRate) : '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtUsd(s.estCostUsd)}</td>
                        </tr>
                      )
                    })}
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

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            <span className="font-semibold">Note:</span> {data.caveat}
            {data.truncated && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                Result was truncated at {fmtNum(data.rowsRead)} rows.
              </span>
            )}
          </p>
        </>
      )}
    </div>
  )
}

function BudgetCard({ today }: { today: NonNullable<TenantUsageResponse['today']> }) {
  const spent = today.spentCents / 100
  if (today.capCents == null) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Today&apos;s spend</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{fmtUsd(spent)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">No daily budget cap is set for this tenant.</p>
      </div>
    )
  }
  const cap = today.capCents / 100
  const pct = cap > 0 ? Math.min(spent / cap, 1.5) : 0
  const tone = pct >= 1 ? 'bg-rose-500'
              : pct >= 0.8 ? 'bg-amber-500'
              :              'bg-emerald-500'
  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Today&apos;s spend vs cap</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">resets midnight UTC</p>
      </div>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
        {fmtUsd(spent)} <span className="text-sm font-normal text-slate-500 dark:text-slate-400">/ {fmtUsd(cap)}</span>
      </p>
      <div className="mt-2 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
      </div>
      {pct >= 1 && (
        <p className="text-xs text-rose-700 dark:text-rose-400 mt-2">
          Daily cap reached. Further AI calls will return 429 until midnight UTC.
        </p>
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

function DailyBars({ daily }: { daily: NonNullable<TenantUsageResponse['summary']>['daily'] }) {
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
