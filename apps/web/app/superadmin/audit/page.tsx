'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, History, Loader2, AlertCircle, Search, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useUrlState } from '@/hooks/useUrlState'
import type { SuperadminAuditResponse } from '@/app/api/superadmin/audit/route'

// Cross-tenant audit explorer. Mirrors /admin/evidence/audit's UX but adds
// a tenant filter and reads via the superadmin route (service-role,
// bypasses RLS).

const OP_STYLE: Record<'INSERT' | 'UPDATE' | 'DELETE', string> = {
  INSERT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  UPDATE: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
  DELETE: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
}

interface TenantOption { id: string; name: string; tenant_number: string }

export default function SuperadminAuditPage() {
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [data, setData]       = useState<SuperadminAuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const [tenant,     setTenant]     = useUrlState<string>('tenant', '')
  const [tableName,  setTableName]  = useUrlState<string>('table',  '')
  const [op,         setOp]         = useUrlState<'' | 'INSERT' | 'UPDATE' | 'DELETE'>('op', '')
  const [actorEmail, setActorEmail] = useUrlState<string>('actor',  '')

  // One-shot tenant fetch for the dropdown.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('tenants')
        .select('id, name, tenant_number')
        .order('tenant_number', { ascending: true })
      setTenants((data ?? []) as TenantOption[])
    })()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const params = new URLSearchParams()
      if (tenant)     params.set('tenant', tenant)
      if (tableName)  params.set('table',  tableName)
      if (op)         params.set('op',     op)
      if (actorEmail) params.set('actorEmail', actorEmail)
      params.set('limit', '300')
      const res = await fetch(`/api/superadmin/audit?${params.toString()}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as SuperadminAuditResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, tableName, op, actorEmail])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <History className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              Cross-tenant audit
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Audit log across every tenant. Filter by tenant, table, actor, operation. Filters persist in the URL.
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

      {/* Filters */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tenant</span>
          <select
            value={tenant}
            onChange={e => setTenant(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            <option value="">All tenants</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.name} (#{t.tenant_number})</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Table</span>
          <input
            type="text"
            value={tableName}
            onChange={e => setTableName(e.target.value)}
            placeholder="loto_equipment"
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Operation</span>
          <select
            value={op}
            onChange={e => setOp(e.target.value as '' | 'INSERT' | 'UPDATE' | 'DELETE')}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            <option value="">Any</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actor email contains</span>
          <div className="relative mt-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={actorEmail}
              onChange={e => setActorEmail(e.target.value)}
              placeholder="jamil@"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </div>
        </label>
      </section>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Couldn&apos;t load audit log</p>
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
          <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            {data.rows.length} row{data.rows.length === 1 ? '' : 's'} (capped at {data.filters.limit})
          </div>
          {data.rows.length === 0 ? (
            <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">No audit rows match these filters.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {data.rows.map(r => (
                <li key={r.id} className="p-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="w-full flex items-center gap-2 text-left"
                  >
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${OP_STYLE[r.operation]}`}>
                      {r.operation}
                    </span>
                    <code className="text-xs font-mono text-slate-700 dark:text-slate-300 shrink-0">{r.table_name}</code>
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate min-w-0 flex-1">
                      {r.tenant_name ?? <span className="italic">no-tenant</span>}
                      {r.actor_email && ` · ${r.actor_email}`}
                      {r.row_pk && ` · ${r.row_pk}`}
                    </span>
                    <time className="text-[11px] text-slate-400 dark:text-slate-500 font-mono shrink-0">
                      {new Date(r.created_at).toLocaleString()}
                    </time>
                  </button>
                  {expandedId === r.id && (
                    <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px]">
                      <div className="rounded-md bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 p-2">
                        <p className="font-semibold text-rose-800 dark:text-rose-200 mb-1">old_row</p>
                        <pre className="text-rose-900 dark:text-rose-100 font-mono whitespace-pre-wrap break-all">
                          {r.old_row ? JSON.stringify(r.old_row, null, 2) : '—'}
                        </pre>
                      </div>
                      <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 p-2">
                        <p className="font-semibold text-emerald-800 dark:text-emerald-200 mb-1">new_row</p>
                        <pre className="text-emerald-900 dark:text-emerald-100 font-mono whitespace-pre-wrap break-all">
                          {r.new_row ? JSON.stringify(r.new_row, null, 2) : '—'}
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
