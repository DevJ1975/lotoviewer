'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Loader2, Mountain } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useFacility } from '@/components/FacilityProvider'
import {
  getRegistersHealth,
  listAspects,
  type AspectFilters,
  type AspectRow,
  type RegistersHealth,
} from '@/lib/environmental/client'
import { useCanEditRegisters } from '../_components/access'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, LABEL_TEXT } from '../_components/formStyles'
import { RegisterHealthStrip } from '../_components/RegisterHealthStrip'
import { TermTooltip } from '../_components/TermTooltip'
import { AspectForm } from './_components/AspectForm'
import { AspectImport } from './_components/AspectImport'
import { AspectSheet } from './_components/AspectSheet'
import { ConditionChips } from './_components/ConditionChips'

// /environmental/aspects — the ISO 14001 clause 6.1.2 register.
//
// Each aspect is scored separately under normal, abnormal and emergency
// conditions, and its significance comes from the database's view of those
// scores, never from this page. Filtering and paging happen on the server
// (200 rows at a time). Members read; tenant owners and admins edit.

type SignificanceFilter = 'all' | 'yes' | 'no'

export default function EnvironmentalAspectsPage() {
  const { tenantId } = useTenant()
  const { facilityId } = useFacility()
  const canEdit = useCanEditRegisters()

  const [status, setStatus] = useState<NonNullable<AspectFilters['status']>>('active')
  const [processArea, setProcessArea] = useState('')
  const [significance, setSignificance] = useState<SignificanceFilter>('all')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const [rows, setRows] = useState<AspectRow[] | null>(null)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [health, setHealth] = useState<RegistersHealth['aspects'] | null>(null)
  const [knownAreas, setKnownAreas] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [panel, setPanel] = useState<'none' | 'new' | 'import'>('none')

  const filters = useCallback((offset?: number): AspectFilters => ({
    status,
    process_area: processArea || undefined,
    significant:  significance === 'all' ? undefined : significance === 'yes',
    review_due:   overdueOnly ? 'overdue' : undefined,
    offset,
  }), [status, processArea, significance, overdueOnly])

  const remember = (found: readonly AspectRow[]) => setKnownAreas(previous => {
    const areas = new Set(previous)
    for (const row of found) if (row.process_area) areas.add(row.process_area)
    return [...areas].sort((a, b) => a.localeCompare(b))
  })

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
      .then(registers => { if (current === generation.current) setHealth(registers.aspects) })
      .catch(() => { if (current === generation.current) setHealth(null) })   // the list reports its own errors; the strip stays empty
    try {
      const page = await listAspects(tenantId, filters())
      if (current !== generation.current) return
      setRows(page.aspects)
      setNextOffset(page.nextOffset)
      remember(page.aspects)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load the aspects register.')
    }
  }, [tenantId, filters])

  useEffect(() => { void load() }, [load])

  async function loadMore() {
    if (!tenantId || nextOffset === null || loadingMore) return
    const current = generation.current
    setLoadingMore(true)
    try {
      const page = await listAspects(tenantId, filters(nextOffset))
      if (current !== generation.current) return
      setRows(previous => [...(previous ?? []), ...page.aspects])
      setNextOffset(page.nextOffset)
      remember(page.aspects)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load more aspects.')
    } finally {
      setLoadingMore(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Environmental
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <Mountain className="h-6 w-6 text-brand-navy" />
          Environmental aspects &amp; impacts
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ISO 14001:2015 clause 6.1.2. Each <TermTooltip term="aspect" /> is scored under every{' '}
          <TermTooltip term="operating condition" /> that applies: severity × likelihood, 1-5 each, and{' '}
          <TermTooltip term="significant" /> at 12 or higher.
        </p>
      </div>

      <RegisterHealthStrip title="Aspects" health={health?.health ?? null} facts={health ? [
        { label: 'active', value: health.active },
        { label: 'not scored', value: health.unscored, warn: health.unscored > 0 },
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
              <option value="active">Active</option>
              <option value="obsolete">Obsolete</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Process area</span>
            <select className={INPUT} value={processArea} onChange={e => setProcessArea(e.target.value)}>
              <option value="">All areas</option>
              {knownAreas.map(area => <option key={area} value={area}>{area}</option>)}
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Significance</span>
            <select className={INPUT} value={significance} onChange={e => setSignificance(e.target.value as SignificanceFilter)}>
              <option value="all">All</option>
              <option value="yes">Significant</option>
              <option value="no">Not significant</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 pb-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} />
            Review overdue
          </label>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" className={BUTTON_SECONDARY} disabled={!facilityId}
              onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}>Import CSV</button>
            <button type="button" className={BUTTON_PRIMARY} disabled={!facilityId}
              onClick={() => setPanel(panel === 'new' ? 'none' : 'new')}>Record aspect</button>
          </div>
        )}
      </div>
      {canEdit && !facilityId && (
        <p className="text-xs text-slate-500">Choose a facility in the header to record aspects: an aspect belongs to a site.</p>
      )}

      {tenantId && panel === 'new' && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <AspectForm tenantId={tenantId} initial={null} processAreas={knownAreas}
            onCancel={() => setPanel('none')}
            onSaved={aspect => { setPanel('none'); void load(); setSelected(aspect.id) }} />
        </section>
      )}
      {tenantId && panel === 'import' && (
        <AspectImport tenantId={tenantId} onImported={() => void load()} onClose={() => setPanel('none')} />
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        {rows === null ? (
          !loadError && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm italic text-slate-500 dark:text-slate-400">
            No aspects match. {canEdit ? 'Record the first one, or import a CSV.' : ''}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Activity · aspect → impact</th>
                <th className="px-4 py-2 text-left">Process area</th>
                <th className="px-4 py-2 text-left">Conditions</th>
                <th className="px-4 py-2 text-right">Highest</th>
                <th className="px-4 py-2 text-left">Last reviewed</th>
                <th className="px-4 py-2 text-left">Next review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(row => (
                <tr key={row.id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => setSelected(row.id)}
                      className="text-left font-medium text-slate-900 hover:underline dark:text-slate-100">
                      {row.activity}
                    </button>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{row.aspect} → {row.impact}</p>
                    {row.control_level === 'influence' && (
                      <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">Influence only</p>
                    )}
                    {row.obsolete_at && <p className="text-[11px] italic text-slate-400">Obsolete: {row.obsolete_reason}</p>}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{row.process_area ?? '—'}</td>
                  <td className="px-4 py-2"><ConditionChips scores={row.current_scores} /></td>
                  <td className="px-4 py-2 text-right">
                    <span className="placard-numeric font-semibold">{row.max_score ?? '—'}</span>
                    {row.significant && (
                      <span className="ml-1 text-[10px] font-bold uppercase text-rose-600 dark:text-rose-300">significant</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{row.last_reviewed_at?.slice(0, 10) ?? 'Never'}</td>
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
        <AspectSheet tenantId={tenantId} aspectId={selected} canEdit={canEdit} processAreas={knownAreas}
          onChanged={() => void load()} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
