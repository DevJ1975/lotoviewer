'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Search, Loader2, AlertCircle, Wrench, ShieldCheck, Flame, User, UserRound, MessageSquare,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useUrlState } from '@/hooks/useUrlState'
import type { SearchHit, SearchResponse } from '@/app/api/superadmin/search/route'

// Find anything across all tenants — equipment, CS permits, hot-work
// permits, workers, profiles, support tickets. Used for support
// triage when a customer pings without naming their tenant.

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  equipment:       'Equipment',
  cs_permit:       'CS permits',
  hot_work_permit: 'Hot-work permits',
  worker:          'Workers',
  profile:         'App users',
  ticket:          'Support tickets',
}

const KIND_ICON: Record<SearchHit['kind'], typeof Search> = {
  equipment:       Wrench,
  cs_permit:       ShieldCheck,
  hot_work_permit: Flame,
  worker:          User,
  profile:         UserRound,
  ticket:          MessageSquare,
}

export default function SuperadminSearchPage() {
  const [q, setQ]             = useUrlState<string>('q', '')
  const [data, setData]       = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const run = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/superadmin/search?q=${encodeURIComponent(query)}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
        setData(null)
      } else {
        setData(j as SearchResponse)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced auto-search as the user types. 300ms is the sweet
  // spot — fast enough to feel reactive, slow enough to avoid
  // a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void run(q) }, 300)
    return () => clearTimeout(t)
  }, [q, run])

  // Group hits by kind for display.
  const byKind = new Map<SearchHit['kind'], SearchHit[]>()
  for (const h of data?.hits ?? []) {
    const list = byKind.get(h.kind) ?? []
    list.push(h)
    byKind.set(h.kind, list)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <header className="flex items-start gap-3">
        <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Search className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
            Cross-tenant search
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            Equipment, permits, workers, profiles, tickets — across every tenant.
            Useful when a customer reports an issue without naming their tenant.
          </p>
        </div>
      </header>

      {/* Search box */}
      <section className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="EQ-001 / Maria / CSP-2026 / jamil@…"
          autoFocus
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-10 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400 dark:text-slate-500" />
        )}
      </section>

      {/* Bucket counts */}
      {data && data.hits.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {(Object.keys(KIND_LABEL) as SearchHit['kind'][]).map(kind => {
            const n = data.counts[kind]
            if (!n) return null
            const Icon = KIND_ICON[kind]
            return (
              <a
                key={kind}
                href={`#${kind}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                <Icon className="h-3 w-3" />
                {KIND_LABEL[kind]} <span className="font-semibold">{n}</span>
              </a>
            )
          })}
          {data.truncated && (
            <span className="text-amber-700 dark:text-amber-300">Some buckets capped at 20 — narrow the query for more.</span>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">
            <p className="font-medium">Search failed</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {data && data.hits.length === 0 && q.trim().length >= 2 && (
        <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
          No results for <span className="font-mono">&quot;{q}&quot;</span>.
        </p>
      )}

      {!data && q.trim().length < 2 && (
        <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
          Type at least 2 characters to search.
        </p>
      )}

      {/* Hit groups */}
      {data && data.hits.length > 0 && (
        <div className="space-y-5">
          {(Object.keys(KIND_LABEL) as SearchHit['kind'][]).map(kind => {
            const list = byKind.get(kind)
            if (!list || list.length === 0) return null
            const Icon = KIND_ICON[kind]
            return (
              <section
                key={kind}
                id={kind}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden scroll-mt-4"
              >
                <header className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" />
                    {KIND_LABEL[kind]}
                  </h2>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{list.length}</span>
                </header>
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {list.map(hit => (
                    <li key={`${hit.kind}:${hit.id}`} className="px-4 py-2.5">
                      <Link href={hit.href} className="flex items-center justify-between gap-3 hover:underline">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {hit.title}
                          </p>
                          {hit.subtitle && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {hit.subtitle}
                            </p>
                          )}
                        </div>
                        {hit.tenant_name && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0 italic">
                            {hit.tenant_name}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
