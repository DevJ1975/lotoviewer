'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Download, QrCode, Settings, Wrench } from 'lucide-react'
import { readActiveTenant, supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { EQUIPMENT_READINESS_LABEL, type EquipmentReadinessStatus } from '@soteria/core/equipmentReadiness'

interface EquipmentRow {
  id: string
  equipment_id: string
  description: string | null
  department: string | null
  equipment_family: string | null
  readiness_status: EquipmentReadinessStatus | null
  last_pre_use_inspection_at: string | null
}

interface InspectionRow {
  id: string
  equipment_id: string
  submitted_at: string
  readiness_result: 'ready' | 'limited_use' | 'blocked'
  failed_critical_count: number
  failed_item_count: number
}

interface DefectRow {
  id: string
  severity: 'monitor' | 'repair_soon' | 'critical'
  status: string
  out_of_service: boolean
  description: string
  last_seen_at: string
  equipment_record_id: string
}

export default function EquipmentReadinessPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const [equipment, setEquipment] = useState<EquipmentRow[]>([])
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [defects, setDefects] = useState<DefectRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    try {
      const [{ data: equipmentRows, error: equipmentErr }, { data: inspectionRows, error: inspectionErr }, { data: defectRows, error: defectErr }] = await Promise.all([
        supabase
          .from('loto_equipment')
          .select('id,equipment_id,description,department,equipment_family,readiness_status,last_pre_use_inspection_at')
          .eq('tenant_id', tenantId)
          .eq('decommissioned', false)
          .order('equipment_id', { ascending: true })
          .limit(250),
        supabase
          .from('equipment_inspections')
          .select('id,equipment_id,submitted_at,readiness_result,failed_critical_count,failed_item_count')
          .eq('tenant_id', tenantId)
          .order('submitted_at', { ascending: false })
          .limit(25),
        supabase
          .from('equipment_defects')
          .select('id,severity,status,out_of_service,description,last_seen_at,equipment_record_id')
          .eq('tenant_id', tenantId)
          .in('status', ['open', 'acknowledged', 'in_repair'])
          .order('last_seen_at', { ascending: false })
          .limit(50),
      ])
      if (equipmentErr) throw equipmentErr
      if (inspectionErr) throw inspectionErr
      if (defectErr) throw defectErr
      setEquipment((equipmentRows ?? []) as EquipmentRow[])
      setInspections((inspectionRows ?? []) as InspectionRow[])
      setDefects((defectRows ?? []) as DefectRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const metrics = useMemo(() => {
    const out = equipment.filter(row => row.readiness_status === 'out_of_service_pending_review' || row.readiness_status === 'out_of_service').length
    const limited = equipment.filter(row => row.readiness_status === 'limited_use').length
    const ready = equipment.filter(row => (row.readiness_status ?? 'available') === 'available').length
    const today = new Date().toISOString().slice(0, 10)
    const inspectedToday = inspections.filter(row => row.submitted_at.slice(0, 10) === today).length
    return { total: equipment.length, ready, limited, out, inspectedToday, openDefects: defects.length }
  }, [defects.length, equipment, inspections])

  async function downloadAuditExport() {
    const { data: { session } } = await supabase.auth.getSession()
    const access = session?.access_token
    const tenantId = readActiveTenant()
    if (!access || !tenantId) {
      setError('Sign in and select a tenant before exporting.')
      return
    }
    const res = await fetch('/api/equipment-readiness/export', {
      headers: { authorization: `Bearer ${access}`, 'x-active-tenant': tenantId },
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? `Export failed (${res.status})`)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `equipment-readiness-${new Date().toISOString().slice(0, 10)}.pdf`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">Equipment Readiness</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">PIT, lift, and mobile equipment pre-use checks with photo evidence.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void downloadAuditExport()} className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
            <Download className="h-4 w-4" /> Export
          </button>
          <Link href="/equipment-readiness/config" className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
            <Settings className="h-4 w-4" /> Configure
          </Link>
          <Link href="/equipment-readiness/qr" className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
            <QrCode className="h-4 w-4" /> QR Labels
          </Link>
          <Link
            href="/equipment-readiness/scan"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
          >
            <QrCode className="h-4 w-4" />
            Scan & Inspect
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric icon={ClipboardCheck} label="Fleet tracked" value={metrics.total} />
        <Metric icon={CheckCircle2} label="Available" value={metrics.ready} tone="green" />
        <Metric icon={Clock} label="Inspected today" value={metrics.inspectedToday} tone="blue" />
        <Metric icon={Wrench} label="Limited use" value={metrics.limited} tone="amber" />
        <Metric icon={AlertTriangle} label="Out of service" value={metrics.out} tone="red" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent inspections</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
            {!loading && inspections.length === 0 && <p className="p-4 text-sm text-slate-500">No pre-use inspections yet.</p>}
            {inspections.map(row => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{row.equipment_id}</p>
                  <p className="text-xs text-slate-500">{new Date(row.submitted_at).toLocaleString()}</p>
                </div>
                <StatusPill status={row.readiness_result === 'blocked' ? 'out_of_service_pending_review' : row.readiness_result === 'limited_use' ? 'limited_use' : 'available'} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Open defects</h2>
            <Link href="/equipment-readiness/defects" className="text-xs font-semibold text-teal-700 hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {!loading && defects.length === 0 && <p className="p-4 text-sm text-slate-500">No open defects.</p>}
            {defects.slice(0, 8).map(row => (
              <div key={row.id} className="px-4 py-3">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.description}</p>
                <p className="text-xs text-slate-500">{row.severity.replace('_', ' ')} · {new Date(row.last_seen_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

function Metric({ icon: Icon, label, value, tone = 'slate' }: { icon: typeof ClipboardCheck; label: string; value: number; tone?: 'slate' | 'green' | 'blue' | 'amber' | 'red' }) {
  const color = {
    slate: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300',
    green: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300',
    blue: 'text-sky-700 bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300',
    amber: 'text-amber-700 bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300',
    red: 'text-rose-700 bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300',
  }[tone]
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-md ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}

function StatusPill({ status }: { status: EquipmentReadinessStatus }) {
  const cls = status === 'available'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
    : status === 'limited_use'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${cls}`}>{EQUIPMENT_READINESS_LABEL[status]}</span>
}
