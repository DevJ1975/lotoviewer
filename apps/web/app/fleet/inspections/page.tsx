'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardCheck, Loader2, Check, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { listInspections, type InspectionRow } from '@/lib/fleet/client'

export default function FleetInspectionsPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const [rows, setRows] = useState<InspectionRow[]>([])
  const [failedOnly, setFailedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try { setRows(await listInspections(tenantId, { failedOnly })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [tenantId, failedOnly])

  useEffect(() => { void load() }, [load])

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <PageHeader
        icon={ClipboardCheck}
        title="Inspections"
        description="Pre-trip and periodic vehicle inspections."
        back="/fleet"
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={failedOnly} onChange={e => setFailedOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Failed only
          </label>
        }
      />

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      <section className="rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No inspections yet" description="Run a pre-trip inspection from a vehicle's page." />
        ) : (
          <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {rows.map(r => {
              const v = r.fleet_vehicles
              const label = v?.unit_number || [v?.make, v?.model].filter(Boolean).join(' ') || 'Vehicle'
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/fleet/vehicles/${r.vehicle_id}`} className="font-semibold text-brand-navy hover:underline dark:text-sky-300">{label}</Link>
                    <p className="text-xs text-slate-500">{r.inspection_type.replace(/_/g, '-')} · {new Date(r.performed_at).toLocaleString()}{r.defects_noted ? ` · ${r.defects_noted}` : ''}</p>
                  </div>
                  {r.passed
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Check className="h-3 w-3" /> Pass</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"><X className="h-3 w-3" /> Fail</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
