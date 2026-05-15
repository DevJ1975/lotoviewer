'use client'

import { memo, useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { Equipment } from '@soteria/core/types'
import { useDebounce } from '@/hooks/useDebounce'
import { useUploadQueue } from '@/components/UploadQueueProvider'
import { useSession } from '@/components/SessionProvider'
import { computePhotoStatusFromEquipment, needsPhoto, type PhotoStatus } from '@soteria/core/photoStatus'

type StatusFilter = 'all' | 'needs-photo' | 'missing' | 'partial' | 'complete'
type SortKey      = 'id' | 'status'

interface Props {
  equipment:      Equipment[]
  selectedDept:   string | null
  selectedEqId:   string | null
  onSelectEquip:  (id: string) => void
  decommissioned: ReadonlySet<string>
}

const STATUS_RANK: Record<PhotoStatus, number> = { missing: 0, partial: 1, complete: 2 }

function shortName(description: string): string {
  const m = description.match(/\(([^)]+)\)/)
  return m ? m[1].split(' - ')[0] : description
}

export default function EquipmentListPanel({ equipment, selectedDept, selectedEqId, onSelectEquip, decommissioned }: Props) {
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<StatusFilter>('all')
  const [sort, setSort]       = useState<SortKey>('id')
  const debounced = useDebounce(search, 300)
  const { queuedKeys }         = useUploadQueue()
  const { flags, toggleFlag }  = useSession()

  // Stable handlers so memoized rows don't re-render when parent state flips.
  const handleSelect = useCallback((id: string) => onSelectEquip(id), [onSelectEquip])
  const handleToggleFlag = useCallback((id: string) => toggleFlag(id), [toggleFlag])
  const queuedEquipmentIds = useMemo(() => {
    const ids = new Set<string>()
    queuedKeys.forEach(k => { ids.add(k.split(':')[0]) })
    return ids
  }, [queuedKeys])

  // Status is computed from URLs + needs_*_photo flags, not read from the
  // stored photo_status column. The stored column can drift if needs flags
  // change without a corresponding re-upload, or if an offline upload hasn't
  // drained yet. Computing here keeps counts, filters, sort, and row pills
  // consistent with each other and with the sidebar (which also computes).
  const statusById = useMemo(() => {
    const m = new Map<string, PhotoStatus>()
    for (const e of equipment) m.set(e.equipment_id, computePhotoStatusFromEquipment(e))
    return m
  }, [equipment])
  const statusOf = useCallback((e: Equipment): PhotoStatus => statusById.get(e.equipment_id) ?? 'missing', [statusById])

  // Drop decommissioned rows first, then narrow to dept.
  // (Filter chip counts are computed off the search-scoped list below, so this
  // flows through consistently.)
  const deptScoped = useMemo(() => {
    const active = equipment.filter(e => !decommissioned.has(e.equipment_id))
    return selectedDept ? active.filter(e => e.department === selectedDept) : active
  }, [equipment, selectedDept, decommissioned])

  // Counts per filter, respecting current dept and search
  const searchScoped = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    if (!q) return deptScoped
    return deptScoped.filter(e =>
      e.equipment_id.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q),
    )
  }, [deptScoped, debounced])

  const counts = useMemo(() => ({
    all:           searchScoped.length,
    'needs-photo': searchScoped.filter(needsPhoto).length,
    missing:       searchScoped.filter(e => statusOf(e) === 'missing').length,
    partial:       searchScoped.filter(e => statusOf(e) === 'partial').length,
    complete:      searchScoped.filter(e => statusOf(e) === 'complete').length,
  }), [searchScoped, statusOf])

  const filtered = useMemo(() => {
    switch (filter) {
      case 'needs-photo': return searchScoped.filter(needsPhoto)
      case 'missing':     return searchScoped.filter(e => statusOf(e) === 'missing')
      case 'partial':     return searchScoped.filter(e => statusOf(e) === 'partial')
      case 'complete':    return searchScoped.filter(e => statusOf(e) === 'complete')
      default:            return searchScoped
    }
  }, [searchScoped, filter, statusOf])

  const sorted = useMemo(() => {
    const rows = [...filtered]
    if (sort === 'status') {
      rows.sort((a, b) => {
        const d = STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)]
        return d !== 0 ? d : a.equipment_id.localeCompare(b.equipment_id)
      })
    } else {
      rows.sort((a, b) => a.equipment_id.localeCompare(b.equipment_id))
    }
    return rows
  }, [filtered, sort, statusOf])

  // Group by department when viewing "All"
  const grouped = useMemo(() => {
    if (selectedDept) return [{ dept: selectedDept, rows: sorted }]
    const map = new Map<string, Equipment[]>()
    for (const e of sorted) {
      const list = map.get(e.department) ?? []
      list.push(e)
      map.set(e.department, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dept, rows]) => ({ dept, rows }))
  }, [sorted, selectedDept])

  const filterBtns: { label: string; value: StatusFilter }[] = [
    { label: 'All',         value: 'all' },
    { label: 'Needs Photo', value: 'needs-photo' },
    { label: 'Missing',     value: 'missing' },
    { label: 'Partial',     value: 'partial' },
    { label: 'Complete',    value: 'complete' },
  ]

  return (
    <section className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-900/40 flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="placard-label text-slate-500 dark:text-slate-500">
              Equipment Register
            </p>
            <h2 className="stencil-title text-xl text-slate-950 dark:text-slate-50 mt-0.5 truncate">
              {selectedDept ?? 'All Equipment'}
            </h2>
            <p className="placard-label placard-numeric text-slate-400 dark:text-slate-500 mt-1">
              {sorted.length.toString().padStart(3, '0')} {sorted.length === 1 ? 'ITEM' : 'ITEMS'}
              {debounced.trim() && ` · MATCH "${debounced}"`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSort(s => s === 'id' ? 'status' : 'id')}
            className="placard-label rounded-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
            title="Toggle sort order"
          >
            Sort · {sort === 'id' ? 'ID ↑' : 'Status'}
          </button>
        </div>

        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by ID, description, or department…"
          className="w-full rounded-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
        />

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1">
          {filterBtns.map(b => (
            <button
              key={b.value}
              type="button"
              onClick={() => setFilter(b.value)}
              className={`placard-label shrink-0 px-3 py-1.5 rounded-sm border transition-colors ${
                filter === b.value
                  ? 'bg-brand-navy text-white border-brand-navy'
                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {b.label} <span className="placard-numeric opacity-80 ml-1">({counts[b.value].toString().padStart(2, '0')})</span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          equipment.length === 0 ? (
            // First-time empty state — tenant has zero equipment.
            // The CTA points at /import (CSV) or /admin/loto-devices,
            // not at an inline form, because adding equipment lives
            // on a separate page.
            <div className="flex flex-col items-center justify-center text-center px-6 py-16 gap-3">
              <span className="placard-label safety-tag safety-tag-caution">No Equipment On Register</span>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mt-1">
                The register is empty for this tenant.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                Start by importing your equipment list (CSV) or add one piece at a time
                from the equipment detail page.
              </p>
              <div className="flex gap-2 pt-1">
                <a
                  href="/import"
                  className="placard-label rounded-sm px-3 py-1.5 bg-brand-navy text-white hover:bg-brand-navy/90 transition-colors"
                >
                  Import CSV
                </a>
                <a
                  href="/admin/loto-devices"
                  className="placard-label rounded-sm px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Manage Devices
                </a>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-400 dark:text-slate-500 text-sm">
              No equipment matches your filters.
            </div>
          )
        ) : (
          grouped.map(group => (
            <div key={group.dept}>
              {!selectedDept && (
                <div className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur px-4 py-2 border-b-2 border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <span className="placard-label text-slate-700 dark:text-slate-300">{group.dept}</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-slate-300 to-transparent dark:from-slate-700" />
                  <span className="placard-label placard-numeric text-slate-400 dark:text-slate-500">
                    {group.rows.length.toString().padStart(2, '0')}
                  </span>
                </div>
              )}
              <ul>
                {group.rows.map(eq => (
                  <EquipmentRow
                    key={eq.equipment_id}
                    eq={eq}
                    status={statusOf(eq)}
                    isSelected={eq.equipment_id === selectedEqId}
                    isFlagged={flags.has(eq.equipment_id)}
                    isQueued={queuedEquipmentIds.has(eq.equipment_id)}
                    onSelect={handleSelect}
                    onToggleFlag={handleToggleFlag}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function StatusDot({ status }: { status: PhotoStatus }) {
  // Square dots read more as a status LED on a control panel than the
  // generic round dots that ship with every B2B template.
  const cls = status === 'complete' ? 'bg-emerald-500' : status === 'partial' ? 'bg-amber-400' : 'bg-rose-500'
  return <span className={`w-2.5 h-2.5 rounded-sm ${cls} shrink-0`} aria-label={status} />
}

function StatusPill({ status }: { status: PhotoStatus }) {
  // Aligned with the safety-tag vocabulary used elsewhere in the app:
  // CLEARED / PARTIAL / MISSING with the same shape and weight as the
  // tags shown in tables and the dashboard.
  const cfg = status === 'complete'
    ? { cls: 'safety-tag-cleared', label: 'Cleared' }
    : status === 'partial'
      ? { cls: 'safety-tag-caution', label: 'Partial' }
      : { cls: 'safety-tag-danger',  label: 'Missing' }
  return <span className={`safety-tag ${cfg.cls}`}>{cfg.label}</span>
}

interface EquipmentRowProps {
  eq:           Equipment
  status:       PhotoStatus
  isSelected:   boolean
  isFlagged:    boolean
  isQueued:     boolean
  onSelect:     (id: string) => void
  onToggleFlag: (id: string) => void
}

// Memoized so that unrelated parent state changes (search, sort, filter) do not
// re-render every row. A full list of ~1000 equipment reduces from ~1000
// reconciles per keystroke to near-zero.
const EquipmentRow = memo(function EquipmentRow({ eq, status, isSelected, isFlagged, isQueued, onSelect, onToggleFlag }: EquipmentRowProps) {
  // Count photos by URL presence so the "1/2" chip stays in sync with the
  // status pill/dot (both derived from URLs). The has_*_photo booleans
  // occasionally drift from the URL columns after migrations.
  const photoCount = (eq.equip_photo_url?.trim() ? 1 : 0) + (eq.iso_photo_url?.trim() ? 1 : 0)
  const handleClick = () => onSelect(eq.equipment_id)
  const handleContext = (e: MouseEvent) => { e.preventDefault(); onToggleFlag(eq.equipment_id) }
  const handleFlagClick = (e: MouseEvent) => { e.stopPropagation(); onToggleFlag(eq.equipment_id) }
  // content-visibility skips layout+paint for off-screen rows — near-virtualization
  // without a dep. intrinsic-size matches the row's rendered height (~68px) so
  // the scrollbar stays correct.
  return (
    <li style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 68px' }}>
      <div
        onClick={handleClick}
        onContextMenu={handleContext}
        className={`relative w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition-colors cursor-pointer group ${
          isSelected
            ? 'bg-brand-yellow/10 dark:bg-brand-yellow/5'
            : isFlagged
              ? 'bg-orange-50/60 hover:bg-orange-50'
              : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900/40'
        }`}
      >
        {/* Selection rail — same hazard-yellow vocabulary used by the
            sidebar and page headers, so the active row reads as
            "currently locked out" instead of a faint shadcn highlight. */}
        {isSelected && (
          <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-sm bg-brand-yellow" />
        )}
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="placard-numeric text-sm font-bold text-brand-navy dark:text-brand-yellow truncate">{eq.equipment_id}</span>
              {eq.verified && <span className="text-emerald-500 text-xs" title="Verified">✓</span>}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{shortName(eq.description)}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isQueued && (
              <span className="safety-tag safety-tag-caution" title="Upload queued">
                Queued
              </span>
            )}
            <span className="placard-numeric text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-sm px-1.5 py-0.5">
              {photoCount}/2
            </span>
            <StatusPill status={status} />
            <button
              type="button"
              onClick={handleFlagClick}
              aria-label={isFlagged ? 'Unflag' : 'Flag for follow-up'}
              title={isFlagged ? 'Unflag' : 'Flag for follow-up'}
              className={`text-[10px] font-black uppercase tracking-wider w-6 h-6 flex items-center justify-center rounded-sm transition-all ${
                isFlagged
                  ? 'bg-orange-500 text-white opacity-100'
                  : 'border border-slate-300 dark:border-slate-700 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-orange-500 hover:border-orange-300'
              }`}
            >
              !
            </button>
          </div>
        </div>
      </div>
    </li>
  )
})

