'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Printer, BookOpen, ClipboardCheck, Users, Building2, ClipboardList, FileCheck2, Archive, BookText, Cable, Eye, KeyRound, ShieldCheck } from 'lucide-react'
import type { Equipment } from '@soteria/core/types'
import { computePhotoStatusFromEquipment } from '@soteria/core/photoStatus'
import { useSession } from '@/components/SessionProvider'
import StatusReportButton from '@/components/equipment/StatusReportButton'
import ExportCsvButton    from '@/components/equipment/ExportCsvButton'
import AddEquipmentButton from '@/components/equipment/AddEquipmentButton'

interface Props {
  equipment:        Equipment[]
  selectedDept:     string | null
  selectedEqId:     string | null
  onSelectDept:     (dept: string | null) => void
  onSelectEquip:    (id: string) => void
  onBatchPrint:     () => void
  onEquipmentAdded: (row: Equipment) => void
  decommissioned:   ReadonlySet<string>
}

function shortName(description: string): string {
  const m = description.match(/\(([^)]+)\)/)
  return m ? m[1].split(' - ')[0] : description
}

function statusDotClass(status: Equipment['photo_status']) {
  return status === 'complete' ? 'bg-emerald-500' : status === 'partial' ? 'bg-amber-400' : 'bg-rose-500'
}

interface DeptRow {
  name:     string
  total:    number
  complete: number
  pct:      number
}

