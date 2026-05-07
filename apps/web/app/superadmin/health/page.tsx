'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, AlertCircle, Heart, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { TenantHealthResponse } from '@/app/api/superadmin/tenant-health/route'

// Tenant health dashboard. One row per tenant with operational
// counts + last activity. The point is "is anyone in trouble?"
// at-a-glance, not deep analytics.

export default function TenantHealthPage() {
  const [data, setData]       = useState<TenantHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/superadmin/tenant-health', {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as TenantHealthResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Heart className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              Tenant health
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Per-tenant operational counts + last activity. Click a tenant number to open its detail page.
            </p>
          </div>
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
      </header>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Couldn&apos;t load tenant health</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {data && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[960px]">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">Tenant</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Members</th>
                <th className="text-right px-3 py-2">Workers</th>
                <th className="text-right px-3 py-2">Equipment</th>
                <th className="text-right px-3 py-2">Active permits</th>
                <th className="text-right px-3 py-2">Open tickets</th>
                <th className="text-right px-3 py-2">AI 30d</th>
                <th className="text-left px-3 py-2">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {data.tenants.map(t => (
                <tr key={t.tenant_id}>
                  <td className="px-3 py-2 max-w-[280px]">
                    <Link
                      href={`/superadmin/tenants/${t.tenant_number}`}
                      className="text-slate-900 dark:text-slate-100 font-medium hover:underline truncate block"
                      title={t.name}
                    >
                      {t.name}
                    </Link>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      #{t.tenant_number}{t.is_demo && ' · demo'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                  <Cell value={t.member_count} />
                  <Cell value={t.worker_count} />
                  <Cell value={t.equipment_count} />
                  <Cell value={t.active_permits}  warn={t.active_permits > 0} />
                  <Cell value={t.open_tickets}    warn={t.open_tickets > 0} />
                  <Cell value={t.ai_invocations_30d} />
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {t.last_activity_at ? relativeTime(t.last_activity_at) : <span className="italic text-slate-400">never</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}
    </div>
  )
}

function Cell({ value, warn }: { value: number; warn?: boolean }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${warn ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-300'}`}>
      {value.toLocaleString()}
    </td>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active'   ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' :
    status === 'trial'    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' :
    status === 'disabled' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200' :
                            'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}>
      {status}
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
