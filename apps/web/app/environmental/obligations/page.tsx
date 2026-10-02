'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Loader2, Scale } from 'lucide-react'
import type { EvaluationResult } from '@soteria/core/complianceEvaluation'
import { useTenant } from '@/components/TenantProvider'
import { Sheet } from '@/components/ui/sheet'
import {
  getRegistersHealth,
  listObligations,
  type ObligationFilters,
  type ObligationRow,
  type RegistersHealth,
} from '@/lib/environmental/client'
import { useCanEditRegisters } from '../_components/access'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, LABEL_TEXT } from '../_components/formStyles'
import { RegisterHealthStrip } from '../_components/RegisterHealthStrip'
import { TermTooltip } from '../_components/TermTooltip'
import { ObligationDetail } from './_components/ObligationDetail'
import { ObligationForm } from './_components/ObligationForm'
import { ResultBadge } from './_components/ResultBadge'

// /environmental/obligations — the compliance obligations register (clauses
// 6.1.3 and 9.1.2). The obligations are the Compliance Calendar's
// environmental and integrated rows; this page adds what makes them a legal
// register (source, jurisdiction, why each applies) and the evaluations of
// compliance with them. Filtering and paging happen on the server.

type LastResultFilter = '' | EvaluationResult | 'none'

export default function ComplianceObligationsPage() {
  const { tenantId } = useTenant()
  const canEdit = useCanEditRegisters()

  const [status, setStatus] = useState<NonNullable<ObligationFilters['status']>>('active')
  const [lastResult, setLastResult] = useState<LastResultFilter>('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [rows, setRows] = useState<ObligationRow[] | null>(null)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [health, setHealth] = useState<RegistersHealth['obligations'] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<ObligationRow | null>(null)
  const [adding, setAdding] = useState(false)

  const filters = useCallback((offset?: number): ObligationFilters => ({
    status, last_result: lastResult || undefined, review_due: overdueOnly ? 'overdue' : undefined, offset,
  }), [status, lastResult, overdueOnly])

  // Every reload starts a new generation; a response (or a "Load more" page)
  // from an older generation arrives too late to count and is dropped, so a
  // quick filter change can never show the other filter's rows.
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!tenantId) return
    const current = ++generation.current
    setLoadError(null)
    setNextOffset(null)   // the previous filters' paging no longer applies
    void getRegistersHealth(tenantId)
      .then(registers => { if (current === generation.current) setHealth(registers.obligations) })
      .catch(() => { if (current === generation.current) setHealth(null) })   // the list reports its own errors; the strip stays empty
    try {
      const page = await listObligations(tenantId, filters())
      if (current !== generation.current) return
      setRows(page.obligations)
      setNextOffset(page.nextOffset)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load the obligations register.')
    }
  }, [tenantId, filters])

  useEffect(() => { void load() }, [load])

  async function loadMore() {
    if (!tenantId || nextOffset === null || loadingMore) return
    const current = generation.current
    setLoadingMore(true)
    try {
      const page = await listObligations(tenantId, filters(nextOffset))
      if (current !== generation.current) return
      setRows(previous => [...(previous ?? []), ...page.obligations])
      setNextOffset(page.nextOffset)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load more obligations.')
    } finally {
      setLoadingMore(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  // The sheet's heading follows the reloaded row, so an edit made inside it shows at once.
  const shown = selected && (rows?.find(row => row.id === selected.id) ?? selected)

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Environmental
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <Scale className="h-6 w-6 text-brand-navy" />
          Compliance obligations
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ISO 14001:2015 clauses 6.1.3 and 9.1.2. Every <TermTooltip term="compliance obligation" /> the organization
          is subject to, why it applies, and the evidence-backed evaluations of compliance with it.
        </p>
      </div>

      <RegisterHealthStrip title="Obligations" health={health?.health ?? null} facts={health ? [
        { label: 'in the register', value: health.active },
        { label: 'evaluations overdue', value: health.evaluationsOverdue, warn: health.evaluationsOverdue > 0 },
        { label: 'review overdue', value: health.reviewOverdue, warn: health.reviewOverdue > 0 },
      ] : []} />

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{loadError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Show</span>
            <select className={INPUT} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
              <option value="active">In force</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Last result</span>
            <select className={INPUT} value={lastResult} onChange={e => setLastResult(e.target.value as LastResultFilter)}>
              <option value="">Any</option>
              <option value="noncompliant">Noncompliant</option>
              <option value="compliant">Compliant</option>
              <option value="not_applicable">Not applicable</option>
              <option value="undetermined">Undetermined</option>
              <option value="none">Never evaluated</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 pb-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} />
            Review overdue
          </label>
        </div>
        {canEdit && (
          <button type="button" className={BUTTON_PRIMARY} onClick={() => setAdding(true)}>Add obligation</button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        {rows === null ? (
          !loadError && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm italic text-slate-500 dark:text-slate-400">No obligations match.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Obligation</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-left">Jurisdiction</th>
                <th className="px-4 py-2 text-left">Last result</th>
                <th className="px-4 py-2 text-left">Evaluation due</th>
                <th className="px-4 py-2 text-left">Next review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(row => (
                <tr key={row.id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => setSelected(row)}
                      className="text-left font-medium text-slate-900 hover:underline dark:text-slate-100">{row.title}</button>
                    {row.regulatory_ref && <p className="text-xs text-slate-500">{row.regulatory_ref}</p>}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{row.source_kind ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{row.jurisdiction ?? '—'}</td>
                  <td className="px-4 py-2">
                    <ResultBadge result={row.last_result} />
                    {row.last_evaluated_at && <p className="text-[11px] text-slate-400">{row.last_evaluated_at.slice(0, 10)}</p>}
                  </td>
                  <td className={`px-4 py-2 text-xs ${row.open_evaluation_due && row.open_evaluation_due < today ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                    {row.open_evaluation_due ?? (row.evaluation_cadence_days ? 'Scheduled nightly' : 'Not scheduled')}
                  </td>
                  <td className={`px-4 py-2 text-xs ${row.next_review_due < today ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                    {row.next_review_due}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {nextOffset !== null && (
        <div className="flex justify-center">
          <button type="button" className={BUTTON_SECONDARY} disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {tenantId && (
        <Sheet open={adding} onClose={() => setAdding(false)} title="Add an obligation"
          subtitle="It joins the register and the Compliance Calendar.">
          {adding && (
            <ObligationForm tenantId={tenantId} initial={null} onCancel={() => setAdding(false)}
              onSaved={() => { setAdding(false); void load() }} />
          )}
        </Sheet>
      )}
      {tenantId && (
        <Sheet open={selected !== null} onClose={() => setSelected(null)} title={shown?.title ?? 'Obligation'}
          subtitle={shown?.regulatory_ref ?? undefined}>
          {selected && (
            <>
              <Link href={`/environmental/obligations/${selected.id}`} className="mb-3 inline-block text-xs text-brand-navy hover:underline dark:text-brand-yellow">
                Open as a page
              </Link>
              <ObligationDetail tenantId={tenantId} obligationId={selected.id} canEdit={canEdit} onChanged={() => void load()} />
            </>
          )}
        </Sheet>
      )}
    </div>
  )
}
