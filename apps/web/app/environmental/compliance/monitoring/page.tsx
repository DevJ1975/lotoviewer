'use client'

import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { EmptyState } from '@/components/EmptyState'
import { JurisdictionBanner, SiteRequired } from '@/components/environmental/context'
import { ConfirmDeleteDialog } from '@/components/environmental/ConfirmDeleteDialog'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { listPermits, type PermitRow } from '@/lib/environmental/client'
import { errorList, listOutfalls, type Outfall, type Scope } from '@/lib/environmental/complianceClient'
import {
  deleteLimit, deleteResult, getMonitoringSummary, listLimits, listResults, type MonitoringSummaryResponse,
} from '@/lib/environmental/monitoringClient'
import { parameterChoices } from '@/lib/environmental/monitoringView'
import { outfallOptionLabel, sortOutfallsByCode } from '@/lib/environmental/outfallView'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { parseLimitRow, parseResultRow, type MonitoringLimit, type MonitoringResult } from '@soteria/core/environmental/monitoring'
import { defaultLimitsFor } from '@soteria/core/environmental/monitoringDefaults'
import { parseSiteProfile } from '@soteria/core/environmental/siteProfile'
import { AdoptDefaultsDialog } from './_components/AdoptDefaultsDialog'
import { LimitForm } from './_components/LimitForm'
import { LimitsPanel } from './_components/LimitsPanel'
import { ResultForm } from './_components/ResultForm'
import { ResultsTable } from './_components/ResultsTable'
import { SummaryStrip } from './_components/SummaryStrip'

// /environmental/compliance/monitoring — discharge monitoring for one site.
//
// Sample results at the site's outfalls, each judged against the limits that apply to it. A
// permit or local limit and a benchmark or numeric action level are kept apart in every label
// and count: exceeding the first breaks a limit that binds the site, exceeding the second calls
// for a response. Any member records a result; only a tenant admin changes or removes one, and
// only a tenant admin manages the limits. Outfalls belong to one site, so this screen needs one.

export default function EnvironmentalMonitoring() {
  const { scope, facilityId, facilityName, canAdmin, ready } = useEnvironmentalScope()
  if (!ready || !scope) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  return (
    <>
      <PageHeader
        icon={FlaskConical}
        eyebrow="Environmental compliance"
        title="Discharge monitoring"
        description="Sample results at each outfall, judged against the limits that apply, with permit limits kept apart from benchmarks and action levels."
      />
      {facilityId
        ? <SiteMonitoring scope={scope} siteId={facilityId} siteName={facilityName ?? 'this site'} canAdmin={canAdmin} />
        : <SiteRequired />}
    </>
  )
}

interface SiteProps { scope: Scope; siteId: string; siteName: string; canAdmin: boolean }

interface SiteData {
  limits:   MonitoringLimit[]
  outfalls: Outfall[]
  permits:  PermitRow[]
  summary:  MonitoringSummaryResponse
}

interface ResultsPage { items: MonitoringResult[]; next: string | null }

const ALL = ''

