'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ClipboardCheck, Clock, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  EQUIPMENT_FAMILY_LABEL,
  EQUIPMENT_READINESS_LABEL,
  normalizeEquipmentFamily,
  type EquipmentReadinessStatus,
} from '@soteria/core/equipmentReadiness'
import type { Equipment } from '@soteria/core/types'

interface Props {
  equipment: Equipment
}

interface InspectionRow {
  id: string
  submitted_at: string
  readiness_result: 'ready' | 'limited_use' | 'blocked'
  failed_critical_count: number
  failed_item_count: number
  signature_name: string | null
}

interface DefectRow {
  id: string
  severity: 'monitor' | 'repair_soon' | 'critical'
  status: 'open' | 'acknowledged' | 'in_repair' | 'resolved' | 'cancelled'
  out_of_service: boolean
  description: string
  last_seen_at: string
}

interface EvidenceRow {
  id: string
  source_type: 'inspection' | 'defect' | 'repair'
  storage_path: string
  evidence_kind: string
  caption: string | null
  created_at: string
}

export default function EquipmentReadinessPanel({ equipment }: Props) {
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [defects, setDefects] = useState<DefectRow[]>([])
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const recordId = equipment.id ?? null
  const family = normalizeEquipmentFamily(equipment.equipment_family)
  const status = normalizeReadinessStatus(equipment.readiness_status)

  const load = useCallback(async () => {
    if (!recordId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [{ data: inspectionRows, error: inspectionErr }, { data: defectRows, error: defectErr }, { data: evidenceRows, error: evidenceErr }] = await Promise.all([
        supabase
          .from('equipment_inspections')
          .select('id,submitted_at,readiness_result,failed_critical_count,failed_item_count,signature_name')
          .eq('equipment_record_id', recordId)
          .order('submitted_at', { ascending: false })
          .limit(5),
        supabase
          .from('equipment_defects')
          .select('id,severity,status,out_of_service,description,last_seen_at')
          .eq('equipment_record_id', recordId)
          .in('status', ['open', 'acknowledged', 'in_repair'])
          .order('last_seen_at', { ascending: false })
          .limit(5),
        supabase
          .from('equipment_evidence')
          .select('id,source_type,storage_path,evidence_kind,caption,created_at')
          .eq('equipment_record_id', recordId)
          .order('created_at', { ascending: false })
          .limit(6),
      ])
      if (inspectionErr) throw inspectionErr
      if (defectErr) throw defectErr
      if (evidenceErr) throw evidenceErr
      setInspections((inspectionRows ?? []) as InspectionRow[])
      setDefects((defectRows ?? []) as DefectRow[])
      setEvidence((evidenceRows ?? []) as EvidenceRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => { void load() }, [load])

  const latest = inspections[0] ?? null
  const outOfServiceDefects = useMemo(() => defects.filter(row => row.out_of_service).length, [defects])

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            Equipment readiness
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {EQUIPMENT_FAMILY_LABEL[family]} · {latest ? `Last inspected ${new Date(latest.submitted_at).toLocaleString()}` : 'No pre-use inspection recorded'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={status} />
          <Link
            href={`/equipment-readiness/inspect/${encodeURIComponent(equipment.equipment_id)}`}
            className="inline-flex items-center rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
          >
            Start pre-use check
          </Link>
        </div>
      </header>

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
      {loading && <p className="text-xs text-slate-500">Loading readiness history…</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Clock} label="Recent inspections" value={inspections.length} />
        <Metric icon={AlertTriangle} label="Open defects" value={defects.length} tone={defects.length > 0 ? 'amber' : 'slate'} />
        <Metric icon={Wrench} label="Out-of-service defects" value={outOfServiceDefects} tone={outOfServiceDefects > 0 ? 'red' : 'slate'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Recent inspections</h3>
          <div className="space-y-2">
            {inspections.length === 0 && <p className="text-xs text-slate-500">No inspection history yet.</p>}
            {inspections.slice(0, 3).map(row => (
              <div key={row.id} className="rounded-md border border-slate-100 p-3 text-xs dark:border-slate-800">
                <p className="font-semibold text-slate-800 dark:text-slate-100">{new Date(row.submitted_at).toLocaleString()}</p>
                <p className="text-slate-500">{row.readiness_result.replace('_', ' ')} · failed {row.failed_item_count} · critical {row.failed_critical_count}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Open defects</h3>
          <div className="space-y-2">
            {defects.length === 0 && <p className="text-xs text-slate-500">No open defects.</p>}
            {defects.slice(0, 3).map(row => (
              <div key={row.id} className="rounded-md border border-slate-100 p-3 text-xs dark:border-slate-800">
                <p className="font-semibold text-slate-800 dark:text-slate-100">{row.description}</p>
                <p className="text-slate-500">{row.severity.replace('_', ' ')} · {row.status.replace('_', ' ')}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {evidence.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Latest photo evidence</h3>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            {evidence.map(row => (
              <span key={row.id} className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">
                {row.evidence_kind.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function normalizeReadinessStatus(value: string | undefined): EquipmentReadinessStatus {
  if (
    value === 'available'
    || value === 'inspection_due'
    || value === 'limited_use'
    || value === 'out_of_service_pending_review'
    || value === 'out_of_service'
    || value === 'decommissioned'
  ) {
    return value
  }
  return 'available'
}

function Metric({ icon: Icon, label, value, tone = 'slate' }: { icon: typeof Clock; label: string; value: number; tone?: 'slate' | 'amber' | 'red' }) {
  const cls = tone === 'red'
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200'
    : tone === 'amber'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
  return (
    <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
      <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-md ${cls}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-lg font-semibold text-slate-950 dark:text-slate-50">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}

function StatusPill({ status }: { status: EquipmentReadinessStatus }) {
  const cls = status === 'available'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
    : status === 'limited_use' || status === 'inspection_due'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
  return <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${cls}`}>{EQUIPMENT_READINESS_LABEL[status]}</span>
}
