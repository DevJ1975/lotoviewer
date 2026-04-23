'use client'

import { memo, useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { Equipment } from '@/lib/types'
import { useDebounce } from '@/hooks/useDebounce'
import { useUploadQueue } from '@/components/UploadQueueProvider'
import { useSession } from '@/components/SessionProvider'
import { computePhotoStatusFromEquipment, type PhotoStatus } from '@/lib/photoStatus'

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

function needsPhoto(e: Equipment): boolean {
  return (e.needs_equip_photo && !e.has_equip_photo) || (e.needs_iso_photo && !e.has_iso_photo)
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
    <section className="flex-1 min-w-0 bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {selectedDept ?? 'All Equipment'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {sorted.length} {sorted.length === 1 ? 'item' : 'items'}
              {debounced.trim() && ` matching "${debounced}"`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSort(s => s === 'id' ? 'status' : 'id')}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Toggle sort order"
          >
            Sort: {sort === 'id' ? 'ID ↑' : 'Status'}
          </button>
        </div>

        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by ID, description, or department…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
        />

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1">
          {filterBtns.map(b => (
            <button
              key={b.value}
              type="button"
              onClick={() => setFilter(b.value)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                filter === b.value
                  ? 'bg-brand-navy text-white border-brand-navy'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {b.label} <span className="opacity-70 tabular-nums">({counts[b.value]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
            No equipment matches your filters.
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.dept}>
              {!selectedDept && (
                <div className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur px-4 py-2 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {group.dept} · {group.rows.length}
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
  const cls = status === 'complete' ? 'bg-emerald-500' : status === 'partial' ? 'bg-amber-400' : 'bg-rose-500'
  return <span className={`w-2.5 h-2.5 rounded-full ${cls} shrink-0`} aria-label={status} />
}

function StatusPill({ status }: { status: PhotoStatus }) {
  const style = status === 'complete'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'partial'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-rose-50 text-rose-700'
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${style}`}>{status}</span>
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
        className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors cursor-pointer group ${
          isSelected ? 'bg-brand-navy/5' : isFlagged ? 'bg-orange-50/60 hover:bg-orange-50' : 'bg-white hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-brand-navy truncate">{eq.equipment_id}</span>
              {eq.verified && <span className="text-emerald-500 text-xs" title="Verified">✓</span>}
            </div>
            <div className="text-xs text-slate-500 truncate">{shortName(eq.description)}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isQueued && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5" title="Upload queued">
                ☁︎ Queued
              </span>
            )}
            <span className="text-[10px] font-semibold text-slate-500 tabular-nums bg-slate-100 rounded-full px-1.5 py-0.5">
              {photoCount}/2
            </span>
            <StatusPill status={status} />
            <button
              type="button"
              onClick={handleFlagClick}
              aria-label={isFlagged ? 'Unflag' : 'Flag for follow-up'}
              title={isFlagged ? 'Unflag' : 'Flag for follow-up'}
              className={`text-sm w-6 h-6 flex items-center justify-center rounded transition-all ${
                isFlagged
                  ? 'text-orange-500 opacity-100'
                  : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-orange-500'
              }`}
            >
              🚩
            </button>
          </div>
        </div>
      </div>
    </li>
  )
})