export default function DashboardSidebar({ equipment, selectedDept, selectedEqId, onSelectDept, onSelectEquip, onBatchPrint, onEquipmentAdded, decommissioned }: Props) {
  const { recents } = useSession()
  const recentEquipment = useMemo(() => {
    const byId = new Map(equipment.map(e => [e.equipment_id, e]))
    return recents.map(id => byId.get(id)).filter(Boolean) as Equipment[]
  }, [recents, equipment])
  const { total, complete, partial, missing, pct, departments } = useMemo(() => {
    const deptMap = new Map<string, { total: number; complete: number }>()
    let complete = 0, partial = 0, missing = 0
    let total = 0

    for (const e of equipment) {
      if (decommissioned.has(e.equipment_id)) continue
      total++
      const status = computePhotoStatusFromEquipment(e)
      if (status === 'complete') complete++
      else if (status === 'partial') partial++
      else missing++

      const d = deptMap.get(e.department) ?? { total: 0, complete: 0 }
      d.total++
      if (status === 'complete') d.complete++
      deptMap.set(e.department, d)
    }

    const pct   = total === 0 ? 0 : Math.round((complete / total) * 100)
    const departments: DeptRow[] = [...deptMap.entries()]
      .map(([name, v]) => ({ name, total: v.total, complete: v.complete, pct: v.total === 0 ? 0 : Math.round((v.complete / v.total) * 100) }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { total, complete, partial, missing, pct, departments }
  }, [equipment, decommissioned])

  return (
    <aside className="shrink-0 w-full lg:w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
      {/* Action toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1">
        <StatusReportButton equipment={equipment} decommissioned={decommissioned} />
        <ExportCsvButton    equipment={equipment} decommissioned={decommissioned} />
        <AddEquipmentButton equipment={equipment} onAdded={onEquipmentAdded} />
        <button
          type="button"
          onClick={onBatchPrint}
          title="Batch print by department"
          aria-label="Batch print by department"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <Printer className="h-3.5 w-3.5" />
        </button>
        <Link
          href="/loto/manual"
          title="LOTO user manual"
          aria-label="Open the LOTO user manual"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <BookOpen className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/periodic-inspections"
          title="Annual periodic inspections (§147(c)(6))"
          aria-label="Periodic procedure inspections"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/loto/group-permits"
          title="Group LOTO permits (§147(f)(3))"
          aria-label="Group LOTO permits"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <Users className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/contractors"
          title="Contractor companies (§147(f)(2))"
          aria-label="Contractor companies"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <Building2 className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/competency-exams"
          title="Competency exams (§147(c)(7))"
          aria-label="Competency exams"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <ClipboardList className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/signed-artifacts"
          title="Sealed PDF audit artifacts"
          aria-label="Sealed PDF audit artifacts"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <FileCheck2 className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/retention"
          title="Data retention policy and legal holds"
          aria-label="Retention and legal holds"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <Archive className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/iso45001"
          title="ISO 45001 clause evidence map"
          aria-label="ISO 45001 clause evidence map"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <BookText className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/sso"
          title="Single sign-on (SAML / OIDC)"
          aria-label="Single sign-on"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/scim"
          title="SCIM 2.0 provisioning tokens"
          aria-label="SCIM tokens"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/cmms"
          title="CMMS integrations"
          aria-label="CMMS integrations"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <Cable className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/admin/bbs/dashboard"
          title="BBS leading-indicator dashboard"
          aria-label="BBS leading-indicator dashboard"
          className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Completion summary */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="placard-label text-slate-500 dark:text-slate-500">Overall Progress</span>
          <span className="placard-numeric text-sm font-black text-slate-800 dark:text-slate-200">
            {pct.toString().padStart(3, '0')}%
          </span>
        </div>
        <div className="relative h-2 rounded-sm bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className={`h-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-brand-navy'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3">
          <StatChip label="Total"   value={total}    color="slate" />
          <StatChip label="Cleared" value={complete} color="emerald" />
          <StatChip label="Partial" value={partial}  color="amber" />
          <StatChip label="Missing" value={missing}  color="rose" />
        </div>
      </div>

      {/* Department list */}
      <div className="flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={() => onSelectDept(null)}
          className={`relative w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition-colors ${
            selectedDept === null
              ? 'bg-brand-yellow/10 dark:bg-brand-yellow/5'
              : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
          }`}
        >
          {selectedDept === null && (
            <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-sm bg-brand-yellow" />
          )}
          <div className="flex items-center justify-between">
            <span className="placard-label-lg text-slate-800 dark:text-slate-200">All Equipment</span>
            <span className="placard-numeric text-[11px] font-black text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-sm px-2 py-0.5">
              {total.toString().padStart(3, '0')}
            </span>
          </div>
        </button>

        {departments.map(d => {
          const active = selectedDept === d.name
          return (
            <button
              key={d.name}
              type="button"
              onClick={() => onSelectDept(d.name)}
              className={`relative w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition-colors ${
                active
                  ? 'bg-brand-yellow/10 dark:bg-brand-yellow/5'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
              }`}
            >
              {active && (
                <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-sm bg-brand-yellow" />
              )}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate flex-1">{d.name}</span>
                <span className="placard-numeric text-[11px] text-slate-500 dark:text-slate-400 ml-2 shrink-0">
                  {d.complete.toString().padStart(2, '0')}/{d.total.toString().padStart(2, '0')}
                </span>
              </div>
              <div className="h-1.5 rounded-sm bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all ${d.pct === 100 ? 'bg-emerald-500' : 'bg-brand-navy'}`}
                  style={{ width: `${d.pct}%` }}
                />
              </div>
            </button>
          )
        })}

        {recentEquipment.length > 0 && (
          <div className="border-t-2 border-slate-200 dark:border-slate-800 mt-2">
            <p className="placard-label px-4 py-2 text-slate-500 dark:text-slate-500">
              Recently Visited
            </p>
            <ul>
              {recentEquipment.map(eq => {
                const active = selectedEqId === eq.equipment_id
                return (
                  <li key={eq.equipment_id}>
                    <button
                      type="button"
                      onClick={() => onSelectEquip(eq.equipment_id)}
                      className={`relative w-full text-left px-4 py-2 border-b border-slate-100 dark:border-slate-800 transition-colors ${
                        active
                          ? 'bg-brand-yellow/10 dark:bg-brand-yellow/5'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                      }`}
                    >
                      {active && (
                        <span aria-hidden="true" className="absolute left-0 top-1 bottom-1 w-1 rounded-r-sm bg-brand-yellow" />
                      )}
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-sm ${statusDotClass(computePhotoStatusFromEquipment(eq))} shrink-0`} />
                        <div className="min-w-0 flex-1">
                          <p className="placard-numeric text-xs font-bold text-brand-navy dark:text-brand-yellow truncate">{eq.equipment_id}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-500 truncate">{shortName(eq.description)}</p>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </aside>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: 'slate' | 'emerald' | 'amber' | 'rose' }) {
  const bgClass = {
    slate:   'bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
    amber:   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
    rose:    'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  }[color]
  return (
    <div className={`rounded-sm px-2 py-1.5 text-center ${bgClass}`}>
      <div className="placard-numeric text-sm font-black leading-tight">{value.toString().padStart(2, '0')}</div>
      <div className="placard-label opacity-80 mt-0.5 text-[9px]">{label}</div>
    </div>
  )
}
