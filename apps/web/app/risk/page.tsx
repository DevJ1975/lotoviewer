'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Download, Loader2, Printer } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { parseRiskFilters, toApiParams, toUrlSearch, toQueryFilters, type RiskFilterState } from '@/lib/risk-filters'
import { readRiskConfig, type Severity, type Likelihood } from '@/lib/risk'
import HeatMapGrid from './_components/HeatMapGrid'
import RiskFilters from './_components/RiskFilters'
import RiskTable from './_components/RiskTable'
import type { RiskSummary } from '@soteria/core/queries/risks'

// /risk — Heat Map landing.
//
// Responsibilities:
//   1. Read filter state from the URL (RiskFilters writes back).
//   2. Fire a /api/risk/heatmap query and render the 5×5 grid.
//   3. Fire a /api/risk?sort=residual_score query for the
//      "Top 5 risks by residual score" summary panel beneath.
//   4. When a heat-map cell is clicked, navigate to /risk/list
//      with the filters + the score implied by the cell.
//
// The page polls the heatmap on visibility-change so the cell
// counts stay live without WebSocket subscriptions in slice 2
// (real-time is slice 4 if traffic warrants it).

export default function RiskHeatmapPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <RiskHeatmapPageInner />
    </Suspense>
  )
}

function RiskHeatmapPageInner() {
  const search = useSearchParams()
  const router = useRouter()
  const { tenant } = useTenant()

  const filters = useMemo<RiskFilterState>(() => parseRiskFilters(search), [search])
  const config  = useMemo(() => readRiskConfig(tenant?.settings ?? null), [tenant?.settings])

  const [cells,   setCells]   = useState<Record<string, number> | null>(null)
  const [total,   setTotal]   = useState<number>(0)
  const [topRisks, setTopRisks] = useState<RiskSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenant?.id)            headers['x-active-tenant'] = tenant.id

      const heatmapParams = new URLSearchParams()
      heatmapParams.set('view', filters.view)
      if (filters.status.length > 0)         heatmapParams.set('status', filters.status.join(','))
      if (filters.hazardCategory.length > 0) heatmapParams.set('hazard_category', filters.hazardCategory.join(','))

      const topParams = toApiParams({ ...filters, sort: 'residual_score', dir: 'desc', limit: 5, offset: 0 })

      const [hRes, lRes] = await Promise.all([
        fetch(`/api/risk/heatmap?${heatmapParams.toString()}`, { headers }),
        fetch(`/api/risk?${topParams.toString()}`,             { headers }),
      ])

      const hBody = await hRes.json()
      const lBody = await lRes.json()
      if (!hRes.ok) throw new Error(hBody.error ?? `Heatmap HTTP ${hRes.status}`)
      if (!lRes.ok) throw new Error(lBody.error ?? `List HTTP ${lRes.status}`)

      setCells(hBody.cells ?? {})
      setTotal(hBody.total ?? 0)
      setTopRisks((lBody.risks ?? []) as RiskSummary[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [filters, tenant?.id])

  useEffect(() => { void fetchData() }, [fetchData])

  // Refetch on focus / visibility-change so the heat map stays
  // live without a WebSocket subscription. Same pattern the LOTO
  // dashboard uses.
  useEffect(() => {
    function onVis() { if (document.visibilityState === 'visible') void fetchData() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [fetchData])

  function handleCellClick(severity: Severity, likelihood: Likelihood) {
    // Drill into the list view filtered to the band that cell
    // sits in. Slice 2 keeps it band-level so the list filter is
    // simple; if a tenant ever wants to drill to a specific score,
    // we can add inherent_score / residual_score filter params
    // in slice 4.
    const score = severity * likelihood
    const band = score <= 3 ? 'low'
               : score <= 6 ? 'moderate'
               : score <= 12 ? 'high'
               : 'extreme'
    const next = new URLSearchParams(toUrlSearch({ ...filters, band }))
    next.set('view', filters.view)
    router.push(`/risk/list?${next.toString()}`)
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">
            Risk Assessment · ISO 45001 6.1
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Heat map
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Click any cell to drill into the risks at that score. {' '}
            {filters.view === 'inherent' ? 'Inherent' : 'Residual'} view.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={`/risk/list?${toUrlSearch(filters)}`}
            className="text-xs font-semibold text-brand-navy hover:underline"
          >
            View as list →
          </Link>
          <ExportMenu />
          <Link
            href="/risk/new"
            className="text-sm font-bold inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90 transition-colors"
          >
            + New risk
          </Link>
        </div>
      </header>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <RiskFilters filters={filters} />
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        {loading && cells === null ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-rose-700 bg-rose-50 rounded-lg">{error}</div>
        ) : (
          <>
            <HeatMapGrid
              cells={cells ?? {}}
              bandScheme={config.bandScheme}
              onCellClick={handleCellClick}
            />
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{total.toLocaleString()} risks visible at this filter</span>
              {loading && <span className="text-slate-400">Refreshing…</span>}
            </div>
          </>
        )}
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-3">
          Top risks by residual score
        </h2>
        {topRisks.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No risks yet for this tenant.</p>
        ) : (
          <RiskTable risks={topRisks} compact bandScheme={config.bandScheme} />
        )}
      </section>
    </main>
  )
}

function FullPageSpinner() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  )
}

// Export menu — JSON download (ISO 45001 audit format) + Cal/OSHA
// IIPP printable layout (HTML page with print styles; Cmd-P → PDF).
function ExportMenu() {
  const { tenant } = useTenant()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click — same pattern as the existing AppChrome
  // drawer wrapper.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function downloadJson() {
    if (busy) return
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenant?.id)            headers['x-active-tenant'] = tenant.id
      const res = await fetch('/api/risk/export?format=json', { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const filename = res.headers.get('content-disposition')
        ?.match(/filename="([^"]+)"/)?.[1]
        ?? `risk-register-${new Date().toISOString().slice(0, 10)}.json`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="text-xs font-semibold inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
      >
        Export <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden z-10">
          <button
            type="button"
            onClick={downloadJson}
            className="w-full flex items-start gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="h-4 w-4 mt-0.5 shrink-0 text-slate-500" />
            <div>
              <div className="font-semibold">JSON download</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                ISO 45001 audit format · machine-readable
              </div>
            </div>
          </button>
          <Link
            href="/risk/export/iipp"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="w-full flex items-start gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-800 border-t border-slate-100 dark:border-slate-800"
          >
            <Printer className="h-4 w-4 mt-0.5 shrink-0 text-slate-500" />
            <div>
              <div className="font-semibold">Cal/OSHA IIPP printable</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                §3203 paper layout · Cmd-P to save as PDF
              </div>
            </div>
          </Link>
        </div>
      )}
    </div>
  )
}
