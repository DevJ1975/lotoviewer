'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BookOpen, Loader2, Plus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { complianceFetch } from '../_lib/api'
import { LEGAL_STATUSES, type LegalStatus } from '@soteria/core/compliance'

// /compliance/registry — paginated list of legal-registry entries.

interface RegistryRow {
  id:               string
  citation:         string
  title:            string
  jurisdiction:     string
  authority:        string | null
  status:           LegalStatus
  next_review_due:  string | null
  tags:             string[]
  ai_generated:     boolean
  created_at:       string
}

interface ListResponse {
  entries: RegistryRow[]
  total:   number
  limit:   number
  offset:  number
}

const STATUS_BADGE: Record<LegalStatus, string> = {
  active:          'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800',
  under_review:    'bg-amber-50  text-amber-700  ring-amber-200  dark:bg-amber-950/40  dark:text-amber-300  dark:ring-amber-800',
  superseded:      'bg-slate-100 text-slate-600  ring-slate-200  dark:bg-slate-800     dark:text-slate-400  dark:ring-slate-700',
  not_applicable:  'bg-slate-100 text-slate-600  ring-slate-200  dark:bg-slate-800     dark:text-slate-400  dark:ring-slate-700',
}

const STATUS_LABEL: Record<LegalStatus, string> = {
  active:         'Active',
  under_review:   'Under review',
  superseded:     'Superseded',
  not_applicable: 'Not applicable',
}

export default function RegistryListPage() {
  const { tenant } = useTenant()
  const [rows,    setRows]    = useState<RegistryRow[] | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [status,  setStatus]  = useState<LegalStatus | ''>('')

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', '200')
      if (search) params.set('q', search)
      if (status) params.set('status', status)
      const body = await complianceFetch<ListResponse>(tenant.id, `/api/compliance/registry?${params.toString()}`)
      setRows(body.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, search, status])

  useEffect(() => { void load() }, [load])

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/compliance" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-3 w-3" /> Compliance calendar
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            Legal registry
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Laws, regulations, and standards applicable to this tenant.
          </p>
        </div>
        <Link
          href="/compliance/registry/new"
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" />
          New citation
        </Link>
      </header>

      <section className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search citation or title…"
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value as LegalStatus | '')}
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <option value="">All statuses</option>
          {LEGAL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </section>

      {error && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{error}</div>
      )}

      {loading && rows === null ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (rows?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 px-6 py-10 text-center text-sm text-slate-500">
          No citations yet. <Link href="/compliance/registry/new" className="underline">Add the first one</Link>.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
          {rows!.map(r => (
            <li key={r.id}>
              <Link href={`/compliance/registry/${r.id}`} className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-semibold text-slate-700 dark:text-slate-200">{r.citation}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${STATUS_BADGE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.ai_generated && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 ring-1 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-800">
                          AI-assisted
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{r.title}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {r.jurisdiction}{r.authority ? ` · ${r.authority}` : ''}
                    </div>
                  </div>
                  {r.next_review_due && (
                    <div className="text-right shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      Next review<br />
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{r.next_review_due}</span>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