function SiteMonitoring({ scope, siteId, siteName, canAdmin }: SiteProps) {
  const { site, error: siteError } = useEnvironmentalSite()
  const [data, setData] = useState<SiteData | null>(null)
  const [results, setResults] = useState<ResultsPage | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [reloads, setReloads] = useState(0)
  const [outfallFilter, setOutfallFilter] = useState(ALL)
  const [parameterFilter, setParameterFilter] = useState(ALL)
  const [loadingMore, setLoadingMore] = useState(false)
  const [addingResult, setAddingResult] = useState<{ result: MonitoringResult | null; nowMs: number } | null>(null)
  const [deletingResult, setDeletingResult] = useState<MonitoringResult | null>(null)
  const [editingLimit, setEditingLimit] = useState<{ limit: MonitoringLimit | null } | null>(null)
  const [deletingLimit, setDeletingLimit] = useState<MonitoringLimit | null>(null)
  const [adopting, setAdopting] = useState(false)

  // The site's limits, outfalls and summary change when something is saved; the results list
  // also when a filter does.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      listLimits(scope),
      listOutfalls(scope),
      getMonitoringSummary(scope),
      // Permits matter only to the admin who links a limit to one. Retired ones too: a limit may still name one.
      canAdmin ? listPermits(scope.tenantId, { status: 'all' }) : Promise.resolve({ permits: [] as PermitRow[] }),
    ])
      .then(([l, o, summary, p]) => {
        if (cancelled) return
        setData({ limits: l.limits.map(parseLimitRow), outfalls: sortOutfallsByCode(o.outfalls), permits: p.permits, summary })
        setErrors([])
      })
      .catch(e => { if (!cancelled) setErrors(errorList(e)) })
    return () => { cancelled = true }
  }, [scope, canAdmin, reloads])

  useEffect(() => {
    let cancelled = false
    listResults(scope, { outfallId: outfallFilter || undefined, parameter: parameterFilter || undefined })
      .then(page => { if (!cancelled) setResults({ items: page.results.map(parseResultRow), next: page.next_cursor }) })
      .catch(e => { if (!cancelled) setErrors(errorList(e)) })
    return () => { cancelled = true }
  }, [scope, outfallFilter, parameterFilter, reloads])

  const reload = () => setReloads(n => n + 1)

  async function loadMore() {
    if (!results?.next) return
    setLoadingMore(true)
    try {
      const page = await listResults(scope, { outfallId: outfallFilter || undefined, parameter: parameterFilter || undefined, cursor: results.next })
      setResults({ items: [...results.items, ...page.results.map(parseResultRow)], next: page.next_cursor })
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setLoadingMore(false)
    }
  }

  const parameters = useMemo(() => parameterChoices(data?.limits ?? [], results?.items ?? []), [data, results])
  const offered = useMemo(
    () => (site ? defaultLimitsFor(site.jurisdiction.chain, parseSiteProfile(site.profile)) : []),
    [site],
  )

  const loading = (data === null || results === null) && errors.length === 0
  const filtered = outfallFilter !== ALL || parameterFilter !== ALL

  return (
    <div className="space-y-6">
      <JurisdictionBanner site={site} />
      {siteError && <ErrorList errors={[siteError]} />}
      <ErrorList errors={errors} />

      {loading && <div className="flex justify-center py-16"><OpsSpinner /></div>}

      {data && results && (
        <>
          <SummaryStrip view={data.summary} outfalls={data.outfalls} />

          <section aria-labelledby="monitoring-results" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="monitoring-results" className="text-base font-semibold text-slate-900 dark:text-slate-100">Sample results</h2>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Show outfall">
                  <select value={outfallFilter} onChange={e => setOutfallFilter(e.target.value)} className={inputCls}>
                    <option value={ALL}>All outfalls</option>
                    {data.outfalls.map(o => <option key={o.id} value={o.id}>{outfallOptionLabel(o)}</option>)}
                  </select>
                </Field>
                <Field label="Show parameter">
                  <select value={parameterFilter} onChange={e => setParameterFilter(e.target.value)} className={inputCls}>
                    <option value={ALL}>All parameters</option>
                    {parameters.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <button type="button" className={primaryButtonCls} onClick={() => setAddingResult({ result: null, nowMs: Date.now() })}>
                  <Plus className="h-4 w-4" /> Add result
                </button>
              </div>
            </div>

            {results.items.length === 0 && (
              <EmptyState
                icon={FlaskConical}
                eyebrow={filtered ? 'No matches' : 'No results'}
                title={filtered ? 'No results match these filters' : 'No sample results recorded yet'}
                description={filtered
                  ? 'Try another outfall or parameter, or show all results.'
                  : 'Record each laboratory result as it comes back. It is judged against the limits that apply to its outfall and parameter, and counted in the reporting year.'}
              />
            )}

            {results.items.length > 0 && (
              <>
                <ResultsTable
                  results={results.items} limits={data.limits} outfalls={data.outfalls}
                  actions={canAdmin ? {
                    onEdit: result => setAddingResult({ result, nowMs: Date.now() }),
                    onDelete: setDeletingResult,
                  } : undefined}
                />
                {results.next && (
                  <div className="flex justify-center">
                    <button type="button" className={secondaryButtonCls} disabled={loadingMore} onClick={() => void loadMore()}>
                      {loadingMore ? 'Loading…' : 'Show older results'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <LimitsPanel
            limits={data.limits} rows={data.summary.summary.rows} outfalls={data.outfalls}
            actions={canAdmin ? {
              onAdd: () => setEditingLimit({ limit: null }),
              onEdit: limit => setEditingLimit({ limit }),
              onDelete: setDeletingLimit,
              onAdopt: offered.length > 0 ? () => setAdopting(true) : undefined,
            } : undefined}
          />
          {canAdmin && offered.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No draft default limits are offered for this site. They appear when its profile names a general permit the library has limits for: the California Industrial General Permit or the EPA Multi-Sector General Permit.
            </p>
          )}

          {addingResult && (
            <ResultForm
              scope={scope} siteName={siteName} result={addingResult.result} nowMs={addingResult.nowMs}
              outfalls={data.outfalls} limits={data.limits} parameters={parameters}
              onClose={() => setAddingResult(null)}
              onSaved={() => { setAddingResult(null); reload() }}
            />
          )}
          {deletingResult && (
            <ConfirmDeleteDialog
              title={`Delete the ${deletingResult.parameter} result?`}
              description="The result is removed from this site's record, and from the exceedance counts. It was taken as part of the record of what the laboratory reported: if it was wrong, correct it instead. The deletion is kept in the audit log. This cannot be undone."
              confirmLabel="Delete result"
              onConfirm={async () => { await deleteResult(scope, deletingResult.id) }}
              onDone={() => { setDeletingResult(null); reload() }}
              onClose={() => setDeletingResult(null)}
            />
          )}
          {editingLimit && (
            <LimitForm
              scope={scope} siteId={siteId} siteName={siteName} limit={editingLimit.limit}
              outfalls={data.outfalls} permits={data.permits} parameters={parameters}
              onClose={() => setEditingLimit(null)}
              onSaved={() => { setEditingLimit(null); reload() }}
            />
          )}
          {deletingLimit && (
            <ConfirmDeleteDialog
              title={`Delete the ${deletingLimit.parameter} limit?`}
              description="Results are no longer judged against this limit, and the past exceedances it counted are no longer counted. The results themselves are kept. This cannot be undone."
              confirmLabel="Delete limit"
              onConfirm={async () => { await deleteLimit(scope, deletingLimit.id) }}
              onDone={() => { setDeletingLimit(null); reload() }}
              onClose={() => setDeletingLimit(null)}
            />
          )}
          {adopting && (
            <AdoptDefaultsDialog
              scope={scope} siteName={siteName} offered={offered} limits={data.limits} outfalls={data.outfalls}
              onClose={() => setAdopting(false)}
              onAdopted={() => { setAdopting(false); reload() }}
            />
          )}
        </>
      )}
    </div>
  )
}
