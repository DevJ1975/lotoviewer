'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { parseRiskFilters, toApiParams, type RiskFilterState } from '@/lib/risk-filters'
import { readRiskConfig } from '@soteria/core/risk'
import RiskFilters from '../_components/RiskFilters'
import RiskTable from '../_components/RiskTable'
import type { RiskSummary } from '@soteria/core/queries/risks'

// /risk/list — Filtered table of every risk in the active tenant.
// Same filter bar as the heat map page (URL-driven state); this
// page adds a search box and pagination.

export default function RiskListPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <RiskListPageInner />
    </Suspense>
  )
}

function RiskListPageInner() {
  const search = useSearchParams()
  const router = useRouter()
  const { tenant } = useTenant()

  const filters = useMemo<RiskFilterState>(() => parseRiskFilters(search), [search])
  const config  = useMemo(() => readRiskConfig(tenant?.settings ?? null), [tenant?.settings])

  const [risks,   setRisks]   = useState<RiskSummary[]>([])
  const [total,   setTotal]   = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenant?.id)            headers['x-active-tenant'] = tenant.id

      const params = toApiParams(filters)
      const res = await fetch(`/api/risk?${params.toString()}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRisks((body.risks ?? []) as RiskSummary[])
      setTotal(body.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [filters, tenant?.id])

  useEffect(() => { void fetchData() }, [fetchData])

  function gotoPage(offsetDelta: number) {
    const next = new URLSearchParams(search?.toString() ?? '')
    const newOffset = Math.max(0, filters.offset + offsetDelta)
    if (newOffset === 0) next.delete('offset')
    else                 next.set('offset', String(newOffset))
    router.replace(`?${next.toString()}`)
  }

  function setSort(sort: RiskFilterState['sort']) {
    const next = new URLSearchParams(search?.toString() ?? '')
    next.set('sort', sort)
    next.delete('offset')
    router.replace(`?${next.toString()}`)
  }

  const pageStart = filters.offset + 1
  const pageEnd   = Math.min(filters.offset + filters.limit, total)
  const hasPrev   = filters.offset > 0
  const hasNext   = filters.offset + filters.limit < total

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/risk"
            className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-3 w-3" /> Heat map
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            Risk register
          </h1>
        </div>
        <Link
          href="/risk/import"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline"
        >
          Bulk import →
        </Link>
      </header>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <RiskFilters filters={filters} showSearch />
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-3">
          <div>
            {loading
              ? 'Loading…'
              : total === 0
                ? '0 risks'
                : `${pageStart.toLocaleString()}–${pageEnd.toLocaleString()} of ${total.toLocaleString()}`}
          </div>
          <div className="flex items-center gap-2">
            <SortButton current={filters.sort} value="residual_score" onClick={setSort}>Residual score</SortButton>
            <SortButton current={filters.sort} value="inherent_score" onClick={setSort}>Inherent score</SortButton>
            <SortButton current={filters.sort} value="next_review_date" onClick={setSort}>Next review</SortButton>
            <SortButton current={filters.sort} value="risk_number"     onClick={setSort}>Risk #</SortButton>
            <SortButton current={filters.sort} value="created_at"      onClick={setSort}>Created</SortButton>
          </div>
        </div>

        {error ? (
          <div className="py-8 text-center text-sm text-rose-700 bg-rose-50 rounded-lg">{error}</div>
        ) : loading && risks.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <RiskTable risks={risks} bandScheme={config.bandScheme} />
        )}

        {total > filters.limit && (
          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={() => gotoPage(-filters.limit)}
              className="text-xs font-semibold inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => gotoPage(filters.limit)}
              className="text-xs font-semibold inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

function SortButton({
  current, value, onClick, children,
}: {
  current:  RiskFilterState['sort']
  value:    RiskFilterState['sort']
  onClick:  (s: RiskFilterState['sort']) => void
  children: React.ReactNode
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={
        'text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors ' +
        (active
          ? 'bg-brand-navy text-white border-brand-navy'
          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800')
      }
    >
      {children}
    </button>
  )
}

function FullPageSpinner() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  )
}
