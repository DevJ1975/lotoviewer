'use client'

import { useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { RiskFilterState } from '@/lib/risk-filters'
import type { HazardCategory, RiskStatus } from '@soteria/core/queries/risks'

// Shared filter bar for the heat map + list views. Reads + writes
// URL search params directly so reload / share / browser-history
// "just work". Both pages mount this component at the top of their
// layout; both read the same query string.
//
// Includes:
//   - Hazard category multi-select (toggle pills)
//   - Status multi-select (toggle pills)
//   - View toggle (Inherent / Residual)

const HAZARD_CATS: { id: HazardCategory; label: string }[] = [
  { id: 'physical',       label: 'Physical' },
  { id: 'chemical',       label: 'Chemical' },
  { id: 'biological',     label: 'Biological' },
  { id: 'mechanical',     label: 'Mechanical' },
  { id: 'electrical',     label: 'Electrical' },
  { id: 'ergonomic',      label: 'Ergonomic' },
  { id: 'psychosocial',   label: 'Psychosocial' },
  { id: 'environmental',  label: 'Environmental' },
  { id: 'radiological',   label: 'Radiological' },
]

const STATUSES: { id: RiskStatus; label: string }[] = [
  { id: 'open',                  label: 'Open' },
  { id: 'in_review',             label: 'In review' },
  { id: 'controls_in_progress',  label: 'Controls in progress' },
  { id: 'monitoring',            label: 'Monitoring' },
  { id: 'closed',                label: 'Closed' },
  { id: 'accepted_exception',    label: 'Accepted (exception)' },
]

interface Props {
  filters:   RiskFilterState
  /** When true, also surfaces the search box (list page wants it). */
  showSearch?: boolean
}

export default function RiskFilters({ filters, showSearch }: Props) {
  const router = useRouter()
  const search = useSearchParams()
  const [, startTransition] = useTransition()

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search?.toString() ?? '')
    if (value === null || value === '') next.delete(key)
    else                                next.set(key, value)
    next.set('offset', '0')                          // reset paging on filter change
    startTransition(() => router.replace(`?${next.toString()}`))
  }

  function toggleListItem(key: 'status' | 'hazard_category', id: string) {
    const current = (search?.get(key) ?? '').split(',').filter(Boolean)
    const next = current.includes(id)
      ? current.filter(c => c !== id)
      : [...current, id]
    setParam(key, next.length === 0 ? null : next.join(','))
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
          Hazard category
        </div>
        <div className="flex flex-wrap gap-1.5">
          {HAZARD_CATS.map(c => {
            const active = filters.hazardCategory.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleListItem('hazard_category', c.id)}
                className={
                  'text-xs px-2 py-1 rounded-md border transition-colors ' +
                  (active
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700')
                }
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
          Status
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map(s => {
            const active = filters.status.includes(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleListItem('status', s.id)}
                className={
                  'text-xs px-2 py-1 rounded-md border transition-colors ' +
                  (active
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700')
                }
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
            View
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {(['inherent','residual'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setParam('view', v === 'residual' ? null : v)}
                className={
                  'text-xs px-3 py-1.5 transition-colors ' +
                  (filters.view === v
                    ? 'bg-brand-navy text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')
                }
              >
                {v === 'inherent' ? 'Inherent' : 'Residual'}
              </button>
            ))}
          </div>
        </div>

        {showSearch && (
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
              Search
            </div>
            <input
              type="search"
              placeholder="Title or RSK-…"
              defaultValue={filters.search}
              onChange={e => setParam('search', e.target.value || null)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-2.5 py-1.5 text-xs"
            />
          </div>
        )}
      </div>
    </div>
  )
}
