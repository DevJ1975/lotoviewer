'use client'

import { useMemo } from 'react'
import type { Equipment } from '@/lib/types'
import { computePhotoStatusFromEquipment } from '@/lib/photoStatus'

interface Props {
  equipment:      Equipment[]
  selectedDept:   string | null
  onSelectDept:   (dept: string | null) => void
}

interface DeptRow {
  name:     string
  total:    number
  complete: number
  pct:      number
}

export default function DashboardSidebar({ equipment, selectedDept, onSelectDept }: Props) {
  const { total, complete, partial, missing, pct, departments } = useMemo(() => {
    const deptMap = new Map<string, { total: number; complete: number }>()
    let complete = 0, partial = 0, missing = 0

    for (const e of equipment) {
      const status = computePhotoStatusFromEquipment(e)
      if (status === 'complete') complete++
      else if (status === 'partial') partial++
      else missing++

      const d = deptMap.get(e.department) ?? { total: 0, complete: 0 }
      d.total++
      if (status === 'complete') d.complete++
      deptMap.set(e.department, d)
    }

    const total = equipment.length
    const pct   = total === 0 ? 0 : Math.round((complete / total) * 100)
    const departments: DeptRow[] = [...deptMap.entries()]
      .map(([name, v]) => ({ name, total: v.total, complete: v.complete, pct: v.total === 0 ? 0 : Math.round((v.complete / v.total) * 100) }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { total, complete, partial, missing, pct, departments }
  }, [equipment])

  return (
    <aside className="shrink-0 w-full lg:w-72 bg-white border-r border-slate-100 flex flex-col">
      {/* Completion summary */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Overall Progress</span>
          <span className="text-xs font-bold text-slate-700 tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-brand-navy'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3">
          <StatChip label="Total"   value={total}    color="slate" />
          <StatChip label="Done"    value={complete} color="emerald" />
          <StatChip label="Partial" value={partial}  color="amber" />
          <StatChip label="Missing" value={missing}  color="rose" />
        </div>
      </div>

      {/* Department list */}
      <div className="flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={() => onSelectDept(null)}
          className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${
            selectedDept === null ? 'bg-brand-navy/5' : 'hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">🗂️</span>
              <span className="text-sm font-semibold text-slate-800">All Equipment</span>
            </div>
            <span className="text-[11px] font-bold text-slate-500 tabular-nums bg-slate-100 rounded-full px-2 py-0.5">{total}</span>
          </div>
        </button>

        {departments.map(d => (
          <button
            key={d.name}
            type="button"
            onClick={() => onSelectDept(d.name)}
            className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors ${
              selectedDept === d.name ? 'bg-brand-navy/5' : 'hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-slate-800 truncate flex-1">{d.name}</span>
              <span className="text-[11px] text-slate-400 tabular-nums ml-2 shrink-0">{d.complete}/{d.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full transition-all ${d.pct === 100 ? 'bg-emerald-500' : 'bg-brand-navy'}`}
                style={{ width: `${d.pct}%` }}
              />
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: 'slate' | 'emerald' | 'amber' | 'rose' }) {
  const bgClass = {
    slate:   'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber:   'bg-amber-50 text-amber-700',
    rose:    'bg-rose-50 text-rose-700',
  }[color]
  return (
    <div className={`rounded-md px-2 py-1.5 text-center ${bgClass}`}>
      <div className="text-sm font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[9px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
    </div>
  )
}
