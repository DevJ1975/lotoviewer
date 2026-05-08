'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw, ShieldAlert, XCircle,
} from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

type Outcome = 'unchanged' | 'newer' | 'older' | 'unknown' | 'fetch_failed'

interface CheckRow {
  id:                     number
  product_id:             string
  source_url:             string | null
  http_status:            number | null
  baseline_revision_date: string | null
  baseline_file_hash:     string | null
  latest_revision_date:   string | null
  latest_file_hash:       string | null
  outcome:                Outcome
  new_sds_id:             string | null
  notes:                  string | null
  trigger:                'scheduled' | 'manual'
  checked_at:             string
  chemical_products: {
    id:           string
    name:         string
    manufacturer: string | null
    archived_at:  string | null
  } | null
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  unchanged:    'Unchanged',
  newer:        'Newer revision',
  older:        'Older — investigate',
  unknown:      'Unknown',
  fetch_failed: 'Fetch failed',
}

const OUTCOME_CLS: Record<Outcome, string> = {
  unchanged:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  newer:        'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300',
  older:        'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  unknown:      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  fetch_failed: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
}

const OUTCOME_ICON: Record<Outcome, React.ComponentType<{ className?: string }>> = {
  unchanged:    CheckCircle2,
  newer:        RefreshCw,
  older:        AlertTriangle,
  unknown:      ShieldAlert,
  fetch_failed: XCircle,
}

const FILTERS: { key: 'all' | Outcome; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'newer',        label: 'Newer' },
  { key: 'older',        label: 'Older' },
  { key: 'fetch_failed', label: 'Fetch failed' },
  { key: 'unchanged',    label: 'Unchanged' },
  { key: 'unknown',      label: 'Unknown' },
]

export default function ChemicalsDriftPage() {
  const { tenant } = useTenant()
  const [rows,   setRows]   = useState<CheckRow[] | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | Outcome>('all')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const params = new URLSearchParams({ limit: '300' })
    if (filter !== 'all') params.set('outcome', filter)
    const res  = await fetch(`/api/chemicals/drift?${params}`, { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setRows([])
      return
    }
    setRows(body.checks ?? [])
  }, [tenant, buildHeaders, filter])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const out: Record<'all' | Outcome, number> = {
      all: 0, unchanged: 0, newer: 0, older: 0, unknown: 0, fetch_failed: 0,
    }
    for (const r of rows ?? []) {
      out.all += 1
      out[r.outcome] = (out[r.outcome] ?? 0) + 1
    }
    return out
  }, [rows])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">SDS drift log</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every nightly + manual SDS revision check. Newer revisions are queued in the SDS review
          queue; older or failed fetches surface here for follow-up.
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs rounded border ${
              filter === f.key
                ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {f.label}{filter === 'all' && f.key !== 'all' && counts[f.key]
              ? ` (${counts[f.key]})` : ''}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          {filter === 'all'
            ? 'No drift checks yet. The cron runs nightly; click "Check for revision" on a chemical to fire one manually.'
            : `No ${OUTCOME_LABEL[filter]} entries.`
          }
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {rows.map(row => {
            const Icon = OUTCOME_ICON[row.outcome]
            return (
              <li key={row.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded ${OUTCOME_CLS[row.outcome]}`}>
                    <Icon className="w-3 h-3" />
                    {OUTCOME_LABEL[row.outcome]}
                  </span>
                  <Link
                    href={`/chemicals/${row.product_id}`}
                    className="font-medium text-slate-900 dark:text-slate-100 hover:underline"
                  >
                    {row.chemical_products?.name ?? '(unknown product)'}
                  </Link>
                  {row.chemical_products?.manufacturer && (
                    <span className="text-xs text-slate-500">· {row.chemical_products.manufacturer}</span>
                  )}
                  <span className="ml-auto text-xs text-slate-500">
                    {new Date(row.checked_at).toISOString().slice(0, 16).replace('T', ' ')} UTC · {row.trigger}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap gap-x-3">
                  <span>baseline: {row.baseline_revision_date ?? '—'}</span>
                  <span>latest: {row.latest_revision_date ?? '—'}</span>
                  {row.http_status && <span>HTTP {row.http_status}</span>}
                  {row.outcome === 'newer' && row.new_sds_id && (
                    <Link href="/chemicals/review" className="text-indigo-600 hover:underline">
                      → review queue
                    </Link>
                  )}
                </div>
                {row.notes && (
                  <div className="mt-1 text-xs text-slate-500 italic">{row.notes}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
