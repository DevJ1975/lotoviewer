'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Scale } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { EmptyState } from '@/components/EmptyState'
import { useFacility } from '@/components/FacilityProvider'
import { HowToPanel, JurisdictionBanner } from '@/components/environmental/context'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { errorList, listLegal, reviewLegal, searchOwners, type LegalEntry, type Scope } from '@/lib/environmental/client'
import {
  APPLICABILITY_META, COMPLIANCE_META, filterEntries, hasActiveFilters, isTileActive, NO_FILTERS, REVIEW_META, sortEntries,
  summarize, toggleTile, type LegalFilters, type Tone,
} from '@/lib/environmental/legalView'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { cn } from '@/lib/utils'
import { normalizeStateCode } from '@soteria/core/environmental/jurisdiction'
import { LEGAL_APPLICABILITY, LEGAL_COMPLIANCE } from '@soteria/core/environmental/legalRegister'
import { ENV_PROGRAM_LABELS, ENV_PROGRAMS } from '@soteria/core/environmental/siteProfile'
import { DeleteDialog } from './_components/DeleteDialog'
import { EntryFormDialog } from './_components/EntryFormDialog'
import { EntryRow, type RowActions } from './_components/EntryRow'
import { EvaluateDialog } from './_components/EvaluateDialog'

// /environmental/compliance/legal — the legal register.
//
// Every requirement that binds the account: whether it applies, whether the site is
// meeting it, and when someone last looked. With one site selected it lists that
// site's requirements and those that cover every site; with all sites selected, the
// whole account, with the site named on each row. Any member reads; tenant admins
// evaluate, review, edit, add and delete.

const REVIEW_STATES = Object.keys(REVIEW_META) as Array<keyof typeof REVIEW_META>

// The strip's accent is decoration; every count is also named in words.
const TILE_ACCENT: Readonly<Record<Tone, string>> = {
  good: 'border-l-emerald-500',
  warn: 'border-l-amber-500',
  bad:  'border-l-rose-500',
  idle: 'border-l-slate-400',
}

type OpenDialog =
  | { kind: 'add' }
  | { kind: 'edit';     entry: LegalEntry }
  | { kind: 'evaluate'; entry: LegalEntry }
  | { kind: 'delete';   entry: LegalEntry }

export default function EnvironmentalLegalRegister() {
  const { scope, facilityName, canAdmin, ready } = useEnvironmentalScope()
  const { site, error: siteError } = useEnvironmentalSite()
  if (!ready || !scope) return <div className="flex justify-center py-16"><OpsSpinner /></div>

  return (
    <>
      <PageHeader
        icon={Scale}
        eyebrow="ISO 14001 · 6.1.3 · 9.1.2"
        title="Legal register"
        description="The laws and permit conditions that bind each site, whether they apply, and whether you are meeting them."
      />
      <JurisdictionBanner site={site} />
      {siteError && <ErrorList errors={[siteError]} />}
      <HowToPanel pageKey="legal" state={site?.facility.state ?? null} />
      <Register
        scope={scope} canAdmin={canAdmin} siteName={facilityName}
        defaultJurisdiction={normalizeStateCode(site?.facility.state) ?? 'federal'}
      />
    </>
  )
}

function Register({ scope, canAdmin, siteName, defaultJurisdiction }: {
  scope: Scope
  canAdmin: boolean
  siteName: string | null
  defaultJurisdiction: string
}) {
  const { available } = useFacility()
  const [entries, setEntries] = useState<LegalEntry[] | null>(null)
  const [owners, setOwners] = useState<ReadonlyMap<string, string>>(new Map())
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [filters, setFilters] = useState<LegalFilters>(NO_FILTERS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const rollUp = scope.facilityId === null
  const siteNames = useMemo(() => new Map(available.map(f => [f.id, f.name])), [available])

  // Reloading keeps the rows on screen, so a row's buttons survive and focus returns to them.
  const load = useCallback(async () => {
    try {
      setEntries((await listLegal(scope)).entries)
      setErrors([])
    } catch (e) {
      setErrors(errorList(e))
    }
  }, [scope])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    searchOwners(scope, '')
      .then(members => setOwners(new Map(members.map(m => [m.user_id, m.display_name]))))
      // Names are a nicety: without them the register still reads, with "Assigned" for each owner.
      .catch(() => undefined)
  }, [scope])

  const rows = useMemo(() => sortEntries(filterEntries(entries ?? [], filters)), [entries, filters])
  const summary = useMemo(() => summarize(entries ?? []), [entries])

  const setFilter = <K extends keyof LegalFilters>(key: K, value: LegalFilters[K]) => setFilters(f => ({ ...f, [key]: value }))

  const finish = (message: string) => {
    setNotice(message)
    setDialog(null)
    void load()
  }

  async function markReviewed(entry: LegalEntry) {
    setReviewingId(entry.id); setErrors([]); setNotice(null)
    try {
      const { entry: reviewed } = await reviewLegal(scope, entry.id)
      setNotice(`Marked “${entry.title}” as reviewed.${reviewed.next_review_due ? ` The next review is due ${reviewed.next_review_due}.` : ''}`)
      await load()
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setReviewingId(null)
    }
  }

  const actionsFor = (entry: LegalEntry): RowActions | null => canAdmin
    ? {
        onEvaluate: () => setDialog({ kind: 'evaluate', entry }),
        onMarkReviewed: () => void markReviewed(entry),
        onEdit: () => setDialog({ kind: 'edit', entry }),
        onDelete: () => setDialog({ kind: 'delete', entry }),
        reviewing: reviewingId === entry.id,
      }
    : null

  if (entries === null) {
    return errors.length > 0 ? <ErrorList errors={errors} /> : <div className="flex justify-center py-16"><OpsSpinner /></div>
  }

  return (
    <div className="space-y-4">
      {canAdmin
        ? <div><button type="button" onClick={() => setDialog({ kind: 'add' })} className={primaryButtonCls}><Plus className="h-4 w-4" /> Add a requirement</button></div>
        : <p className="text-xs text-slate-500 dark:text-slate-400">Only a tenant admin can change the register.</p>}

      <ErrorList errors={errors} />
      {notice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}

      {entries.length === 0 ? (
        <EmptyState
          icon={Scale}
          eyebrow="Nothing here yet"
          title="No legal requirements yet"
          description={canAdmin
            ? 'Start from the library, which adds the federal and state requirements that fit the site, or add your own.'
            : 'A tenant admin can set the register up.'}
          action={canAdmin && (
            <Link href="/environmental/compliance" className={primaryButtonCls}>
              {rollUp ? 'Open a site to set it up from the library' : 'Set up this site from the library'}
            </Link>
          )}
        />
      ) : (
        <>
          <ul aria-label="Register summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {summary.map(({ tile, count }) => (
              <li key={tile.label}>
                <button
                  type="button" aria-label={`${tile.label}: ${count}`} aria-pressed={isTileActive(filters, tile)}
                  onClick={() => setFilters(f => toggleTile(f, tile))}
                  className={cn(
                    'flex w-full flex-col items-start rounded-lg border-y border-r border-l-4 bg-white px-3 py-2 text-left hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900',
                    'border-y-slate-200 border-r-slate-200 dark:border-y-slate-800 dark:border-r-slate-800',
                    TILE_ACCENT[tile.tone],
                    isTileActive(filters, tile) && 'ring-2 ring-brand-navy dark:ring-brand-yellow',
                  )}
                >
                  <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{count}</span>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{tile.label}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Search">
              <input type="search" value={filters.search} onChange={e => setFilter('search', e.target.value)} placeholder="Title, citation or summary" className={inputCls} />
            </Field>
            <Field label="Program">
              <select value={filters.program} onChange={e => setFilter('program', e.target.value as LegalFilters['program'])} className={inputCls}>
                <option value="">All programs</option>
                {ENV_PROGRAMS.map(p => <option key={p} value={p}>{ENV_PROGRAM_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="Applicability">
              <select value={filters.applicability} onChange={e => setFilter('applicability', e.target.value as LegalFilters['applicability'])} className={inputCls}>
                <option value="">Any</option>
                {LEGAL_APPLICABILITY.map(a => <option key={a} value={a}>{APPLICABILITY_META[a].label}</option>)}
              </select>
            </Field>
            <Field label="Compliance">
              <select value={filters.compliance} onChange={e => setFilter('compliance', e.target.value as LegalFilters['compliance'])} className={inputCls}>
                <option value="">Any</option>
                {LEGAL_COMPLIANCE.map(s => <option key={s} value={s}>{COMPLIANCE_META[s].label}</option>)}
              </select>
            </Field>
            <Field label="Review">
              <select value={filters.review} onChange={e => setFilter('review', e.target.value as LegalFilters['review'])} className={inputCls}>
                <option value="">Any</option>
                {REVIEW_STATES.map(r => <option key={r} value={r}>{REVIEW_META[r].label}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">Showing {rows.length} of {entries.length} requirements</p>
            {hasActiveFilters(filters) && <button type="button" onClick={() => setFilters(NO_FILTERS)} className={secondaryButtonCls}>Clear filters</button>}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              No requirements match these filters.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <caption className="sr-only">Legal requirements, most urgent first</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-2">Requirement</th>
                    {rollUp && <th scope="col" className="px-3 py-2">Site</th>}
                    <th scope="col" className="px-3 py-2">Status</th>
                    <th scope="col" className="px-3 py-2">Review</th>
                    <th scope="col" className="px-3 py-2">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {rows.map(entry => (
                    <EntryRow
                      key={entry.id} entry={entry} open={expandedId === entry.id}
                      onToggle={() => setExpandedId(id => (id === entry.id ? null : entry.id))}
                      siteNames={rollUp ? siteNames : null} owners={owners} actions={actionsFor(entry)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {dialog?.kind === 'evaluate' && <EvaluateDialog scope={scope} entry={dialog.entry} onClose={() => setDialog(null)} onSaved={finish} />}
      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <EntryFormDialog
          scope={scope} entry={dialog.kind === 'edit' ? dialog.entry : null} siteName={siteName}
          defaultJurisdiction={defaultJurisdiction} owners={owners} onClose={() => setDialog(null)} onSaved={finish}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          scope={scope} entry={dialog.entry} onClose={() => setDialog(null)}
          onDeleted={message => { if (expandedId === dialog.entry.id) setExpandedId(null); finish(message) }}
        />
      )}
    </div>
  )
}
